/// <reference types="chrome" />
import { callGemini } from './gemini';
import type { ExtractedCue, ExtractedVideo, ExtractedPage, SummarizeMode } from './types/extract';
import { SUMMARIZE_MODE } from './types/extract';

// Create context menu to summarize page
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'justthegist',
    title: 'Summarize with Just The Gist',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'justthegist') return;
  if (!tab || !tab.id) return;
  await handleSummarizeRequest({ tabId: tab.id, mode: SUMMARIZE_MODE.auto });
});

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg?.type === 'SUMMARIZE_TAB') {
    handleSummarizeRequest({ tabId: msg.tabId as number, mode: (msg.mode || SUMMARIZE_MODE.auto) as SummarizeMode })
      .then(result => sendResponse({ ok: true, result }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: message });
      });
    return true; // keep channel open
  }
});

// Types moved to src/types/extract.ts

const handleSummarizeRequest = async ({ tabId, mode }: { tabId: number; mode: SummarizeMode; }) => {
  // 1) Ask content script for page extraction
  const extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;

  // 2) Load API config
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash'
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

  return { text, extract } as const;
};

const buildPrompt = (extract: ExtractedPage, mode: SummarizeMode) => {
  const { url, title, mainText, video } = extract;
  const header = `You are a concise expert summarizer. Summarize the content at the URL below.\n\nURL: ${url}\nTitle: ${title}\nMode: ${mode}`;

  const transcriptMeta = video?.hasVideo
    ? `Transcript source: ${video.transcriptSource || 'none'}${video.transcriptLanguage ? `\nTranscript language: ${video.transcriptLanguage}` : ''}${video.transcriptTruncated ? '\nTranscript truncated: yes' : ''}`
    : 'Transcript source: none';

  const cuesPreview = (video?.cues || []).slice(0, 60).map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${c.text}`).join('\n');
  const cuesBlock = video?.hasVideo
    ? `\n\nVideo detected: yes\nVideo title: ${video.title || ''}\nVideo source: ${video.src || ''}\nVideo pageUrl: ${video.pageUrl || ''}\nVideo platform: ${video.sourcePlatform || ''}\nVideo durationSec: ${video.durationSec ?? ''}\n${transcriptMeta}\nTranscript cues shown: ${Math.min((video.cues || []).length, 60)} of ${(video.cues || []).length}${(video.cues || []).length > 60 ? ' (truncated preview)' : ''}\n${cuesPreview}`
    : `\n\nVideo detected: no`;

  const contentBlock = `\n\nExtracted page text (truncated):\n${(mainText || '').slice(0, 8000)}`;

  const task = `\n\nTask: Provide a high-quality elaborate summary.\n- If transcript cues are present, treat them as authoritative spoken content.\n- Base the summary primarily on transcript; use page text for supplemental context.\n- Include 5-10 concise bullet points, a TL;DR (1-2 sentences), and any action items or references.\n- Be factual and neutral; avoid hallucinating content not supported by transcript.\n- If transcript source is 'none', clearly state limited confidence and rely on page/metadata.\n- If transcript truncated, still summarize; note possible missing later sections.`;

  return `${header}${cuesBlock}${contentBlock}${task}`;
};
