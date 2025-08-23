import type { ExtractedCue } from '../types/extract';
import { dlog, dwarn } from '../log.js';
import { parseRawTranscriptText } from './parse.js';
import { getPlayerResponseWithRetry } from './playerResponse.js';
import type { YtCaptionTrackMeta, InnertubeMeta, FetchTranscriptResult } from './types.js';

const preferredLangsBase = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN'];

const MAX_CACHE_CHAR_LEN = 150000; // Raised to allow near-complete transcripts
const saveTranscriptCache = async (cacheKey: string, cues: ExtractedCue[], lang?: string) => {
    let truncated = false; let total = 0; const limited: ExtractedCue[] = [];
    for (const c of cues) { total += c.text.length; if (total > MAX_CACHE_CHAR_LEN) { truncated = true; break; } limited.push(c); }
    try { await chrome.storage.local.set({ [cacheKey]: { cues: limited, lang, truncated } }); } catch { }
};

const selectCaptionTrack = (tracks: YtCaptionTrackMeta[], prefLangs: string[]) => {
    const manual = tracks.filter(t => t.kind !== 'asr');
    const asr = tracks.filter(t => t.kind === 'asr');
    const langMatch = (arr: YtCaptionTrackMeta[]) => prefLangs
        .map(l => arr.find(t => (t.languageCode || '').toLowerCase().startsWith(l.toLowerCase())))
        .find(Boolean);
    return langMatch(manual) || manual[0] || langMatch(asr) || asr[0] || null;
};

const fetchTrackFormats = async (track: YtCaptionTrackMeta, cacheKey: string, lang: string | undefined, debug?: string[]) => {
    const baseUrl = track.baseUrl;
    const hasFmtAlready = /[?&]fmt=/.test(baseUrl);
    const formats = hasFmtAlready ? ['(existing)'] : ['json3', 'srv3', 'srv1'];
    for (const fmt of formats) {
        const url = fmt === '(existing)'
            ? baseUrl
            : baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=' + fmt + (track.kind === 'asr' && !/[?&]kind=asr/.test(baseUrl) ? '&kind=asr' : '');
        try {
            dlog('Fmt fetch attempt', { fmt, kind: track.kind, lang });
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) { debug?.push(`fmt ${fmt} resp not ok: ${resp.status}`); continue; }
            const txt = await resp.text(); if (!txt) continue;
            const cues = parseRawTranscriptText(txt);
            if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); dlog('Transcript fetched via fmt', { fmt, cues: cues.length }); return { cues, lang }; }
            debug?.push(`fmt ${fmt} parsed 0 cues`);
        } catch (e) { dwarn('Fmt fetch failed', { fmt, err: (e as any)?.message }); debug?.push(`fmt ${fmt} threw ${(e as any)?.message}`); }
    }
    try {
        const resp = await fetch(baseUrl, { credentials: 'include' });
        if (resp.ok) { const txt = await resp.text(); const cues = parseRawTranscriptText(txt); if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); return { cues, lang }; } debug?.push('plain baseUrl 0 cues'); }
        else debug?.push(`plain baseUrl not ok: ${resp.status}`);
    } catch (e) { dwarn('baseUrl plain fetch failed', (e as any)?.message); debug?.push(`plain baseUrl threw ${(e as any)?.message}`); }
    return null;
};

