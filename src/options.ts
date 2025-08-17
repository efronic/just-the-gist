async function load() {
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash'
  });
  (document.getElementById('apiKey') as HTMLInputElement).value = GEMINI_API_KEY || '';
  (document.getElementById('model') as HTMLSelectElement).value = GEMINI_MODEL || 'gemini-2.5-flash';
}

async function save() {
  const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
  const model = (document.getElementById('model') as HTMLSelectElement).value;
  await chrome.storage.sync.set({ GEMINI_API_KEY: apiKey, GEMINI_MODEL: model });
  const s = document.getElementById('status') as HTMLElement;
  s.textContent = 'Saved.';
  setTimeout(() => (s.textContent = ''), 1500);
}

load().catch((err: unknown) => {
  console.warn('Options load error:', err);
});

document.getElementById('saveBtn')!.addEventListener('click', () => {
  save().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    (document.getElementById('status') as HTMLElement).textContent = msg;
  });
});
