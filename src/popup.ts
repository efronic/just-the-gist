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

const summarize = async (mode: SummarizeMode) => {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab.');

  const resp = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE_TAB',
    tabId: tab.id,
    mode
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
    const previewLimit = 3000; // chars for initial collapsed preview
    const truncatedPreview = fullText.length > previewLimit ? fullText.slice(0, previewLimit) + '\n...[preview truncated]' : fullText;
    previewEl.textContent = truncatedPreview;
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
      previewEl.textContent = fullText;
      previewEl.classList.remove('max-h-32', 'overflow-hidden');
      toggleBtn && toggleBtn.setAttribute('data-expanded', 'true');
      if (toggleBtn) toggleBtn.textContent = 'Collapse';
    }
  } catch { /* ignore */ }
};

const init = async () => {
  const tab = await getActiveTab();
  (document.getElementById('url') as HTMLElement).textContent = tab?.url || '';

  document.getElementById('openOptions')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('openOptions2')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Load API settings to decide whether to show inline API section
  const { GEMINI_API_KEY, GEMINI_MODEL, SHOW_TRANSCRIPT_PANEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
    SHOW_TRANSCRIPT_PANEL: true
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
  btn.addEventListener('click', async () => {
    const mode = (document.getElementById('mode') as HTMLSelectElement).value as SummarizeMode;
    btn.disabled = true;
    setStatus('Summarizing…');
    setOutput('');
    try {
      const { text } = await summarize(mode);
      setOutput(text);
      setStatus('Done');
      // After summarizing, attempt to load transcript preview (cues should now be cached)
      const tab2 = await getActiveTab();
      await loadTranscriptIntoPopup(tab2?.url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      btn.disabled = false;
    }
  });

  // Initial attempt (in case the transcript was already cached from earlier run)
  if (SHOW_TRANSCRIPT_PANEL !== false) {
    await loadTranscriptIntoPopup(tab?.url);
  } else {
    const container = document.getElementById('transcriptContainer');
    container && container.classList.add('hidden');
  }

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
      previewEl.textContent = full;
      previewEl.classList.remove('max-h-32', 'overflow-hidden');
      btnToggle.textContent = 'Collapse';
      btnToggle.setAttribute('data-expanded', 'true');
      persistExpandState(container?._videoId, true);
    } else {
      const previewLimit = 3000;
      const truncatedPreview = full.length > previewLimit ? full.slice(0, previewLimit) + '\n...[preview truncated]' : full;
      previewEl.textContent = truncatedPreview;
      previewEl.classList.add('max-h-32', 'overflow-hidden');
      btnToggle.textContent = 'Expand';
      btnToggle.setAttribute('data-expanded', 'false');
      persistExpandState(container?._videoId, false);
    }
  });

  // Search interaction
  const searchInput = document.getElementById('transcriptSearch') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim();
      const container = document.getElementById('transcriptContainer') as any;
      const full = container?._fullTranscript as string | undefined;
      const previewEl = document.getElementById('transcriptPreview');
      if (!full || !previewEl) return;
      if (!term) {
        const expanded = (document.getElementById('toggleTranscript')?.getAttribute('data-expanded') === 'true');
        if (expanded) previewEl.textContent = full; else {
          const previewLimit = 3000; const truncatedPreview = full.length > previewLimit ? full.slice(0, previewLimit) + '\n...[preview truncated]' : full; previewEl.textContent = truncatedPreview;
        }
        return;
      }
      try {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        // Simple highlight by splitting and wrapping; since <pre> we can inject <mark>
        const highlighted = full.replace(regex, m => `[[HIGHLIGHT:${m}]]`);
        const safe = highlighted.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        // Re-insert marks
        const withMarks = safe.replace(/\[\[HIGHLIGHT:([\s\S]*?)\]\]/g, '<mark class="bg-yellow-200">$1</mark>');
        previewEl.innerHTML = withMarks;
      } catch { /* ignore bad regex */ }
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
