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
        if (!vid) { dlog('No <video> element found'); return { hasVideo: false } as ExtractedVideo; }
        let src = vid.currentSrc || vid.src || '';
        if (!src) { const ogVideoEl = document.querySelector('meta[property="og:video"]') as HTMLMetaElement | null; const ogVideo = ogVideoEl?.content; if (ogVideo) src = ogVideo; }
        const ogTitleEl = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null; const title = ogTitleEl?.content || document.title || '';
        const durationSec = Number.isFinite(vid.duration) ? Math.round(vid.duration) : undefined;
        let cues: ExtractedCue[] = [];
        try { for (const track of Array.from(vid.textTracks || [])) { const list = track?.cues as TextTrackCueList | null | undefined; if (!list) continue; for (let i = 0; i < list.length; i++) { const c = list[i] as TextTrackCue & { text?: string; }; if ((c as any)?.text) cues.push({ text: (c as any).text, startTime: Math.round(c.startTime), endTime: Math.round(c.endTime) }); if (cues.length >= 200) break; } if (cues.length >= 200) break; } } catch { }
        dlog('In-page cues collected', { count: cues.length });
        // Derive pageUrl with preference: canonical/og but override for dynamic YouTube navigation to avoid stale values
        let pageUrl: string | undefined;
        const canonicalHref = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href;
        const ogUrl = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content;
        const href = location.href as string;
        pageUrl = canonicalHref || ogUrl || href;
        // If it's a YouTube watch/shorts page and canonical differs from current href (common with SPA client-side nav), force current href
        if (/youtube\.com\/(watch|shorts)/.test(href) || /youtu\.be\//.test(href)) {
            if (pageUrl !== href) {
                pageUrl = href;
            }
        } else if (!pageUrl) {
            // Fallback: attempt to resolve embedded YouTube iframe
            const iframe = Array.from(document.querySelectorAll('iframe')).find(f => /youtube\.com\/embed\//.test((f as HTMLIFrameElement).src)) as HTMLIFrameElement | undefined;
            const m = iframe?.src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
            if (m && m[1]) pageUrl = `https://www.youtube.com/watch?v=${m[1]}`;
        }
        const sourcePlatform = detectPlatformFromUrl(pageUrl || src || location.href);
        dlog('Platform detected', { sourcePlatform, pageUrl, src });
        let transcriptSource: 'inpage' | 'fetched' | 'none' = cues.length ? 'inpage' : 'none'; let transcriptLanguage: string | undefined; let transcriptTruncated = false;
        let videoId: string | undefined;
        if (sourcePlatform === VIDEO_PLATFORM.youtube) {
            videoId = getYouTubeVideoId(pageUrl || href) || undefined;
            dlog('YouTube video id detection', { href, pageUrl, videoId, inPageCueCount: cues.length, canonicalHref, ogUrl });
            // Always attempt fetched transcript unless we already have a reasonably large set (heuristic threshold 60)
            const NEED_FETCH_THRESHOLD = 60;
            if (videoId && (cues.length === 0 || cues.length < NEED_FETCH_THRESHOLD)) {
                dlog('Attempting fetched transcript', { reason: cues.length ? 'below_threshold' : 'no_cues', videoId, inPageCount: cues.length });
                const fetched = await fetchYouTubeTranscript(videoId);
                if (fetched && fetched.cues.length > cues.length) {
                    cues = fetched.cues;
                    transcriptSource = 'fetched';
                    transcriptLanguage = fetched.lang;
                    transcriptTruncated = fetched.truncated;
                    dlog('Fetched transcript adopted', { newCount: cues.length, lang: transcriptLanguage, truncated: transcriptTruncated });
                } else {
                    dlog('Fetched transcript unavailable or not longer than in-page', { videoId, existingCount: cues.length, fetchedCount: fetched?.cues.length || 0 });
                }
            }
        }
        if (!cues.length) transcriptSource = 'none';
        return { hasVideo: true, src, title, durationSec, cues, transcriptSource, transcriptLanguage, transcriptTruncated, pageUrl, sourcePlatform, videoId } as ExtractedVideo;
    } catch { dwarn('extractVideo: failure'); return { hasVideo: false } as ExtractedVideo; }
};
