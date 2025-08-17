async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg?: string) {
  const el = document.getElementById('status') as HTMLElement;
  el.textContent = msg || '';
}

function setOutput(text?: string) {
  const el = document.getElementById('output') as HTMLElement;
  el.textContent = text || '';
}

async function summarize(mode: 'auto' | 'page' | 'video') {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab.');

  const resp = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE_TAB',
    tabId: tab.id,
    mode
  });

  if (!resp?.ok) throw new Error(resp?.error || 'Unknown error.');
  return resp.result;
}

async function init() {
  const tab = await getActiveTab();
  (document.getElementById('url') as HTMLElement).textContent = tab?.url || '';

  document.getElementById('openOptions')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const btn = document.getElementById('summarizeBtn') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    const mode = (document.getElementById('mode') as HTMLSelectElement).value as 'auto' | 'page' | 'video';
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
}

init().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  setStatus(msg);
});
