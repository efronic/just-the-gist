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
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash'
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      btn.disabled = false;
    }
  });
};

init().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  setStatus(msg);
});
