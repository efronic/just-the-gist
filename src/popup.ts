const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const setStatus = (msg?: string) => {
  const el = document.getElementById('status') as HTMLElement | null;
  if (!el) return;
  const content = msg?.trim() || '';
  el.textContent = content;
  if (content) el.classList.remove('hidden'); else el.classList.add('hidden');
};

// Build adaptive success icon SVG (square + check) that inverts relative to button background.
const buildSuccessIcon = (btn: HTMLButtonElement): string => {
  // Compute background color from computed style (fallback to primary colors via CSS vars)
  const cs = getComputedStyle(btn);
  // Attempt to parse background-color; if transparent, fallback to theme primary color var
  let bg = cs.backgroundColor || '';
  if (!bg || /transparent|rgba\(0, 0, 0, 0\)/i.test(bg)) {
    // DaisyUI variable-based theme (approx) – attempt reading --p / --pc (primary / primary-content)
    const root = getComputedStyle(document.documentElement);
    const p = root.getPropertyValue('--p').trim();
    if (p) bg = p;
  }
  // Parse rgb/rgba
  const rgbMatch = bg.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  let luminance = 0.15; // default assume darkish
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255;
    const g = parseInt(rgbMatch[2], 10) / 255;
    const b = parseInt(rgbMatch[3], 10) / 255;
    const lin = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  const isDark = luminance < 0.5;
  // Colors: square fill = lighter surface if dark button else primary (or success) toned; outline not required (flat glyph)
  // We'll use CSS vars so theme changes propagate: --p (primary), --pc (primary content), --b1 (base-100), --n (neutral)
  const root = getComputedStyle(document.documentElement);
  const primary = root.getPropertyValue('--p').trim() || root.getPropertyValue('--color-primary').trim();
  const primaryContent = root.getPropertyValue('--pc').trim() || root.getPropertyValue('--color-primary-fg').trim();
  const base100 = root.getPropertyValue('--b1').trim() || root.getPropertyValue('--color-surface-alt').trim();
  const neutral = root.getPropertyValue('--n').trim() || root.getPropertyValue('--color-text').trim();
  const darkFill = primary; // when light button we invert
  const lightFill = base100 || primaryContent;
  const fill = isDark ? lightFill : darkFill;
  const check = isDark ? primary : primaryContent || neutral;
  // Provided SVG path adapted and scaled down; we remove large outer transform context.
  return `<span class="inline-flex items-center justify-center w-4 h-4" aria-hidden="true"><svg viewBox="0 0 21 21" class="w-4 h-4" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="20" height="20" rx="2.5" fill="${fill}" stroke="${check}" stroke-width="0.5"/><path d="M7.9 10.6l2.1 2 4.4-4.2 1.1 1.3-5.5 5.4-3.3-3.2 1.2-1.3z" fill="${check}"/></svg></span>`;
};

// Central scroll state updater: only allow scrolling once there is content.
const updateScrollState = () => {
  const outputEl = document.getElementById('output');
  const summaryPanel = document.getElementById('summaryTabPanel');
  const transcriptContainer = document.getElementById('transcriptContainer');
  // Summary present if output visible and has non-empty text
  const hasSummary = !!(outputEl && !outputEl.classList.contains('hidden') && outputEl.textContent && outputEl.textContent.trim().length);
  // Transcript considered present if container is visible (content already rendered by loader)
  const hasTranscript = !!(transcriptContainer && !transcriptContainer.classList.contains('hidden'));

  // For summary output element: toggle overflow only when we actually have content.
  if (outputEl) {
    if (hasSummary) {
      outputEl.classList.add('overflow-auto');
    } else {
      outputEl.classList.remove('overflow-auto');
    }
  }
  // Panel itself keeps overflow hidden always (children manage scroll). If neither summary nor transcript, ensure no stray scrollbars.
  if (summaryPanel && !hasSummary) {
    // Nothing to show yet; remove potential bottom spacing artifacts if any future changes add them.
  }
};

