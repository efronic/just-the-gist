const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const setStatus = (msg?: string) => {
  const el = document.getElementById('status') as HTMLElement;
  el.textContent = msg || '';
};

const setOutput = (text?: string) => {
  const el = document.getElementById('output') as HTMLElement;
  el.textContent = text || '';
};

import type { SummarizeMode } from './types/extract';
import { SUMMARIZE_MODE } from './types/extract';

const summarize = async (mode: SummarizeMode, detailLevel: string) => {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab.');

  const resp = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE_TAB',
    tabId: tab.id,
    mode,
    detailLevel
  });

  if (!resp?.ok) throw new Error(resp?.error || 'Unknown error.');
  return resp.result;
};

// --- Transcript helpers (popup) ---
interface StoredTranscript { cues: Array<{ text: string; startTime: number; endTime: number; }>; lang?: string; truncated?: boolean; }

interface TranscriptCacheEntry {
  fullText: string;
  cues: StoredTranscript['cues'];
  lang?: string;
  truncated?: boolean;
}

const extractVideoIdFromUrl = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/youtube\.com$/.test(u.hostname) && u.pathname === '/watch') {
      return u.searchParams.get('v');
    }
    if (/youtu\.be$/.test(u.hostname)) {
      const id = u.pathname.slice(1);
      if (id) return id;
    }
  } catch { /* ignore */ }
  return null;
};

