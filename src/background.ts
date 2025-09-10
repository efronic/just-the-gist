/// <reference types="chrome" />
import { callGemini } from './gemini';
import type { ExtractedPage, SummarizeMode } from './types/extract';
import { SUMMARIZE_MODE } from './types/extract';
import type { InboundRuntimeMessage, SummarizeTabRequest } from './types/messages';
import { isRuntimeMessage, isSummarizeTabRequest } from './types/messages';

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
  // Pass empty detailLevel to allow handleSummarizeRequest to use stored DEFAULT
  await handleSummarizeRequest({ tabId: tab.id, mode: SUMMARIZE_MODE.auto, detailLevel: '' as any });
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (!isRuntimeMessage(msg)) return; // Ignore unrelated messages
  if (isSummarizeTabRequest(msg)) {
    const req = msg as SummarizeTabRequest;
    handleSummarizeRequest({ tabId: req.tabId, mode: req.mode || SUMMARIZE_MODE.auto, detailLevel: req.detailLevel || 'standard' })
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
  const tabInfo = await chrome.tabs.get(tabId);
  const canInjectInto = (url?: string | null) => !!url && /^(https?|file):/i.test(url) && !/^(chrome:|edge:|chrome-extension:|about:|moz-extension:)/i.test(url);
  if (!canInjectInto(tabInfo.url)) {
    throw new Error('Cannot summarize this page type (restricted or unsupported URL).');
  }
  // 1) Ask content script for page extraction
  let extract: ExtractedPage | undefined;
  try {
    extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback: if content script not loaded yet (page may not match or was preloaded before install), try injecting then retry once.
    if (/Receiving end does not exist/i.test(msg) || /Could not establish connection/i.test(msg)) {
      try {
        // Correct path inside packaged extension (manifest strips 'dist/')
        await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
        try {
          extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;
        } catch {
          // Soft retry after tiny delay to mitigate race with build/watch
          await new Promise(r => setTimeout(r, 120));
          await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
          extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE', mode }) as ExtractedPage;
        }
      } catch (err2: unknown) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`Failed to inject content script after retry: ${msg2}`);
      }
    } else {
      throw err;
    }
  }
  if (!extract) throw new Error('No extraction result.');

  // 1b) If a YouTube transcript was previously fetched and cached, prefer it
  try {
    const video = extract.video as any;
    if (video && video.hasVideo) {
      const vid = video.videoId || (() => {
        try {
          const u = new URL(video.pageUrl || extract.url || '');
          if (/youtube\.com$/.test(u.hostname) && u.pathname === '/watch') return u.searchParams.get('v');
          if (/youtu\.be$/.test(u.hostname)) { const id = u.pathname.slice(1); if (id) return id; }
        } catch { }
        return undefined;
      })();
      if (vid) {
        const key = `yt_transcript_${vid}`;
        try {
          const store = await chrome.storage.local.get(key);
          const cached = store?.[key] as { cues?: Array<{ text: string; startTime: number; endTime: number; }>; lang?: string; truncated?: boolean; } | undefined;
          if (cached?.cues?.length) {
            // Adopt cached cues if they improve coverage
            const existingCount = Array.isArray(video.cues) ? video.cues.length : 0;
            if (cached.cues.length > existingCount) {
              const v = (extract.video as any) || {};
              extract = {
                ...extract,
                video: {
                  ...v,
                  hasVideo: true,
                  cues: cached.cues,
                  transcriptSource: 'fetched',
                  transcriptLanguage: cached.lang || v.transcriptLanguage,
                  transcriptTruncated: !!cached.truncated,
                } as any
              } as ExtractedPage;
            }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

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

  const transcriptMeta = video.hasVideo
    ? `Transcript source: ${video.transcriptSource}${video.transcriptLanguage ? `\nTranscript language: ${video.transcriptLanguage}` : ''}${video.transcriptTruncated ? '\nTranscript truncated: yes' : ''}`
    : 'Transcript source: none';

  // Adjust how much page text we include based on detail level
  const pageCharLimits: Record<string, number> = { concise: 4000, standard: 8000, detailed: 15000, expanded: 22000 };
  const pageLimit = pageCharLimits[detailLevel] ?? 8000;
  const contentBlock = `\n\nExtracted page text (truncated to ${pageLimit} chars):\n${(mainText || '').slice(0, pageLimit)}`;

  // Cue inclusion policy: full coverage for detailed & expanded, larger slice for standard
  const cuesAll = video.hasVideo ? video.cues : [];
  const cueLimits: Record<string, number> = {
    concise: 60,
    standard: 200,
    detailed: Number.POSITIVE_INFINITY,
    expanded: Number.POSITIVE_INFINITY
  };
  const cueLimit = cueLimits[detailLevel] ?? 120;
  const includeAll = !isFinite(cueLimit);
  const cuesUsed = includeAll ? cuesAll : cuesAll.slice(0, cueLimit);

  const cuesText = cuesUsed.map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${c.text}`).join('\n');
  const coverageLine = includeAll
    ? `Transcript cues included: ALL (${cuesAll.length})`
    : `Transcript cues included: ${cuesUsed.length} of ${cuesAll.length}${cuesAll.length > cuesUsed.length ? ' (partial for brevity)' : ''}`;
  const cuesBlock = video.hasVideo
    ? `\n\nVideo detected: yes\nVideo title: ${video.title || ''}\nVideo source: ${video.src || ''}\nVideo pageUrl: ${video.pageUrl || ''}\nVideo platform: ${video.sourcePlatform || ''}\nVideo durationSec: ${video.durationSec ?? ''}\n${transcriptMeta}\n${coverageLine}\n${cuesText}`
    : `\n\nVideo detected: no`;

  // --- Adaptive content-type heuristics ---
  const classifierContext = [title || '', video.hasVideo ? (video.title || '') : '', (mainText || '').slice(0, 800)].join('\n');
  const isEntertainment = /(trailer|vlog|reaction|music video|gameplay|let's play|lets play|comedy|stand.?up|sketch|interview clip|highlights|memes?)/i.test(classifierContext);
  const isHowTo = /(how to|tutorial|guide|walkthrough|step by step|setup|configuration|install|installation|fixing|troubleshoot|troubleshooting)/i.test(classifierContext);
  const isMeeting = /(meeting|standup|stand-up|sprint review|all-hands|retrospective|retro|1:?1|one-on-one|quarterly review|town hall|sync)/i.test(classifierContext);
  const isAcademic = /(lecture|seminar|conference|research|paper|thesis|study|experiment|analysis|dataset)/i.test(classifierContext);
  const isNews = /(breaking news|news update|press conference|headline|reporting live|journalist|segment|newsroom)/i.test(classifierContext);
  const contentType = isMeeting ? 'meeting' : isHowTo ? 'tutorial' : isAcademic ? 'academic' : isNews ? 'news' : isEntertainment ? 'entertainment' : 'general';

  const adaptiveGuidance = {
    entertainment: `Tone: neutral & concise. Focus on themes, notable moments, participants, cultural/contextual references, style. DO NOT fabricate action items. If template calls for action items, state: "No actionable tasks – entertainment content."`,
    tutorial: `Emphasize: objective, prerequisites, ordered steps (succinct imperatives), tools/commands, pitfalls, final outcome. Action items = next steps a learner should perform.`,
    meeting: `Include: agenda (or inferred), key discussion points, decisions, blockers, owners + action items (who + what; due date only if explicitly stated), follow-ups. Do not invent owners.`,
    academic: `Highlight: research question, methodology, key findings, metrics/data, limitations, implications, future work (as action items only if framed as recommendations).`,
    news: `Capture: headline summary, key facts (who/what/when/where/why/how), timeline, stakeholders, short verbatim quotes, implications. Only include action items if explicit calls to action are stated.`,
    general: `Balanced summary: key points, TL;DR, optional action items only if logical next steps are clearly expressed.`
  } as const;

  const styleInstructions: Record<string, string> = {
    concise: `Provide:\n- 3-5 bullet points\n- 1 sentence TL;DR\nKeep under ~180 words. Focus only on the most central facts or takeaways.`,
    standard: `Provide:\n- 5-10 key bullet points\n- TL;DR (1-2 sentences)\n- Action items (ONLY if content type logically yields them)\nAim for completeness without fluff.`,
    detailed: `Provide structured sections:\n1. TL;DR (1-2 sentences)\n2. Key Points (8-15 bullets)\n3. Detailed Walkthrough (chronological or logical flow; reference timestamps (mm:ss) when helpful)\n4. Notable Quotes (verbatim short quotes if present)\n5. Context-Type Focus (see adaptive guidance)\n6. Data / Metrics (numbers, stats, dates)\n7. Action Items / Recommendations (omit or state none if not applicable)\nLength target: 400-700 words. Avoid hallucinations.`,
    expanded: `Provide comprehensive structured analysis:\n1. Executive TL;DR (1-2 sentences)\n2. Extended Summary (2 short paragraphs)\n3. Key Insights (10-20 bullets)\n4. Detailed Section-by-Section or Topic Breakdown (reference timestamps (mm:ss) liberally; consolidate adjacent cues)\n5. Important Quotes (verbatim, trimmed, grouped)\n6. Data & Facts Table (markdown style if multiple items)\n7. Potential Implications / Analysis (avoid speculation)\n8. Open Questions / Follow-up Ideas\n9. Action Items (omit for entertainment; otherwise only if legitimate)\nMax 1100 words. Remain faithful to provided cues and text.`
  };

  const detailNote = `Detail level: ${detailLevel}`;
  const adaptiveBlock = `\n\nCONTENT TYPE CLASSIFICATION: ${contentType.toUpperCase()}\nAdaptive Guidance:\n${adaptiveGuidance[contentType]}\nAction Item Rules:\n- Provide ONLY if content type supports them (tutorial, meeting, academic (future work), general when explicit).\n- For entertainment: explicitly state no action items and do not fabricate.`;

  const task = `\n\nTask Instructions:\n${styleInstructions[detailLevel] || styleInstructions.standard}\n\nGlobal rules:\n- If transcript cues are present, treat them as primary source; page text supplements missing context.\n- Do not invent specifics not supported by cues or page.\n- If transcript source is 'none', state that and rely on page text only.\n- If transcript truncated or limited, note potential missing later content.\n- Preserve important proper nouns.\n- Avoid marketing fluff; keep factual.\n- Respect adaptive guidance and action item rules.`;

  return `${header}\n${detailNote}${cuesBlock}${contentBlock}${adaptiveBlock}${task}`;
};
