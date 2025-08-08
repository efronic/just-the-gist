async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
}

function setOutput(text) {
  const el = document.getElementById('output');
  el.textContent = text || '';
}

async function summarize(mode) {
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
  document.getElementById('url').textContent = tab?.url || '';

  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const btn = document.getElementById('summarizeBtn');
  btn.addEventListener('click', async () => {
    const mode = document.getElementById('mode').value;
    btn.disabled = true;
    setStatus('Summarizing…');
    setOutput('');
    try {
      const { text } = await summarize(mode);
      setOutput(text);
      setStatus('Done');
    } catch (e) {
      setStatus(e?.message || String(e));
    } finally {
      btn.disabled = false;
    }
  });
}

init().catch(err => setStatus(err?.message || String(err)));
