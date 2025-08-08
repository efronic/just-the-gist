import { callGemini } from './gemini.js';

// Create context menu to summarize page
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gemini-summarize',
    title: 'Summarize with Gemini',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'gemini-summarize') return;
  if (!tab || !tab.id) return;
  await handleSummarizeRequest({ tabId: tab.id, mode: 'auto' });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'SUMMARIZE_TAB') {
    handleSummarizeRequest({ tabId: msg.tabId, mode: msg.mode || 'auto' })
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true; // keep channel open
  }
});

async function handleSummarizeRequest({ tabId, mode }) {
  // 1) Ask content script for page extraction
  const extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode });

  // 2) Load API config
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-1.5-flash'
  });
  if (!GEMINI_API_KEY) {
    throw new Error('Missing API key. Set it in the extension Options.');
  }

  // 3) Build prompt
  const prompt = buildPrompt(extract, mode);

  // 4) Call Gemini
  const text = await callGemini({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    input: prompt
  });

  return { text, extract };
}

function buildPrompt(extract, mode) {
  const { url, title, mainText, video } = extract;
  const header = `You are a concise expert summarizer. Summarize the content at the URL below.\n\nURL: ${url}\nTitle: ${title}\nMode: ${mode}`;

  const videoBlock = video?.hasVideo
    ? `\n\nVideo detected: yes\nVideo title: ${video.title || ''}\nVideo source: ${video.src || ''}\nVideo durationSec: ${video.durationSec ?? ''}\nVideo text tracks (first 30 cues if any):\n${(video.cues || []).slice(0, 30).map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${c.text}`).join('\n')}`
    : `\n\nVideo detected: no`;

  const contentBlock = `\n\nExtracted page text (truncated):\n${(mainText || '').slice(0, 8000)}`;

  const task = `\n\nTask: Provide a high-quality summary.\n- If an actual video transcript is available, prioritize it; otherwise use page content.\n- Include 5-10 key bullet points, a brief TL;DR (1-2 sentences), and any action items or references.\n- Keep it factual and neutral.\n- If information is insufficient, state assumptions clearly.`;

  return `${header}${videoBlock}${contentBlock}${task}`;
}