// Build rich HTML from cues
const buildTranscriptHtml = (cues: StoredTranscript['cues'], opts: { showTs: boolean; compact: boolean; highlight?: string; }) => {
  if (!cues.length) return '';
  const PARAGRAPH_GAP_SEC = 4; // new paragraph if gap between cues exceeds this
  const MAX_PARAGRAPH_DURATION = 30; // force break if a paragraph grows too long in seconds
  const safe = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const highlightTerm = opts.highlight?.trim();
  const highlightRegex = highlightTerm ? new RegExp(highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig') : null;
  const fmtCue = (text: string) => {
    const escaped = safe(text);
    return highlightRegex ? escaped.replace(highlightRegex, m => `<mark class="bg-yellow-200">${m}</mark>`) : escaped;
  };
  const parts: string[] = [];
  let para: typeof cues = [];
  let paraStart = cues[0].startTime;
  let lastEnd = cues[0].endTime;
  const flush = () => {
    if (!para.length) return;
    const first = para[0];
    const last = para[para.length - 1];
    const duration = last.endTime - first.startTime;
    const body = para.map(c => fmtCue(c.text)).join(opts.compact ? ' ' : ' ');
    const tsLabel = opts.showTs ? `<span class="inline-block text-gray-500 mr-2 select-none">${formatTs(first.startTime)}</span>` : '';
    parts.push(`<p class="m-0 ${opts.compact ? '' : 'mb-2'}">${tsLabel}${body}</p>`);
    para = [];
  };
  for (const cue of cues) {
    const gap = cue.startTime - lastEnd;
    if (gap > PARAGRAPH_GAP_SEC || (cue.endTime - paraStart) > MAX_PARAGRAPH_DURATION) {
      flush();
      paraStart = cue.startTime;
    }
    para.push(cue);
    lastEnd = cue.endTime;
  }
  flush();
  return parts.join('\n');
};

const loadTranscriptIntoPopup = async (tabUrl?: string) => {
  const vid = extractVideoIdFromUrl(tabUrl);
  const container = document.getElementById('transcriptContainer');
  const previewEl = document.getElementById('transcriptPreview');
  const contentEl = document.getElementById('transcriptContent');
  const metaEl = document.getElementById('transcriptMeta');
  if (!container || !previewEl || !metaEl) return;
  if (!vid) {
    container.classList.add('hidden');
    return;
  }
  const key = `yt_transcript_${vid}`;
  try {
    const store = await chrome.storage.local.get(key);
    const entry: StoredTranscript | undefined = store[key];
    if (!entry || !entry.cues?.length) {
      container.classList.add('hidden');
      return;
    }
    const fullText = entry.cues.map(c => c.text).join(' ');
    // Render as rich paragraphs using button toggle state (aria-pressed)
    const showTsBtn = document.getElementById('tbToggleTs');
    const compactBtn = document.getElementById('tbCompact');
    const showTs = showTsBtn ? showTsBtn.getAttribute('aria-pressed') !== 'false' : true;
    const compact = compactBtn ? compactBtn.getAttribute('aria-pressed') === 'true' : false;
    if (contentEl) (contentEl as HTMLElement).innerHTML = buildTranscriptHtml(entry.cues, { showTs, compact });
    metaEl.textContent = `Language: ${entry.lang || 'unknown'} • Cues: ${entry.cues.length}${entry.truncated ? ' • (truncated at capture)' : ''}`;
    container.classList.remove('hidden');
    // Attach data attributes for later copy/download
    (container as any)._fullTranscript = fullText;
    (container as any)._cues = entry.cues;
    (container as any)._videoId = vid;

    // Restore expand state for this video if stored
    const { EXPANDED_TRANSCRIPTS } = await chrome.storage.local.get({ EXPANDED_TRANSCRIPTS: {} as Record<string, boolean> });
    const expanded = !!EXPANDED_TRANSCRIPTS[vid];
    const toggleBtn = document.getElementById('tbExpand');
    if (expanded) {
      // Expanded state: allow more vertical space (initial preview starts with max-h-[420px])
      previewEl.classList.remove('max-h-80');
      previewEl.classList.add('max-h-[800px]', 'overflow-y-auto');
      toggleBtn && toggleBtn.setAttribute('aria-pressed', 'true');
      toggleBtn && toggleBtn.setAttribute('data-expanded', 'true');
    } else {
      // Ensure collapsed baseline classes present
      previewEl.classList.remove('max-h-[800px]');
      if (!previewEl.classList.contains('max-h-80')) previewEl.classList.add('max-h-80');
    }
  } catch { /* ignore */ }
};

const init = async () => {
  const tab = await getActiveTab();
  const urlEl = document.getElementById('url');
  if (urlEl instanceof HTMLInputElement) {
    urlEl.value = tab?.url || '';
  } else if (urlEl) {
    urlEl.textContent = tab?.url || '';
  }

  document.getElementById('openOptions')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('openOptions2')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Load API settings to decide whether to show inline API section
  const { GEMINI_API_KEY, GEMINI_MODEL, SHOW_TRANSCRIPT_PANEL, DETAIL_LEVEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
    SHOW_TRANSCRIPT_PANEL: true,
    DETAIL_LEVEL: 'standard'
  });

  // Populate mode select from shared constants
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  if (modeSelect && modeSelect.options.length === 3) {
    // Replace existing options to avoid duplicates and keep labels nice-case
    modeSelect.innerHTML = '';
    const entries: Array<[SummarizeMode, string]> = [
      [SUMMARIZE_MODE.auto, 'Auto'],
      [SUMMARIZE_MODE.page, 'Page'],
      [SUMMARIZE_MODE.video, 'Video']
    ];
    for (const [value, label] of entries) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    }
    modeSelect.value = SUMMARIZE_MODE.auto;
  }
  const apiSection = document.getElementById('apiSection') as HTMLElement;
  const summarizeBtn = document.getElementById('summarizeBtn') as HTMLButtonElement;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
  const apiModelSelect = document.getElementById('apiModel') as HTMLSelectElement | null;
  const apiStatus = document.getElementById('apiStatus') as HTMLElement | null;

  if (!GEMINI_API_KEY) {
    // No key yet: show inline section and disable summarize until saved
    if (apiSection) apiSection.style.display = '';
    if (apiKeyInput) apiKeyInput.value = '';
    if (apiModelSelect) apiModelSelect.value = GEMINI_MODEL || 'gemini-2.5-flash';
    summarizeBtn.disabled = true;
    setStatus('Enter your Gemini API key to continue.');
  } else {
    // Key exists: keep section hidden and allow summarizing
    if (apiSection) apiSection.style.display = 'none';
    summarizeBtn.disabled = false;
  }

  // Save API settings from inline section
  document.getElementById('saveApi')?.addEventListener('click', async () => {
    try {
      const key = (apiKeyInput?.value || '').trim();
      const model = (apiModelSelect?.value || 'gemini-2.5-flash').trim();
      if (!key) {
        apiStatus && (apiStatus.textContent = 'API key is required.');
        return;
      }
      await chrome.storage.sync.set({ GEMINI_API_KEY: key, GEMINI_MODEL: model });
      apiStatus && (apiStatus.textContent = 'Saved.');
      setTimeout(() => { if (apiStatus) apiStatus.textContent = ''; }, 1500);
      // Hide section and enable summarize
      if (apiSection) apiSection.style.display = 'none';
      summarizeBtn.disabled = false;
      setStatus('Ready.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      apiStatus && (apiStatus.textContent = msg);
    }
  });

  const btn = document.getElementById('summarizeBtn') as HTMLButtonElement;
  // Initialize detail level selector from storage
  const detailLevelSel = document.getElementById('detailLevelSelect') as HTMLSelectElement | null;
  if (detailLevelSel && DETAIL_LEVEL) detailLevelSel.value = DETAIL_LEVEL;

  // Copy URL button (new design)
  document.getElementById('copyUrl')?.addEventListener('click', () => {
    const urlInput = document.getElementById('url') as HTMLInputElement | HTMLElement | null;
    const text = (urlInput as HTMLInputElement)?.value || urlInput?.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => setStatus('URL copied')).catch(() => setStatus('Copy failed'));
    setTimeout(() => setStatus(''), 1200);
  });

  // Track transcript load status so we can lazily load when transcript panel first shown
  let transcriptLoadedFlag = false;

  btn.addEventListener('click', async () => {
    const mode = (document.getElementById('mode') as HTMLSelectElement).value as SummarizeMode;
    const detailLevel = (detailLevelSel?.value || 'standard');
    btn.disabled = true;
    setStatus('Summarizing…');
    setOutput('');
    try {
      const { text } = await summarize(mode, detailLevel);
      setOutput(text);
      setStatus('Done');
      // Invalidate transcript loaded flag so it reloads when transcript tab opened
      transcriptLoadedFlag = false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      btn.disabled = false;
    }
  });
  // --- Panel toggle setup (button-based) ---
  const summaryPanel = document.getElementById('summaryTabPanel');
  const transcriptPanel = document.getElementById('transcriptTabPanel');
  const summaryBtn = document.getElementById('btnSummary') as HTMLButtonElement | null;
  const transcriptBtn = document.getElementById('btnTranscript') as HTMLButtonElement | null;

  const setActive = (which: 'summary' | 'transcript') => {
    const showSummary = which === 'summary';
    if (showSummary) {
      summaryPanel?.classList.remove('hidden');
      transcriptPanel?.classList.add('hidden');
    } else {
      summaryPanel?.classList.add('hidden');
      transcriptPanel?.classList.remove('hidden');
    }
    // Update aria-pressed only (styling handled via .panel-toggle CSS)
    summaryBtn?.setAttribute('aria-pressed', String(showSummary));
    transcriptBtn?.setAttribute('aria-pressed', String(!showSummary));
  };

  const maybeLoadTranscript = async () => {
    if (!transcriptLoadedFlag && SHOW_TRANSCRIPT_PANEL !== false) {
      await loadTranscriptIntoPopup(tab?.url);
      transcriptLoadedFlag = true;
      const container = document.getElementById('transcriptContainer');
      const noMsg = document.getElementById('noTranscriptMsg');
      if (container && container.classList.contains('hidden') && noMsg) noMsg.classList.remove('hidden');
    }
  };

  summaryBtn?.addEventListener('click', () => {
    setActive('summary');
  });
  transcriptBtn?.addEventListener('click', async () => {
    setActive('transcript');
    await maybeLoadTranscript();
  });

  // Dropdown menu actions
  // Mode & Detail DaisyUI dropdown logic (syncs to hidden selects for existing logic)
  const modeDropdownBtn = document.getElementById('modeDropdown') as HTMLDivElement | null;
  const modeDropdownLabel = document.getElementById('modeDropdownLabel') as HTMLSpanElement | null;
  const modeMenu = document.getElementById('modeMenu') as HTMLUListElement | null;
  const detailDropdownBtn = document.getElementById('detailDropdown') as HTMLDivElement | null;
  const detailDropdownLabel = document.getElementById('detailDropdownLabel') as HTMLSpanElement | null;
  const detailMenu = document.getElementById('detailMenu') as HTMLUListElement | null;

  const closeAllMenus = () => {
    modeDropdownBtn?.parentElement?.classList.remove('dropdown-open');
    detailDropdownBtn?.parentElement?.classList.remove('dropdown-open');
  };

  const attachDropdown = (
    btn: HTMLDivElement | null,
    label: HTMLSpanElement | null,
    menu: HTMLUListElement | null,
    select: HTMLSelectElement | null,
    attr: string
  ) => {
    if (!btn || !label || !menu || !select) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrapper = btn.parentElement;
      const willOpen = !wrapper?.classList.contains('dropdown-open');
      closeAllMenus();
      if (willOpen) wrapper?.classList.add('dropdown-open');
    });
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const val = (a as HTMLElement).getAttribute(attr);
        if (!val) return;
        select.value = val;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        label.textContent = a.textContent || val;
        btn.parentElement?.classList.remove('dropdown-open');
      });
    });
  };

  attachDropdown(modeDropdownBtn, modeDropdownLabel, modeMenu, modeSelect, 'data-mode');
  attachDropdown(detailDropdownBtn, detailDropdownLabel, detailMenu, detailLevelSel, 'data-detail');

  // Initialize labels from selects
  if (modeDropdownLabel && modeSelect) modeDropdownLabel.textContent = modeSelect.selectedOptions[0]?.textContent || modeSelect.value;
  if (detailDropdownLabel && detailLevelSel) detailDropdownLabel.textContent = detailLevelSel.selectedOptions[0]?.textContent || detailLevelSel.value;

  document.addEventListener('click', () => closeAllMenus());

  // Initial state (summary visible)
  setActive('summary');
  // Optionally hide transcript button if feature disabled
  if (SHOW_TRANSCRIPT_PANEL === false) {
    transcriptBtn?.classList.add('hidden');
  }

  // Button actions
  document.getElementById('tbCopy')?.addEventListener('click', () => {
    const container = document.getElementById('transcriptContainer') as any;
    const full = container?._fullTranscript as string | undefined;
    if (!full) return;
    navigator.clipboard.writeText(full).then(() => setStatus('Transcript copied')).catch(() => setStatus('Copy failed'));
    setTimeout(() => setStatus(''), 1500);
  });
  document.getElementById('tbDownload')?.addEventListener('click', () => {
    const container = document.getElementById('transcriptContainer') as any;
    const cues = container?._cues as StoredTranscript['cues'] | undefined;
    if (!cues?.length) return;
    const lines = cues.map(c => `[${formatTs(c.startTime)} - ${formatTs(c.endTime)}] ${c.text}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transcript.txt';
    a.click();
  });
  document.getElementById('tbCopyTs')?.addEventListener('click', () => {
    const container = document.getElementById('transcriptContainer') as any;
    const cues = container?._cues as StoredTranscript['cues'] | undefined;
    if (!cues?.length) return;
    const lines = cues.map(c => `[${formatTs(c.startTime)}] ${c.text}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => setStatus('Copied w/ timestamps')).catch(() => setStatus('Copy failed'));
    setTimeout(() => setStatus(''), 1500);
  });
  document.getElementById('tbExpand')?.addEventListener('click', (e) => {
    const btnToggle = e.currentTarget as HTMLButtonElement;
    const expanded = btnToggle.getAttribute('aria-pressed') === 'true';
    const container = document.getElementById('transcriptContainer') as any;
    const preview = document.getElementById('transcriptPreview');
    if (!preview) return;
    if (!expanded) {
      preview.classList.remove('max-h-80');
      preview.classList.add('max-h-[800px]', 'overflow-y-auto');
      btnToggle.setAttribute('aria-pressed', 'true');
      btnToggle.setAttribute('data-expanded', 'true');
      persistExpandState(container?._videoId, true);
    } else {
      preview.classList.remove('max-h-[800px]');
      preview.classList.add('max-h-80');
      btnToggle.setAttribute('aria-pressed', 'false');
      btnToggle.setAttribute('data-expanded', 'false');
      persistExpandState(container?._videoId, false);
    }
  });

  // Timestamps & compact toggle buttons (aria-pressed state)
  const tsBtn = document.getElementById('tbToggleTs');
  const compactBtn = document.getElementById('tbCompact');
  const rerender = () => {
    const container = document.getElementById('transcriptContainer') as any;
    const content = document.getElementById('transcriptContent');
    const cues = container?._cues as StoredTranscript['cues'] | undefined;
    if (!cues || !content) return;
    const showTs = tsBtn ? tsBtn.getAttribute('aria-pressed') !== 'false' : true;
    const compact = compactBtn ? compactBtn.getAttribute('aria-pressed') === 'true' : false;
    const searchInput = document.getElementById('transcriptSearch') as HTMLInputElement | null;
    const term = searchInput?.value.trim();
    (content as HTMLElement).innerHTML = buildTranscriptHtml(cues, { showTs, compact, highlight: term });
  };
  const togglePressed = (btn: HTMLElement | null) => {
    if (!btn) return;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!pressed));
  };
  tsBtn?.addEventListener('click', () => { togglePressed(tsBtn); rerender(); });
  compactBtn?.addEventListener('click', () => { togglePressed(compactBtn); rerender(); });

  // Search interaction
  const searchInput = document.getElementById('transcriptSearch') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim();
      const container = document.getElementById('transcriptContainer') as any;
      const full = container?._fullTranscript as string | undefined;
      const content = document.getElementById('transcriptContent');
      if (!full || !content) return;
      // Rerender always handles highlight logic
      rerender();
    });
  }

  // Theme toggle
  const { THEME } = await chrome.storage.sync.get({ THEME: 'gistlight' });
  const applyTheme = (t: string) => {
    document.documentElement.setAttribute('data-theme', t);
  };
  applyTheme(THEME);
  const themeToggleBtn = document.getElementById('themeToggle');
  themeToggleBtn?.addEventListener('click', async () => {
    try {
      const current = document.documentElement.getAttribute('data-theme') || 'gistlight';
      const next = current === 'gistlight' ? 'dark' : 'gistlight';
      applyTheme(next);
      await chrome.storage.sync.set({ THEME: next });
    } catch {/* ignore */ }
  });
};

// --- Utility functions ---
const formatTs = (s: number): string => {
  const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${sec.toString().padStart(2, '0')}`;
};

const persistExpandState = async (videoId?: string, expanded?: boolean) => {
  if (!videoId) return;
  try {
    const { EXPANDED_TRANSCRIPTS } = await chrome.storage.local.get({ EXPANDED_TRANSCRIPTS: {} as Record<string, boolean> });
    EXPANDED_TRANSCRIPTS[videoId] = !!expanded;
    await chrome.storage.local.set({ EXPANDED_TRANSCRIPTS });
  } catch { /* ignore */ }
};

init().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  setStatus(msg);
});
