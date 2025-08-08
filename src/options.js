async function load() {
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-1.5-flash'
  });
  document.getElementById('apiKey').value = GEMINI_API_KEY || '';
  document.getElementById('model').value = GEMINI_MODEL || 'gemini-1.5-flash';
}

async function save() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('model').value;
  await chrome.storage.sync.set({ GEMINI_API_KEY: apiKey, GEMINI_MODEL: model });
  const s = document.getElementById('status');
  s.textContent = 'Saved.';
  setTimeout(() => (s.textContent = ''), 1500);
}

load();

document.getElementById('saveBtn').addEventListener('click', save);
