/// <reference types="chrome" />
import type { ExtractedPage } from './types/extract';
import { isRuntimeMessage, isExtractPageRequest } from './types/messages';
import { dlog } from './log.js';
import { extractMainText } from './extract/mainText.js';
import { extractVideo } from './extract/video.js';

// Content script now only orchestrates extraction via modularized helpers.
chrome.runtime.onMessage.addListener((msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (!isRuntimeMessage(msg) || !isExtractPageRequest(msg)) return;
  dlog('Message received: EXTRACT_PAGE (modular)');
  (async () => {
    const t0 = performance.now();
    const video = await extractVideo();
    const mainText = extractMainText();
    const extract: ExtractedPage = { url: location.href, title: document.title || '', mainText, video };
    dlog('Sending extraction response', { elapsedMs: Math.round(performance.now() - t0), mainLength: mainText.length, cues: video.hasVideo ? video.cues.length : 0 });
    sendResponse(extract);
  })();
  return true;
});

// (legacy note) Original monolithic logic moved into: log.ts, extract/mainText.ts, extract/video.ts, yt/* modules.