// Lightweight markdown-ish formatter for summary (bold, italic, lists, headings, paragraphs)
const formatSummary = (raw: string): string => {
  if (!raw.trim()) return '';
  let txt = raw.replace(/\r\n?/g, '\n');
  // Escape basic HTML first
  txt = txt.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  // Bold **text**
  txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  txt = txt.replace(/(?<!\*)\*(?!\*)([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  const lines = txt.split(/\n+/);
  const blocks: string[] = [];
  let listBuffer: string[] = [];
  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push('<ul class="list-disc ml-5 mb-3 marker:text-slate-400 sp-list">' + listBuffer.join('') + '</ul>');
    listBuffer = [];
  };
  for (const line of lines) {
    const l = line.trim();
    if (!l) { flushList(); continue; }
    // Heading heuristic: lines starting with # or ending with : and short
    if (/^#{1,4}\s+/.test(l)) {
      flushList();
      const level = Math.min(4, l.match(/^#+/)![0].length);
      const content = l.replace(/^#{1,4}\s+/, '');
      blocks.push(`<h${level} class="mt-4 mb-2 font-semibold text-slate-700 first:mt-0">${content}</h${level}>`);
      continue;
    }
    if (/^[\-\*]\s+/.test(l)) { // unordered list item
      listBuffer.push('<li class="mb-1">' + l.replace(/^[\-\*]\s+/, '') + '</li>');
      continue;
    }
    if (/^\d+\.\s+/.test(l)) { // ordered list (flush unordered, treat as ordered block)
      flushList();
      const match = l.match(/^(\d+)\.\s+(.*)$/);
      if (match) {
        // Simple single-item ordered list accumulation not implemented; treat each numeric line as its own list for now
        blocks.push('<ol class="list-decimal ml-5 mb-3 marker:text-slate-400 sp-list"><li>' + match[2] + '</li></ol>');
        continue;
      }
    }
    flushList();
    // Paragraph
    blocks.push('<p class="mb-3 last:mb-0 sp-p">' + l + '</p>');
  }
  flushList();
  return blocks.join('\n');
};

const setOutput = (text?: string) => {
  const el = document.getElementById('output') as HTMLElement | null;
  const placeholder = document.getElementById('summaryPlaceholder');
  if (!el) return;
  const content = text?.trim() || '';
  if (content) {
    el.innerHTML = formatSummary(content);
    el.classList.remove('hidden');
    placeholder && placeholder.classList.add('hidden');
  } else {
    el.innerHTML = '';
    el.classList.add('hidden');
    placeholder && placeholder.classList.remove('hidden');
  }
  updateScrollState();
};

import type { SummarizeMode } from './types/extract';
import { SUMMARIZE_MODE } from './types/extract';
import { getYouTubeVideoId as parseYtVideoId } from './yt/captions.js';

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

// --- Summary persistence ---
interface SummaryCacheEntry {
  text: string;
  raw?: any;
  savedAt: number;
}

const buildSummaryKey = (url?: string | null): string | null => {
  if (!url) return null;
  const vid = extractVideoIdFromUrl(url);
  if (vid) return `summary_yt_${vid}`;
  try {
    const u = new URL(url);
    return `summary_page_${u.origin}${u.pathname}`;
  } catch { return `summary_page_${url}`; }
};

const saveSummaryForUrl = async (url?: string | null, entry?: { text?: string; raw?: any; }): Promise<void> => {
  if (!url || !entry?.text) return;
  const key = buildSummaryKey(url);
  if (!key) return;
  try {
    let raw: any = undefined;
    const src = entry.raw;
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      try {
        raw = { ...src };
        if (raw?.extract?.video?.cues) {
          raw.extract = { ...raw.extract, video: { ...raw.extract.video } };
          delete raw.extract.video.cues;
        }
        const test = JSON.stringify(raw);
        if (test.length > 300_000) raw = undefined;
      } catch { raw = undefined; }
    }
    const payload: SummaryCacheEntry = { text: String(entry.text), raw, savedAt: Date.now() };
    await chrome.storage.local.set({ [key]: payload });
  } catch { /* ignore */ }
};

const loadSummaryForUrl = async (url?: string | null): Promise<SummaryCacheEntry | undefined> => {
  if (!url) return undefined;
  const key = buildSummaryKey(url);
  if (!key) return undefined;
  try {
    const store = await chrome.storage.local.get(key);
    return store[key] as SummaryCacheEntry | undefined;
  } catch { return undefined; }
};

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

// Ensure transcript is available in local cache for the current URL; fetch via content script if missing, then render
const ensureTranscriptAvailable = async (url?: string | null): Promise<void> => {
  const activeTab = await getActiveTab();
  const tabId = activeTab?.id;
  const vidFromUrl = (url ? parseYtVideoId(url) : null) || extractVideoIdFromUrl(url);
  const container = document.getElementById('transcriptContainer');
  const placeholder = document.getElementById('transcriptPlaceholder');
  if (!tabId) {
    container?.classList.add('hidden');
    placeholder?.classList.remove('hidden');
    return;
  }

  // If we already have a cache key guess and it's populated, render directly
  if (vidFromUrl) {
    const key = `yt_transcript_${vidFromUrl}`;
    try {
      const store = await chrome.storage.local.get(key);
      const cached = store?.[key] as (StoredTranscript | undefined);
      if (cached?.cues?.length) {
        await loadTranscriptIntoPopup(url || undefined);
        return;
      }
    } catch { /* ignore */ }
  }

  // Not cached – ask the content script to extract (it will also try to fetch YT captions if needed)
  try {
    setStatus('Fetching transcript...');
    let extract: any | undefined;
    try {
      extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode: SUMMARIZE_MODE.video });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
        // Inject content script then retry once
        await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
        try {
          extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode: SUMMARIZE_MODE.video });
        } catch {
          // Soft retry after short delay
          await new Promise(r => setTimeout(r, 120));
          await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
          extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode: SUMMARIZE_MODE.video });
        }
      } else {
        throw err;
      }
    }
    if (extract && extract.video && extract.video.hasVideo) {
      const v = extract.video;
      const videoId = v.videoId || parseYtVideoId(v.pageUrl || url || '') || vidFromUrl || undefined;
      if (videoId && v.cues?.length) {
        const key = `yt_transcript_${videoId}`;
        try {
          await chrome.storage.local.set({ [key]: { cues: v.cues, lang: v.transcriptLanguage, truncated: v.transcriptTruncated } });
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  setStatus('');
  await loadTranscriptIntoPopup(url || undefined);
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
    const tsLabel = opts.showTs ? `<span class="ts-badge select-none">${formatTs(first.startTime)}</span>` : '';
    const spacing = opts.compact ? '' : ' tpara';
    parts.push(`<p class="m-0${spacing}">${tsLabel}<span class="ttext">${body}</span></p>`);
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
  const placeholder = document.getElementById('transcriptPlaceholder');
  if (!container || !previewEl || !metaEl) return;
  if (!vid) {
    container.classList.add('hidden');
    placeholder && placeholder.classList.remove('hidden');
    return;
  }
  const key = `yt_transcript_${vid}`;
  try {
    const store = await chrome.storage.local.get(key);
    const entry: StoredTranscript | undefined = store[key];
    if (!entry || !entry.cues?.length) {
      container.classList.add('hidden');
      placeholder && placeholder.classList.remove('hidden');
      return;
    }
    placeholder && placeholder.classList.add('hidden');
    const fullText = entry.cues.map(c => c.text).join(' ');
    // Render as rich paragraphs using button toggle state (aria-pressed)
    const showTsBtn = document.getElementById('tbToggleTs');
    const compactBtn = document.getElementById('tbCompact');
    const showTs = showTsBtn ? showTsBtn.getAttribute('aria-pressed') !== 'false' : true;
    const compact = compactBtn ? compactBtn.getAttribute('aria-pressed') === 'true' : false;
    if (contentEl) (contentEl as HTMLElement).innerHTML = buildTranscriptHtml(entry.cues, { showTs, compact });
    metaEl.textContent = `Language: ${entry.lang || 'unknown'} • Cues: ${entry.cues.length}${entry.truncated ? ' • (truncated at capture)' : ''}`;
    container.classList.remove('hidden');
    // Ensure it becomes a flex column only when revealed so nested preview (flex-1) uses remaining height correctly
    container.classList.add('flex', 'flex-col', 'flex-1', 'min-h-0');
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
    updateScrollState();
  } catch { /* ignore */ }
};

const init = async () => {
  const tab = await getActiveTab();
  // Attempt to restore previously saved summary for this tab
  try {
    const saved = await loadSummaryForUrl(tab?.url);
    if (saved?.text) {
      setOutput(saved.text);
      const existing = document.getElementById('rawDetails');
      if (saved.raw && !existing) {
        const outputEl = document.getElementById('output');
        if (outputEl) {
          const details = document.createElement('details');
          details.id = 'rawDetails';
          details.className = 'mt-2 text-[10px]';
          const summary = document.createElement('summary');
          summary.textContent = 'Show raw data';
          summary.className = 'cursor-pointer select-none text-primary hover:underline font-medium';
          const pre = document.createElement('pre');
          pre.className = 'mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2';
          try { pre.textContent = JSON.stringify(saved.raw, null, 2); } catch { /* ignore */ }
          details.appendChild(summary);
          details.appendChild(pre);
          outputEl.insertAdjacentElement('afterend', details);
        }
      }
    }
  } catch { /* ignore */ }
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

  // Mode select is now static in markup (default Auto)
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  // Initialize detail level dropdown from saved option
  const detailLevelSelect = document.getElementById('detailLevelSelect') as HTMLSelectElement | null;
  if (detailLevelSelect) {
    detailLevelSelect.value = (DETAIL_LEVEL || 'standard').trim();
  }
  const apiSection = document.getElementById('apiSection') as HTMLElement;
  const summarizeBtn = document.getElementById('summarizeBtn') as HTMLButtonElement; // legacy variable name retained for existing click handler logic
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
      if (apiSection) apiSection.style.display = 'none';
      summarizeBtn.disabled = false;
      setStatus('Ready.');
      updateSummarizeEnabled();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      apiStatus && (apiStatus.textContent = msg);
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
      // Optionally remove flex classes when hidden (not required, but keeps DOM tidy)
      transcriptPanel?.classList.remove('flex', 'flex-col');
    } else {
      summaryPanel?.classList.add('hidden');
      transcriptPanel?.classList.remove('hidden');
      // Ensure transcript panel participates in flex sizing chain only when visible
      transcriptPanel?.classList.add('flex', 'flex-col');
    }
    // Update aria-pressed only (styling handled via .panel-toggle CSS)
    summaryBtn?.setAttribute('aria-pressed', String(showSummary));
    transcriptBtn?.setAttribute('aria-pressed', String(!showSummary));
  };

  const maybeLoadTranscript = async () => {
    if (!transcriptLoadedFlag && SHOW_TRANSCRIPT_PANEL !== false) {
      await ensureTranscriptAvailable(tab?.url);
      transcriptLoadedFlag = true;
      const container = document.getElementById('transcriptContainer');
      const placeholder = document.getElementById('transcriptPlaceholder');
      if (container && container.classList.contains('hidden') && placeholder) placeholder.classList.remove('hidden');
    }
  };

  summaryBtn?.addEventListener('click', () => {
    setActive('summary');
  });
  transcriptBtn?.addEventListener('click', async () => {
    setActive('transcript');
    // Show spinner on the Transcript button while fetching
    const btn = transcriptBtn as HTMLButtonElement;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading loading-spinner loading-xs mr-1"></span>Transcript';
    try {
      await maybeLoadTranscript();
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  // Mode selection enable logic for native select
  const updateSummarizeEnabled = () => {
    // If API section visible & no key, keep disabled; else enable (mode always defaults to Auto)
    if (apiSection && apiSection.style.display !== 'none' && !GEMINI_API_KEY) {
      summarizeBtn.disabled = true; return;
    }
    summarizeBtn.disabled = false;
  };
  modeSelect?.addEventListener('change', updateSummarizeEnabled);
  updateSummarizeEnabled();

  // Track transcript load once per session
  let transcriptLoadedFlag = false;

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

  // Summarize action handler (restored after UI refactor)
  summarizeBtn?.addEventListener('click', async () => {
    if (summarizeBtn.disabled) return;
    try {
      const originalLabel = summarizeBtn.innerHTML;
      const mode = (modeSelect?.value || 'auto') as SummarizeMode;
      const detailSelect = document.getElementById('detailLevelSelect') as HTMLSelectElement | null;
      const detailLevel = (detailSelect?.value || 'standard').trim();

      // Disable interactive controls
      summarizeBtn.disabled = true;
      modeSelect && (modeSelect.disabled = true);
      detailSelect && (detailSelect.disabled = true);

      // Clear any prior status (we only show errors now)
      setStatus('');
      setOutput('');
      // Show spinner only (no animated dots)
      let cancelled = false;
      summarizeBtn.innerHTML = '<span class="loading loading-spinner loading-xs mr-1"></span>Summarizing';

      try {
        const result = await summarize(mode, detailLevel);
        let summaryText = '';
        if (typeof result === 'string') {
          summaryText = result;
        } else if (result && typeof result === 'object') {
          // Prefer top-level text property
          if ('text' in result && typeof (result as any).text === 'string') {
            summaryText = (result as any).text;
          } else if ((result as any).summary) {
            summaryText = String((result as any).summary);
          } else {
            summaryText = JSON.stringify(result, null, 2);
          }
        }
        setOutput(summaryText);

        // Persist summary and compact raw for this tab URL
        try {
          const currentTab = await getActiveTab();
          await saveSummaryForUrl(currentTab?.url, { text: summaryText, raw: result });
        } catch { /* ignore */ }

        // Attach raw JSON viewer (on demand) below output if structured object
        if (result && typeof result === 'object') {
          // Persist transcript cues (if a YouTube video) so Transcript tab can render even if user opens it after summarization
          try {
            const extractObj: any = (result as any).extract;
            const videoObj: any = extractObj?.video;
            if (videoObj && videoObj.hasVideo && videoObj.cues?.length && (videoObj.pageUrl || videoObj.videoId)) {
              const videoId = videoObj.videoId || extractVideoIdFromUrl(videoObj.pageUrl);
              if (videoId) {
                const cacheKey = `yt_transcript_${videoId}`;
                await chrome.storage.local.set({ [cacheKey]: { cues: videoObj.cues, lang: videoObj.transcriptLanguage, truncated: videoObj.transcriptTruncated } });
                try {
                  if (typeof transcriptLoadedFlag !== 'undefined') {
                    (transcriptLoadedFlag as any) = false;
                    const transcriptPanel = document.getElementById('transcriptTabPanel');
                    if (transcriptPanel && !transcriptPanel.classList.contains('hidden')) {
                      await loadTranscriptIntoPopup(videoObj.pageUrl || location.href);
                    }
                  }
                } catch { /* ignore */ }
              }
            }
          } catch { /* ignore */ }
          const existing = document.getElementById('rawDetails');
          if (!existing) {
            const outputEl = document.getElementById('output');
            if (outputEl) {
              const details = document.createElement('details');
              details.id = 'rawDetails';
              details.className = 'mt-2 text-[10px]';
              const summary = document.createElement('summary');
              summary.textContent = 'Show raw data';
              summary.className = 'cursor-pointer select-none text-primary hover:underline font-medium';
              const pre = document.createElement('pre');
              pre.className = 'mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2';
              pre.textContent = JSON.stringify(result, null, 2);
              details.appendChild(summary);
              details.appendChild(pre);
              outputEl.insertAdjacentElement('afterend', details);
            }
          } else {
            // Update existing raw details if already present
            const pre = existing.querySelector('pre');
            if (pre) pre.textContent = JSON.stringify(result, null, 2);
          }
        }
      } finally {
        cancelled = true;
        // Replace spinner with a check icon to indicate success
        // Adaptive success icon using provided SVG concept (inverts colors based on button bg luminance)
        summarizeBtn.innerHTML = buildSuccessIcon(summarizeBtn) + '<span class="ml-1">Summarize</span>';
        // After a short delay restore original label
        setTimeout(() => {
          if (!summarizeBtn.disabled) {
            summarizeBtn.innerHTML = originalLabel;
          } else {
            summarizeBtn.innerHTML = originalLabel; // fallback
          }
        }, 1200);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      summarizeBtn.innerHTML = '<span class="text-error" aria-hidden="true">⚠️</span><span class="ml-1">Retry</span>';
      setStatus(`Error: ${msg}`);
    } finally {
      summarizeBtn.disabled = false;
      modeSelect && (modeSelect.disabled = false);
      const detailSelect = document.getElementById('detailLevelSelect') as HTMLSelectElement | null;
      detailSelect && (detailSelect.disabled = false);
    }
  });

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

  // --- Dynamic transcript sizing ---
  const transcriptPreview = document.getElementById('transcriptPreview');
  const recomputeTranscriptHeight = () => {
    if (!transcriptPreview) return;
    if (transcriptPreview.classList.contains('dynamic-resize-disabled')) return; // skip when expanded override
    // Available vertical space: popup body height - top offset - bottom padding margin
    const bodyRect = document.body.getBoundingClientRect();
    const rect = transcriptPreview.getBoundingClientRect();
    const bottomPadding = 12; // small buffer
    const available = bodyRect.height - rect.top - bottomPadding;
    // Clamp min / max
    const clamped = Math.max(180, Math.min(available, 1200));
    transcriptPreview.style.maxHeight = clamped + 'px';
  };
  const scheduleRecompute = () => requestAnimationFrame(recomputeTranscriptHeight);
  window.addEventListener('resize', scheduleRecompute);
  const observer = new ResizeObserver(() => scheduleRecompute());
  observer.observe(document.body);
  scheduleRecompute();

  // Integrate with expand button: when expanded, remove maxHeight limit; when collapsed restore dynamic behavior
  const expandBtn = document.getElementById('tbExpand');
  expandBtn?.addEventListener('click', () => {
    if (!transcriptPreview) return;
    const pressed = expandBtn.getAttribute('aria-pressed') === 'true';
    if (!pressed) {
      // Will become expanded
      transcriptPreview.classList.add('dynamic-resize-disabled');
      transcriptPreview.style.maxHeight = 'none';
    } else {
      transcriptPreview.classList.remove('dynamic-resize-disabled');
      transcriptPreview.style.maxHeight = '';
      scheduleRecompute();
    }
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
