/// <reference types="chrome" />
import type { ExtractedCue, ExtractedVideo, ExtractedPage, VideoPlatform } from './types/extract';
import { VIDEO_PLATFORM } from './types/extract';

const extractMainText = (): string => {
  try {
    // Prefer <article>
    const article = document.querySelector('article');
    const root = (article as HTMLElement) || document.body;
    // Collect readable text nodes from headings and paragraphs
    const parts: string[] = [];
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote').forEach((el) => {
      const t = (el as HTMLElement).innerText?.trim();
      if (t && t.length > 1) parts.push(t);
    });
    let text = parts.join('\n');
    // Collapse whitespace and limit
    text = text.replace(/\n{3,}/g, '\n\n');
    if (text.length > 30000) text = text.slice(0, 30000) + '\n...[truncated]';
    return text;
  } catch (_e) {
    return document.title || '';
  }
};

// Types moved to src/types/extract.ts

const detectPlatformFromUrl = (u: string | undefined): VideoPlatform => {
  if (!u) return VIDEO_PLATFORM.other;
  try {
    const url = new URL(u);
    const h = url.hostname || '';
    if (/(^|\.)youtube\.com$/.test(h) || /(^|\.)youtu\.be$/.test(h)) return VIDEO_PLATFORM.youtube;
    if (/(^|\.)vimeo\.com$/.test(h)) return VIDEO_PLATFORM.vimeo;
  } catch (_e) {
    // ignore
  }
  return VIDEO_PLATFORM.other;
};

const extractVideo = (): ExtractedVideo => {
  try {
    const vid = document.querySelector('video') as HTMLVideoElement | null;
    if (!vid) return { hasVideo: false };
    let src = vid.currentSrc || vid.src || '';
    // Try common meta if page is YouTube or has meta tags
    if (!src) {
      const ogVideoEl = document.querySelector('meta[property="og:video"]') as HTMLMetaElement | null;
      const ogVideo = ogVideoEl?.content;
      if (ogVideo) src = ogVideo;
    }

    const ogTitleEl = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    const title = ogTitleEl?.content || document.title || '';
    const durationSec = Number.isFinite(vid.duration) ? Math.round(vid.duration) : undefined;

    const cues: ExtractedCue[] = [];
    try {
      for (const track of Array.from(vid.textTracks || [])) {
        // Ensure cues are loaded
        const list = track?.cues as TextTrackCueList | null | undefined;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i] as TextTrackCue & { text?: string; };
          if ((c as any)?.text) cues.push({
            text: (c as any).text,
            startTime: Math.round(c.startTime),
            endTime: Math.round(c.endTime)
          });
          if (cues.length >= 60) break; // cap
        }
        if (cues.length >= 60) break;
      }
    } catch (_ignored) {
      // Ignore cross-origin issues
    }

    // Try to determine a canonical video page URL (e.g., YouTube watch URL)
    let pageUrl: string | undefined;
    const canonicalHref = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href;
    const ogUrl = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content;
    pageUrl = canonicalHref || ogUrl;

    // Heuristics for YouTube and others if canonical/og:url is missing or not a watch URL
    const href = location.href as string;
    if (!pageUrl) {
      if (/youtube\.com\/watch/.test(href) || /youtu\.be\//.test(href)) {
        pageUrl = href;
      } else {
        // Check for iframe embeds
        const iframe = Array.from(document.querySelectorAll('iframe')).find((f) => /youtube\.com\/embed\//.test((f as HTMLIFrameElement).src)) as HTMLIFrameElement | undefined;
        const m = iframe?.src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
        if (m && m[1]) {
          pageUrl = `https://www.youtube.com/watch?v=${m[1]}`;
        }
      }
    }

    const sourcePlatform = detectPlatformFromUrl(pageUrl || src || location.href);

    return { hasVideo: true, src, title, durationSec, cues, pageUrl, sourcePlatform };
  } catch (_e) {
    return { hasVideo: false };
  }
};

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg?.type === 'EXTRACT_PAGE') {
    const extract: ExtractedPage = {
      url: location.href,
      title: document.title || '',
      mainText: extractMainText(),
      video: extractVideo()
    };
    sendResponse(extract);
  }
});
