/// <reference types="chrome" />
import { callGemini } from './gemini';
import type { ExtractedCue, ExtractedVideo, ExtractedPage, SummarizeMode } from './types/extract';
import { SUMMARIZE_MODE } from './types/extract';

// Create context menu to summarize page
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'justthegist',
    title: 'Summarize with Just the Gist',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'justthegist') return;
  if (!tab || !tab.id) return;
  await handleSummarizeRequest({ tabId: tab.id, mode: SUMMARIZE_MODE.auto, detailLevel: 'standard' });
});

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg?.type === 'SUMMARIZE_TAB') {
    handleSummarizeRequest({ tabId: msg.tabId as number, mode: (msg.mode || SUMMARIZE_MODE.auto) as SummarizeMode, detailLevel: msg.detailLevel || 'standard' })
      .then(result => sendResponse({ ok: true, result }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: message });
      });
    return true; // keep channel open
  }
});

// Types moved to src/types/extract.ts

const handleSummarizeRequest = async ({ tabId, mode, detailLevel }: { tabId: number; mode: SummarizeMode; detailLevel: string; }) => {
  // 1) Ask content script for page extraction
  let extract: ExtractedPage | undefined;
  try {
    extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback: if content script not loaded yet (page may not match or was preloaded before install), try injecting then retry once.
    if (/Receiving end does not exist/i.test(msg) || /Could not establish connection/i.test(msg)) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/contentScript.js'] });
        extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;
      } catch (err2: unknown) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`Failed to inject content script: ${msg2}`);
      }
    } else {
      throw err;
    }
  }
  if (!extract) throw new Error('No extraction result.');

  // 2) Load API config
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get({
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash'
  });
  if (!GEMINI_API_KEY) {
    throw new Error('Missing API key. Set it in the extension Options.');
  }

  // 3) Build prompt
  // Retrieve stored default detail level if none explicitly passed (popup passes one)
  const { DETAIL_LEVEL } = await chrome.storage.sync.get({ DETAIL_LEVEL: 'standard' });
  const effectiveDetail = detailLevel || DETAIL_LEVEL || 'standard';

  const prompt = buildPrompt(extract, mode, effectiveDetail);

  // 4) Call Gemini
  const text = await callGemini({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    input: prompt
  });

  return { text, extract } as const;
};

const buildPrompt = (extract: ExtractedPage, mode: SummarizeMode, detailLevel: string) => {
  const { url, title, mainText, video } = extract;
  const header = `You are a concise expert summarizer. Summarize the content at the URL below.\n\nURL: ${url}\nTitle: ${title}\nMode: ${mode}`;

  const transcriptMeta = video?.hasVideo
    ? `Transcript source: ${video.transcriptSource || 'none'}${video.transcriptLanguage ? `\nTranscript language: ${video.transcriptLanguage}` : ''}${video.transcriptTruncated ? '\nTranscript truncated: yes' : ''}`
    : 'Transcript source: none';

  // (legacy preview logic replaced below by detail-level specific logic)

  // Adjust how much page text we include based on detail level
  const pageCharLimits: Record<string, number> = { concise: 4000, standard: 8000, detailed: 15000, expanded: 22000 };
  const pageLimit = pageCharLimits[detailLevel] ?? 8000;
  const contentBlock = `\n\nExtracted page text (truncated to ${pageLimit} chars):\n${(mainText || '').slice(0, pageLimit)}`;

  // Cue inclusion policy: full coverage for detailed & expanded, larger slice for standard
  const cuesAll = video?.cues || [];
  const cueLimits: Record<string, number> = {
    concise: 60,
    standard: 200,
    detailed: Number.POSITIVE_INFINITY,
    expanded: Number.POSITIVE_INFINITY
  };
  const cueLimit = cueLimits[detailLevel] ?? 120;
  const includeAll = !isFinite(cueLimit);
  const cuesUsed = includeAll ? cuesAll : cuesAll.slice(0, cueLimit);

  // Format cues compactly to reduce token usage: merge small gaps optional (future). For now simple list.
  const cuesText = cuesUsed.map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${c.text}`).join('\n');
  const coverageLine = includeAll
    ? `Transcript cues included: ALL (${cuesAll.length})`
    : `Transcript cues included: ${cuesUsed.length} of ${cuesAll.length}${cuesAll.length > cuesUsed.length ? ' (partial for brevity)' : ''}`;
  const cuesBlock = video?.hasVideo
    ? `\n\nVideo detected: yes\nVideo title: ${video.title || ''}\nVideo source: ${video.src || ''}\nVideo pageUrl: ${video.pageUrl || ''}\nVideo platform: ${video.sourcePlatform || ''}\nVideo durationSec: ${video.durationSec ?? ''}\n${transcriptMeta}\n${coverageLine}\n${cuesText}`
    : `\n\nVideo detected: no`;

  const styleInstructions: Record<string, string> = {
    concise: `Provide:
- 3-5 bullet points
- 1 sentence TL;DR
Keep under ~180 words.
Focus only on the most central facts or takeaways.`,
    standard: `Provide:
- 5-10 key bullet points
- TL;DR (1-2 sentences)
- Action items (if any)
Aim for completeness without unnecessary fluff.`,
    detailed: `Provide structured sections:
1. TL;DR (1-2 sentences)
2. Key Points (8-15 bullets)
3. Detailed Walkthrough (chronological or logical flow, referencing timestamps when helpful)
4. Notable Quotes (verbatim short quotes if present in transcript)
5. Data / Metrics (any numbers, stats, dates)
6. Action Items / Recommendations
Length target: 400-700 words. Avoid hallucinations. Cite timestamps in (mm:ss) form when using transcript cues.`,
    expanded: `Provide comprehensive structured analysis:
1. Executive TL;DR (1-2 sentences)
2. Extended Summary (2 short paragraphs)
3. Key Insights (10-20 bullets)
4. Detailed Section-by-Section or Topic Breakdown (reference timestamps (mm:ss) liberally; consolidate adjacent cues)
5. Important Quotes (verbatim, trimmed, group by theme)
6. Data & Facts Table (markdown style if multiple)
7. Potential Implications / Analysis (avoid speculation beyond source) 
8. Open Questions / Follow-up Ideas
9. Action Items
Max 1100 words. Remain faithful to provided cues and text.`
  };

  const detailNote = `Detail level: ${detailLevel}`;

  const task = `\n\nTask Instructions:\n${styleInstructions[detailLevel] || styleInstructions.standard}\n\nGlobal rules:\n- If transcript cues are present, treat them as primary source; page text supplements missing context.\n- Do not invent specifics not supported by cues or page.\n- If transcript source is 'none', state that and rely on page text only.\n- If transcript truncated or limited, note potential missing later content.\n- Preserve important proper nouns.\n- Avoid marketing fluff; keep factual.`;
  return `${header}\n${detailNote}${cuesBlock}${contentBlock}${task}`;
};
