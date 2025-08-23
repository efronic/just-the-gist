import type { ExtractedCue, ExtractedVideo } from '../types/extract';
import { VIDEO_PLATFORM } from '../types/extract';
import { dlog, dwarn } from '../log.js';
import { fetchYouTubeTranscript, getYouTubeVideoId } from '../yt/captions.js';

const detectPlatformFromUrl = (u: string | undefined) => {
    if (!u) return VIDEO_PLATFORM.other;
    try { const url = new URL(u); const h = url.hostname || ''; if (/(^|\.)youtube\.com$/.test(h) || /(^|\.)youtu\.be$/.test(h)) return VIDEO_PLATFORM.youtube; if (/(^|\.)vimeo\.com$/.test(h)) return VIDEO_PLATFORM.vimeo; } catch { }
    return VIDEO_PLATFORM.other;
};

export const extractVideo = async (): Promise<ExtractedVideo> => {
    try {
        const vid = document.querySelector('video') as HTMLVideoElement | null;
        if (!vid) { dlog('No <video> element found'); return { hasVideo: false }; }
        let src = vid.currentSrc || vid.src || '';
        if (!src) { const ogVideoEl = document.querySelector('meta[property="og:video"]') as HTMLMetaElement | null; const ogVideo = ogVideoEl?.content; if (ogVideo) src = ogVideo; }
        const ogTitleEl = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null; const title = ogTitleEl?.content || document.title || '';
        const durationSec = Number.isFinite(vid.duration) ? Math.round(vid.duration) : undefined;
        let cues: ExtractedCue[] = [];
        try { for (const track of Array.from(vid.textTracks || [])) { const list = track?.cues as TextTrackCueList | null | undefined; if (!list) continue; for (let i = 0; i < list.length; i++) { const c = list[i] as TextTrackCue & { text?: string; }; if ((c as any)?.text) cues.push({ text: (c as any).text, startTime: Math.round(c.startTime), endTime: Math.round(c.endTime) }); if (cues.length >= 200) break; } if (cues.length >= 200) break; } } catch { }
        dlog('In-page cues collected', { count: cues.length });
        let pageUrl: string | undefined; const canonicalHref = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href; const ogUrl = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content; pageUrl = canonicalHref || ogUrl; const href = location.href as string;
        if (!pageUrl) { if (/youtube\.com\/watch/.test(href) || /youtu\.be\//.test(href)) { pageUrl = href; } else { const iframe = Array.from(document.querySelectorAll('iframe')).find(f => /youtube\.com\/embed\//.test((f as HTMLIFrameElement).src)) as HTMLIFrameElement | undefined; const m = iframe?.src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/); if (m && m[1]) pageUrl = `https://www.youtube.com/watch?v=${m[1]}`; } }
        const sourcePlatform = detectPlatformFromUrl(pageUrl || src || location.href);
        dlog('Platform detected', { sourcePlatform, pageUrl, src });
        let transcriptSource: 'inpage' | 'fetched' | 'none' = cues.length ? 'inpage' : 'none'; let transcriptLanguage: string | undefined; let transcriptTruncated = false;
        if (sourcePlatform === VIDEO_PLATFORM.youtube) { const videoId = getYouTubeVideoId(pageUrl || href); if (videoId && cues.length < 20) { dlog('Attempting fetched transcript (in-page insufficient)', { videoId, inPageCount: cues.length }); const fetched = await fetchYouTubeTranscript(videoId); if (fetched && fetched.cues.length > cues.length) { cues = fetched.cues; transcriptSource = 'fetched'; transcriptLanguage = fetched.lang; transcriptTruncated = fetched.truncated; dlog('Fetched transcript adopted', { newCount: cues.length }); } } }
        if (!cues.length) transcriptSource = 'none';
        return { hasVideo: true, src, title, durationSec, cues, transcriptSource, transcriptLanguage, transcriptTruncated, pageUrl, sourcePlatform };
    } catch { dwarn('extractVideo: failure'); return { hasVideo: false }; }
};
