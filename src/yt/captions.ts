import type { ExtractedCue } from '../types/extract';
import { dlog, dwarn } from '../log.js';
import { parseRawTranscriptText } from './parse.js';
import { getPlayerResponseWithRetry } from './playerResponse.js';
import type { YtCaptionTrackMeta, InnertubeMeta, FetchTranscriptResult } from './types.js';

const preferredLangsBase = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN'];

const saveTranscriptCache = async (cacheKey: string, cues: ExtractedCue[], lang?: string) => {
    let truncated = false; let total = 0; const limited: ExtractedCue[] = [];
    for (const c of cues) { total += c.text.length; if (total > 50000) { truncated = true; break; } limited.push(c); }
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

const fetchTrackFormats = async (track: YtCaptionTrackMeta, cacheKey: string, lang: string | undefined) => {
    const baseUrl = track.baseUrl;
    const hasFmtAlready = /[?&]fmt=/.test(baseUrl);
    const formats = hasFmtAlready ? ['(existing)'] : ['json3', 'srv3', 'srv1'];
    for (const fmt of formats) {
        const url = fmt === '(existing)'
            ? baseUrl
            : baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=' + fmt + (track.kind === 'asr' && !/[?&]kind=asr/.test(baseUrl) ? '&kind=asr' : '');
        try {
            dlog('Fmt fetch attempt', { fmt, kind: track.kind, lang });
            const resp = await fetch(url, { credentials: 'omit' });
            if (!resp.ok) continue;
            const txt = await resp.text(); if (!txt) continue;
            const cues = parseRawTranscriptText(txt);
            if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); dlog('Transcript fetched via fmt', { fmt, cues: cues.length }); return { cues, lang }; }
        } catch (e) { dwarn('Fmt fetch failed', { fmt, err: (e as any)?.message }); }
    }
    try {
        const resp = await fetch(baseUrl, { credentials: 'omit' });
        if (resp.ok) { const txt = await resp.text(); const cues = parseRawTranscriptText(txt); if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); return { cues, lang }; } }
    } catch (e) { dwarn('baseUrl plain fetch failed', (e as any)?.message); }
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
    try { const existing = await chrome.storage.local.get(cacheKey); const cached = existing?.[cacheKey]; if (cached?.cues?.length) return { cues: cached.cues, lang: cached.lang, truncated: !!cached.truncated }; } catch { }

    const playerResp = await getPlayerResponseWithRetry();
    const tracks: YtCaptionTrackMeta[] = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const docLang = document.documentElement.getAttribute('lang');
    const prefLangs = [...new Set([...(docLang ? [docLang] : []), ...preferredLangsBase])];
    const chosen = selectCaptionTrack(tracks, prefLangs);
    if (chosen) {
        const viaFormats = await fetchTrackFormats(chosen, cacheKey, chosen.languageCode);
        if (viaFormats?.cues.length) return { cues: viaFormats.cues, lang: viaFormats.lang, truncated: false };
    }
    const asrAlt = tracks.filter(t => t.kind === 'asr' && t !== chosen)[0];
    if (asrAlt) { const viaAsr = await fetchTrackFormats(asrAlt, cacheKey, asrAlt.languageCode); if (viaAsr?.cues.length) return { cues: viaAsr.cues, lang: viaAsr.lang, truncated: false }; }

    const fallbackLangs = [...prefLangs, 'en-uk', 'en-nz'];
    for (const lang of fallbackLangs) {
        for (const asr of [false, true]) {
            const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(videoId)}&fmt=json3${asr ? '&kind=asr' : ''}`;
            try { const resp = await fetch(url, { credentials: 'omit' }); if (!resp.ok) continue; const txt = await resp.text(); const cues = parseRawTranscriptText(txt); if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); return { cues, lang, truncated: false }; } } catch { }
        }
    }
    const meta = extractInnertubeMeta();
    if (meta) {
        const result = await fetchInnertubeTranscript(videoId, meta);
        if (result?.cues?.length) { await saveTranscriptCache(cacheKey, result.cues, result.lang); return { cues: result.cues, lang: result.lang, truncated: false }; }
    }
    return null;
};

export const getYouTubeVideoId = (u: string): string | null => {
    try { const url = new URL(u); if (/youtube\.com$/.test(url.hostname) && url.pathname === '/watch') { const v = url.searchParams.get('v'); if (v) return v; } if (/youtu\.be$/.test(url.hostname)) { const id = url.pathname.slice(1); if (id) return id; } } catch { }
    return null;
};