const extractInnertubeMeta = (): InnertubeMeta | null => {
    const win: any = window as any;
    try {
        if (win.ytcfg && typeof win.ytcfg.get === 'function') {
            const apiKey = win.ytcfg.get('INNERTUBE_API_KEY');
            const clientName = win.ytcfg.get('INNERTUBE_CLIENT_NAME');
            const clientVersion = win.ytcfg.get('INNERTUBE_CLIENT_VERSION');
            const visitorData = win.ytcfg.get('VISITOR_DATA');
            if (apiKey && clientName && clientVersion) return { apiKey, clientName: String(clientName), clientVersion, visitorData };
        }
    } catch { }
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.includes('INNERTUBE_API_KEY') && txt.includes('INNERTUBE_CLIENT_VERSION')) {
            const apiKey = txt.match(/INNERTUBE_API_KEY":"([^"]+)"/i)?.[1];
            const clientVersion = txt.match(/INNERTUBE_CLIENT_VERSION":"([^"]+)"/i)?.[1];
            const clientName = txt.match(/INNERTUBE_CLIENT_NAME":(\d+)/i)?.[1] || '1';
            const visitorData = txt.match(/VISITOR_DATA":"([^"]+)"/)?.[1];
            if (apiKey && clientVersion) return { apiKey, clientName, clientVersion, visitorData };
        }
    }
    return null;
};

const fetchInnertubeTranscript = async (videoId: string, meta: InnertubeMeta) => {
    try {
        const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(meta.apiKey)}`;
        const body = { context: { client: { clientName: meta.clientName, clientVersion: meta.clientVersion, hl: 'en', gl: 'US', visitorData: meta.visitorData } }, videoId };
        const prResp = await fetch(playerUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!prResp.ok) return null;
        const prJson = await prResp.json();
        const tracks: any[] = prJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!tracks.length) return null;
        const pick = selectCaptionTrack(tracks as any, ['en', 'en-US', 'en-GB']) || tracks[0];
        if (!pick?.baseUrl) return null;
        try {
            const txt = await fetch(pick.baseUrl + (pick.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3', { credentials: 'include' }).then(r => r.ok ? r.text() : '');
            if (txt) { const cues = parseRawTranscriptText(txt); if (cues.length) return { cues, lang: pick.languageCode }; }
        } catch { }
    } catch { }
    return null;
};

export const fetchYouTubeTranscript = async (videoId: string): Promise<FetchTranscriptResult | null> => {
    const { DISABLE_TRANSCRIPTS } = await chrome.storage.sync.get({ DISABLE_TRANSCRIPTS: false });
    if (DISABLE_TRANSCRIPTS) { dlog('Transcript fetching disabled by user setting'); return null; }
    const cacheKey = `yt_transcript_${videoId}`;
    const debug: string[] = [];
    try { const existing = await chrome.storage.local.get(cacheKey); const cached = existing?.[cacheKey]; if (cached?.cues?.length) return { cues: cached.cues, lang: cached.lang, truncated: !!cached.truncated }; } catch { }
    const playerResp = await getPlayerResponseWithRetry();
    const tracks: YtCaptionTrackMeta[] = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) debug.push('No captionTracks in playerResp after retries');
    const docLang = document.documentElement.getAttribute('lang');
    const prefLangs = [...new Set([...(docLang ? [docLang] : []), ...preferredLangsBase])];
    // Try ALL tracks (manual first, then ASR) to maximize success
    const orderedTracks = [
        ...tracks.filter(t => t.kind !== 'asr'),
        ...tracks.filter(t => t.kind === 'asr')
    ];
    for (const t of orderedTracks) {
        const res = await fetchTrackFormats(t, cacheKey, t.languageCode, debug);
        if (res?.cues.length) return { cues: res.cues, lang: res.lang, truncated: false };
    }

    if (!tracks.length) {
        debug.push('Attempt Innertube early because no tracks');
        const metaEarly = extractInnertubeMeta();
        if (metaEarly) {
            const early = await fetchInnertubeTranscript(videoId, metaEarly);
            if (early?.cues?.length) { await saveTranscriptCache(cacheKey, early.cues, early.lang); return { cues: early.cues, lang: early.lang, truncated: false }; }
            else debug.push('Innertube early yielded 0 cues');
        } else debug.push('No Innertube meta early');
    }

    const fallbackLangs = [...prefLangs, 'en-uk', 'en-nz'];
    for (const lang of fallbackLangs) {
        for (const asr of [false, true]) {
            const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(videoId)}&fmt=json3${asr ? '&kind=asr' : ''}`;
            try { const resp = await fetch(url, { credentials: 'include' }); if (!resp.ok) { debug.push(`timedtext ${lang} asr=${asr} status ${resp.status}`); continue; } const txt = await resp.text(); const cues = parseRawTranscriptText(txt); if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); return { cues, lang, truncated: false }; } else debug.push(`timedtext ${lang} asr=${asr} 0 cues`); } catch (e) { debug.push(`timedtext ${lang} asr=${asr} threw ${(e as any)?.message}`); }
        }
    }
    const meta = extractInnertubeMeta();
    if (meta) {
        const result = await fetchInnertubeTranscript(videoId, meta);
        if (result?.cues?.length) { await saveTranscriptCache(cacheKey, result.cues, result.lang); return { cues: result.cues, lang: result.lang, truncated: false }; }
        debug.push('Innertube late yielded 0 cues');
    } else debug.push('No Innertube meta late');
    dwarn('YouTube transcript unavailable', { videoId, debug });
    return null;
};

export const getYouTubeVideoId = (u: string): string | null => {
    try {
        const url = new URL(u);
        if (/youtube\.com$/.test(url.hostname)) {
            if (url.pathname === '/watch') {
                const v = url.searchParams.get('v'); if (v) return v;
            }
            // Shorts URL pattern /shorts/<id>
            const shorts = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
            if (shorts) return shorts[1];
            // Embed pattern /embed/<id>
            const embed = url.pathname.match(/\/embed\/([A-Za-z0-9_-]{6,})/);
            if (embed) return embed[1];
        }
        if (/youtu\.be$/.test(url.hostname)) { const id = url.pathname.slice(1); if (id) return id; }
    } catch { }
    return null;
};
