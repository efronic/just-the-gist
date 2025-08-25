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
    // Render as rich paragraphs
    const showTs = (document.getElementById('transcriptShowTs') as HTMLInputElement | null)?.checked ?? true;
    const compact = (document.getElementById('transcriptCompact') as HTMLInputElement | null)?.checked ?? false;
    (previewEl as HTMLElement).innerHTML = buildTranscriptHtml(entry.cues, { showTs, compact });
    metaEl.textContent = `Language: ${entry.lang || 'unknown'} • Cues: ${entry.cues.length}${entry.truncated ? ' • (truncated at capture)' : ''}`;
    container.classList.remove('hidden');
    // Attach data attributes for later copy/download
    (container as any)._fullTranscript = fullText;
    (container as any)._cues = entry.cues;
    (container as any)._videoId = vid;

    // Restore expand state for this video if stored
    const { EXPANDED_TRANSCRIPTS } = await chrome.storage.local.get({ EXPANDED_TRANSCRIPTS: {} as Record<string, boolean> });
    const expanded = !!EXPANDED_TRANSCRIPTS[vid];
    const toggleBtn = document.getElementById('toggleTranscript');
    if (expanded) {
      previewEl.classList.remove('max-h-32');
      previewEl.classList.add('max-h-[600px]', 'overflow-y-auto');
      toggleBtn && toggleBtn.setAttribute('data-expanded', 'true');
      if (toggleBtn) toggleBtn.textContent = 'Collapse';
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
  // Tabs setup
  const tabSummaryBtn = document.getElementById('tabSummary');
  const tabTranscriptBtn = document.getElementById('tabTranscript');
  const summaryTab = document.getElementById('summaryTab');
  const transcriptPanelWrapper = document.getElementById('transcriptTabPanel');
  let transcriptLoadedFlag = false;
  const setActive = (active: 'summary' | 'transcript') => {
    if (active === 'summary') {
      tabSummaryBtn?.classList.add('tab-active');
      tabSummaryBtn?.setAttribute('aria-selected', 'true');
      tabTranscriptBtn?.classList.remove('tab-active');
      tabTranscriptBtn?.setAttribute('aria-selected', 'false');
      summaryTab?.classList.remove('hidden');
      transcriptPanelWrapper?.classList.add('hidden');
    } else {
      tabSummaryBtn?.classList.remove('tab-active');
      tabSummaryBtn?.setAttribute('aria-selected', 'false');
      tabTranscriptBtn?.classList.add('tab-active');
      tabTranscriptBtn?.setAttribute('aria-selected', 'true');
      summaryTab?.classList.add('hidden');
      transcriptPanelWrapper?.classList.remove('hidden');
    }
  };
  const activateTab = async (name: 'summary' | 'transcript') => {
    setActive(name);
    if (name === 'transcript' && !transcriptLoadedFlag && SHOW_TRANSCRIPT_PANEL !== false) {
      await loadTranscriptIntoPopup(tab?.url);
      transcriptLoadedFlag = true;
      const container = document.getElementById('transcriptContainer');
      const noMsg = document.getElementById('noTranscriptMsg');
      if (container && container.classList.contains('hidden') && noMsg) noMsg.classList.remove('hidden');
    }
  };
  tabSummaryBtn?.addEventListener('click', () => activateTab('summary'));
  tabTranscriptBtn?.addEventListener('click', () => activateTab('transcript'));
  // Default to summary tab
  await activateTab('summary');

  // Button actions
  document.getElementById('copyTranscript')?.addEventListener('click', () => {
    const container = document.getElementById('transcriptContainer') as any;
    const full = container?._fullTranscript as string | undefined;
    if (!full) return;
    navigator.clipboard.writeText(full).then(() => setStatus('Transcript copied')).catch(() => setStatus('Copy failed'));
    setTimeout(() => setStatus(''), 1500);
  });
  document.getElementById('downloadTranscript')?.addEventListener('click', () => {
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
  document.getElementById('copyTranscriptTs')?.addEventListener('click', () => {
    const container = document.getElementById('transcriptContainer') as any;
    const cues = container?._cues as StoredTranscript['cues'] | undefined;
    if (!cues?.length) return;
    const lines = cues.map(c => `[${formatTs(c.startTime)}] ${c.text}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => setStatus('Copied w/ timestamps')).catch(() => setStatus('Copy failed'));
    setTimeout(() => setStatus(''), 1500);
  });
  document.getElementById('toggleTranscript')?.addEventListener('click', (e) => {
    const btnToggle = e.currentTarget as HTMLButtonElement;
    const expanded = btnToggle.getAttribute('data-expanded') === 'true';
    const container = document.getElementById('transcriptContainer') as any;
    const previewEl = document.getElementById('transcriptPreview');
    const full = container?._fullTranscript as string | undefined;
    if (!previewEl || !full) return;
    if (!expanded) {
      previewEl.classList.remove('max-h-32');
      previewEl.classList.add('max-h-[600px]', 'overflow-y-auto');
      btnToggle.textContent = 'Collapse';
      btnToggle.setAttribute('data-expanded', 'true');
      persistExpandState(container?._videoId, true);
    } else {
      // Collapse: keep full text but restrict height (scroll remains available)
      previewEl.classList.remove('max-h-[600px]');
      previewEl.classList.add('max-h-32');
      btnToggle.textContent = 'Expand';
      btnToggle.setAttribute('data-expanded', 'false');
      persistExpandState(container?._videoId, false);
    }
  });

  // Timestamps & compact toggles
  const tsCheckbox = document.getElementById('transcriptShowTs') as HTMLInputElement | null;
  const compactCheckbox = document.getElementById('transcriptCompact') as HTMLInputElement | null;
  const rerender = () => {
    const container = document.getElementById('transcriptContainer') as any;
    const previewEl = document.getElementById('transcriptPreview');
    const cues = container?._cues as StoredTranscript['cues'] | undefined;
    if (!cues || !previewEl) return;
    const showTs = tsCheckbox?.checked ?? true;
    const compact = compactCheckbox?.checked ?? false;
    const searchInput = document.getElementById('transcriptSearch') as HTMLInputElement | null;
    const term = searchInput?.value.trim();
    (previewEl as HTMLElement).innerHTML = buildTranscriptHtml(cues, { showTs, compact, highlight: term });
  };
  tsCheckbox?.addEventListener('change', rerender);
  compactCheckbox?.addEventListener('change', rerender);

  // Search interaction
  const searchInput = document.getElementById('transcriptSearch') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim();
      const container = document.getElementById('transcriptContainer') as any;
      const full = container?._fullTranscript as string | undefined;
      const previewEl = document.getElementById('transcriptPreview');
      if (!full || !previewEl) return;
      if (!term) { rerender(); return; }
      rerender();
    });
  }
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
