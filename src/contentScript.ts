/// <reference types="chrome" />
import type { ExtractedCue, ExtractedVideo, ExtractedPage, VideoPlatform } from './types/extract';
import { VIDEO_PLATFORM } from './types/extract';

// Structured debug logging helpers (can be gated later via storage flag)
const TAG = '[gist][content]';
const dlog = (...args: any[]) => console.log(TAG, ...args);
const dwarn = (...args: any[]) => console.warn(TAG, ...args);

const extractMainText = (): string => {
  try {
    // Prefer <article>
    dlog('extractMainText: start');
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
    if (text.length > 30000) {
      dlog('extractMainText: truncating large text', { originalLength: text.length });
      text = text.slice(0, 30000) + '\n...[truncated]';
    }
    dlog('extractMainText: done', { length: text.length });
    return text;
  } catch (_e) {
    dwarn('extractMainText: failed; falling back to title');
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

// --- YouTube transcript helpers ---
interface YtCaptionTrackMeta { baseUrl: string; languageCode?: string; vssId?: string; kind?: string; name?: any; }

const preferredLangsBase = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const readWindowPlayerResponse = (): any | undefined => {
  // Direct window vars first
  const wAny = window as any;
  if (wAny.ytInitialPlayerResponse) return wAny.ytInitialPlayerResponse;
  const prStr = wAny.ytplayer?.config?.args?.player_response;
  if (prStr && typeof prStr === 'string') {
    try { return JSON.parse(prStr); } catch { /* ignore */ }
  }
  return undefined;
};

const parsePlayerResponseFromScripts = (): any | undefined => {
  const scripts = Array.from(document.querySelectorAll('script'));
  for (const s of scripts) {
    const txt = s.textContent || '';
    if (!txt.includes('ytInitialPlayerResponse')) continue;
    const idx = txt.indexOf('ytInitialPlayerResponse');
    const braceIdx = txt.indexOf('{', idx);
    if (braceIdx === -1) continue;
    let depth = 0; let inStr: false | string = false; let esc = false;
    for (let i = braceIdx; i < txt.length; i++) {
      const ch = txt[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') esc = true; else if (ch === inStr) inStr = false;
      } else {
        if (ch === '"' || ch === '\'') inStr = ch; else if (ch === '{') depth++; else if (ch === '}') {
          depth--; if (depth === 0) {
            const jsonStr = txt.slice(braceIdx, i + 1);
            try { return JSON.parse(jsonStr); } catch (e) { dwarn('playerResponse script JSON parse fail', (e as any)?.message); }
            break;
          }
        }
      }
    }
  }
  return undefined;
};

const getPlayerResponseWithRetry = async (): Promise<any | undefined> => {
  for (let attempt = 0; attempt < 6; attempt++) { // up to ~2s (0,300,600,900,1200,1500)
    const pr = readWindowPlayerResponse() || parsePlayerResponseFromScripts();
    if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
      if (attempt > 0) dlog('PlayerResponse obtained after retries', { attempt });
      return pr;
    }
    if (attempt === 0) dlog('PlayerResponse not ready, polling...');
    await sleep(300);
  }
  return readWindowPlayerResponse() || parsePlayerResponseFromScripts();
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
  const attempts: any[] = [];
  for (const fmt of formats) {
    const url = fmt === '(existing)'
      ? baseUrl
      : baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=' + fmt + (track.kind === 'asr' && !/[?&]kind=asr/.test(baseUrl) ? '&kind=asr' : '');
    try {
      dlog('Fmt fetch attempt', { fmt, kind: track.kind, lang, hasFmtAlready, urlSample: url.slice(0, 120) + (url.length > 120 ? '…' : '') });
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) { dwarn('Fmt fetch non-OK', { fmt, status: resp.status }); continue; }
      const txt = await resp.text();
      if (!txt) { dwarn('Fmt fetch empty body', { fmt }); continue; }
      const cues = parseRawTranscriptText(txt);
      attempts.push({ fmt, len: txt.length, cues: cues.length });
      if (cues.length) {
        await saveTranscriptCache(cacheKey, cues, lang);
        dlog('Transcript fetched via fmt', { fmt, cues: cues.length, lang });
        return { cues, lang };
      }
    } catch (e) { dwarn('Fmt fetch failed', { fmt, err: (e as any)?.message }); }
  }
  // Plain baseUrl last (only if we modified it before or formats produced nothing)
  try {
    dlog('Plain baseUrl attempt', { hasFmtAlready, kind: track.kind, lang });
    const resp = await fetch(baseUrl, { credentials: 'omit' });
    if (!resp.ok) { dwarn('BaseUrl fetch non-OK', { status: resp.status }); }
    else {
      const txt = await resp.text();
      const cues = parseRawTranscriptText(txt);
      if (cues.length) {
        await saveTranscriptCache(cacheKey, cues, lang);
        dlog('Transcript fetched via baseUrl plain', { cues: cues.length, lang });
        return { cues, lang };
      }
      dwarn('BaseUrl fetch produced no cues', { textLen: txt.length });
    }
  } catch (e) { dwarn('baseUrl plain fetch failed', (e as any)?.message); }
  dlog('Fmt/baseUrl attempts exhausted', { attempts });
  return null;
};

const parseRawTranscriptText = (raw: string): ExtractedCue[] => {
  const trimmed = raw.trim().replace(/^\)]}'/, ''); // strip XSSI prefix if any
  // JSON events variant
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (Array.isArray(json.events)) {
        const cues: ExtractedCue[] = [];
        for (const ev of json.events) {
          if (!Array.isArray(ev.segs)) continue;
          const startMs = ev.tStartMs || 0; const durMs = ev.dDurationMs || ev.dur || 0;
          const text = ev.segs.map((s: any) => s.utf8).join('').replace(/\n+/g, ' ').trim();
          if (!text) continue;
          cues.push({ text, startTime: Math.round(startMs / 1000), endTime: Math.round((startMs + durMs) / 1000) });
          if (cues.length >= 1200) break;
        }
        return cues;
      }
    } catch { /* fallthrough */ }
  }
  // XML fallback
  if (trimmed.includes('<transcript') || trimmed.includes('<text')) {
    const regex = /<text[^>]*start="([0-9.]+)"[^>]*dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    const cues: ExtractedCue[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(trimmed))) {
      const start = parseFloat(m[1]);
      const dur = parseFloat(m[2]);
      let body = m[3]
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/<br\s*\/? >?/g, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!body) continue;
      cues.push({ text: body, startTime: Math.round(start), endTime: Math.round(start + dur) });
      if (cues.length >= 1200) break;
    }
    return cues;
  }
  return [];
};

const saveTranscriptCache = async (cacheKey: string, cues: ExtractedCue[], lang?: string) => {
  let truncated = false; let total = 0; const limited: ExtractedCue[] = [];
  for (const c of cues) { total += c.text.length; if (total > 50000) { truncated = true; break; } limited.push(c); }
  try { await chrome.storage.local.set({ [cacheKey]: { cues: limited, lang, truncated } }); } catch { /* ignore */ }
};
const getYouTubeVideoId = (u: string): string | null => {
  try {
    const url = new URL(u);
    if (/youtube\.com$/.test(url.hostname) && url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      if (v) return v;
    }
    if (/youtu\.be$/.test(url.hostname)) {
      const id = url.pathname.slice(1);
      if (id) return id;
    }
  } catch (_e) { /* ignore */ }
  return null;
};

const fetchYouTubeTranscript = async (videoId: string): Promise<{ cues: ExtractedCue[]; lang?: string; truncated: boolean; } | null> => {
  const { DISABLE_TRANSCRIPTS } = await chrome.storage.sync.get({ DISABLE_TRANSCRIPTS: false });
  if (DISABLE_TRANSCRIPTS) { dlog('Transcript fetching disabled by user setting'); return null; }
  const cacheKey = `yt_transcript_${videoId}`;
  try {
    const existing = await chrome.storage.local.get(cacheKey);
    const cached = existing?.[cacheKey];
    if (cached?.cues?.length) { dlog('Transcript cache hit', { videoId, cues: cached.cues.length }); return { cues: cached.cues, lang: cached.lang, truncated: !!cached.truncated }; }
  } catch { /* ignore */ }

  const playerResp = await getPlayerResponseWithRetry();
  const tracks: YtCaptionTrackMeta[] = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) { dlog('No captionTracks after polling'); }
  else dlog('Caption tracks discovered', { count: tracks.length, langs: tracks.map(t => t.languageCode), kinds: tracks.map(t => t.kind) });

  const docLang = document.documentElement.getAttribute('lang');
  const prefLangs = [...new Set([...(docLang ? [docLang] : []), ...preferredLangsBase])];
  let chosen = selectCaptionTrack(tracks, prefLangs);
  if (chosen) dlog('Chosen caption track', { lang: chosen.languageCode, kind: chosen.kind });

  if (chosen) {
    const viaFormats = await fetchTrackFormats(chosen, cacheKey, chosen.languageCode);
    if (viaFormats?.cues.length) return { cues: viaFormats.cues, lang: viaFormats.lang, truncated: false };
    // Targeted timedtext attempts for chosen language before broad fallback
    if (chosen.languageCode) {
      for (const asrFlag of [false, true]) {
        const base = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(chosen.languageCode)}&v=${encodeURIComponent(videoId)}`;
        for (const fmt of ['json3', 'srv3', 'srv1']) {
          const url = base + `&fmt=${fmt}` + (asrFlag ? '&kind=asr' : '');
          dlog('Targeted timedtext attempt', { lang: chosen.languageCode, fmt, asr: asrFlag });
          try {
            const resp = await fetch(url, { credentials: 'omit' });
            if (!resp.ok) { dwarn('Targeted timedtext non-OK', { status: resp.status }); continue; }
            const txt = await resp.text();
            const cues = parseRawTranscriptText(txt);
            if (cues.length) { await saveTranscriptCache(cacheKey, cues, chosen.languageCode); dlog('Targeted timedtext success', { fmt, asr: asrFlag, cues: cues.length }); return { cues, lang: chosen.languageCode, truncated: false }; }
          } catch (e) { dwarn('Targeted timedtext exception', { err: (e as any)?.message }); }
        }
      }
    }
  }
  // If manual chosen failed, try explicit ASR track if distinct
  const asrAlt = tracks.filter(t => t.kind === 'asr' && t !== chosen)[0];
  if (asrAlt) {
    dlog('Attempting ASR alternative track', { lang: asrAlt.languageCode });
    const viaAsr = await fetchTrackFormats(asrAlt, cacheKey, asrAlt.languageCode);
    if (viaAsr?.cues.length) return { cues: viaAsr.cues, lang: viaAsr.lang, truncated: false };
  }

  // Generic timedtext fallback with expanded language & asr variants
  const fallbackLangs = [...prefLangs, 'en-uk', 'en-nz'];
  for (const lang of fallbackLangs) {
    for (const asr of [false, true]) {
      const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(videoId)}&fmt=json3${asr ? '&kind=asr' : ''}`;
      dlog('Timedtext fallback attempt', { lang, asr });
      try {
        const resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) { dwarn('Timedtext HTTP fail', { status: resp.status }); continue; }
        const txt = await resp.text();
        const cues = parseRawTranscriptText(txt);
        if (cues.length) { await saveTranscriptCache(cacheKey, cues, lang); dlog('Timedtext fallback success', { lang, asr, cues: cues.length }); return { cues, lang, truncated: false }; }
      } catch (e) { dwarn('Timedtext fetch exception', { lang, asr, err: (e as any)?.message }); }
    }
  }
  dlog('Transcript fetch: all strategies failed', { videoId });
  // Innertube fallback (player + transcripts endpoint)
  try {
    const meta = extractInnertubeMeta();
    if (meta) {
      dlog('Innertube meta extracted', { hasApiKey: !!meta.apiKey, clientName: meta.clientName, clientVersion: meta.clientVersion });
      const transcriptResult = await fetchInnertubeTranscript(videoId, meta);
      if (transcriptResult?.cues?.length) {
        await saveTranscriptCache(cacheKey, transcriptResult.cues, transcriptResult.lang);
        dlog('Innertube transcript success', { cues: transcriptResult.cues.length, lang: transcriptResult.lang });
        return { cues: transcriptResult.cues, lang: transcriptResult.lang, truncated: false };
      }
    } else {
      dlog('Innertube meta not found');
    }
  } catch (e) { dwarn('Innertube fallback error', (e as any)?.message); }
  return null;
};

// --- Innertube helpers ---
interface InnertubeMeta { apiKey: string; clientName: string; clientVersion: string; visitorData?: string; }

const extractInnertubeMeta = (): InnertubeMeta | null => {
  const win: any = window as any;
  // Attempt extraction from ytcfg
  try {
    if (win.ytcfg && typeof win.ytcfg.get === 'function') {
      const apiKey = win.ytcfg.get('INNERTUBE_API_KEY');
      const clientName = win.ytcfg.get('INNERTUBE_CLIENT_NAME');
      const clientVersion = win.ytcfg.get('INNERTUBE_CLIENT_VERSION');
      const visitorData = win.ytcfg.get('VISITOR_DATA');
      if (apiKey && clientName && clientVersion) return { apiKey, clientName: String(clientName), clientVersion, visitorData };
    }
  } catch { /* ignore */ }
  // Fallback: regex search scripts
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

const fetchInnertubeTranscript = async (videoId: string, meta: InnertubeMeta): Promise<{ cues: ExtractedCue[]; lang?: string; } | null> => {
  // First: get updated player response via Innertube player endpoint, to see available caption tracks (some may require signature/cookies otherwise)
  try {
    const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(meta.apiKey)}`;
    const body = {
      context: {
        client: {
          clientName: meta.clientName,
          clientVersion: meta.clientVersion,
          hl: 'en',
          gl: 'US',
          visitorData: meta.visitorData
        }
      },
      videoId
    };
    const prResp = await fetch(playerUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!prResp.ok) { dwarn('Innertube player response non-OK', { status: prResp.status }); return null; }
    const prJson = await prResp.json();
    const tracks: any[] = prJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) { dlog('Innertube player: no caption tracks'); return null; }
    const prefLangs = ['en', 'en-US', 'en-GB'];
    const pick = selectCaptionTrack(tracks as any, prefLangs) || tracks[0];
    if (!pick?.baseUrl) { dlog('Innertube player: no usable baseUrl'); return null; }
    dlog('Innertube chosen track', { lang: pick.languageCode, kind: pick.kind });
    // Use existing fetch logic (may still be blocked) but allow credentials include to let cookies through for restricted tracks
    try {
      const txt = await fetch(pick.baseUrl + (pick.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3', { credentials: 'include' }).then(r => r.ok ? r.text() : '');
      if (txt) {
        const cues = parseRawTranscriptText(txt);
        if (cues.length) return { cues, lang: pick.languageCode };
      }
    } catch (e) { dwarn('Innertube direct baseUrl fetch failed', (e as any)?.message); }
  } catch (e) { dwarn('Innertube player request error', (e as any)?.message); }
  return null;
};

const extractVideo = async (): Promise<ExtractedVideo> => {
  try {
    const vid = document.querySelector('video') as HTMLVideoElement | null;
    if (!vid) { dlog('No <video> element found'); return { hasVideo: false }; }
    let src = vid.currentSrc || vid.src || '';
    if (!src) {
      const ogVideoEl = document.querySelector('meta[property="og:video"]') as HTMLMetaElement | null;
      const ogVideo = ogVideoEl?.content;
      if (ogVideo) src = ogVideo;
    }
    const ogTitleEl = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    const title = ogTitleEl?.content || document.title || '';
    const durationSec = Number.isFinite(vid.duration) ? Math.round(vid.duration) : undefined;

    // In-page cues first
    let cues: ExtractedCue[] = [];
    try {
      for (const track of Array.from(vid.textTracks || [])) {
        const list = track?.cues as TextTrackCueList | null | undefined;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i] as TextTrackCue & { text?: string; };
          if ((c as any)?.text) cues.push({
            text: (c as any).text,
            startTime: Math.round(c.startTime),
            endTime: Math.round(c.endTime)
          });
          if (cues.length >= 200) break; // larger cap for initial track
        }
        if (cues.length >= 200) break;
      }
    } catch (_ignored) { }
    dlog('In-page cues collected', { count: cues.length });

    // Determine pageUrl and platform
    let pageUrl: string | undefined;
    const canonicalHref = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href;
    const ogUrl = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content;
    pageUrl = canonicalHref || ogUrl;
    const href = location.href as string;
    if (!pageUrl) {
      if (/youtube\.com\/watch/.test(href) || /youtu\.be\//.test(href)) {
        pageUrl = href;
      } else {
        const iframe = Array.from(document.querySelectorAll('iframe')).find((f) => /youtube\.com\/embed\//.test((f as HTMLIFrameElement).src)) as HTMLIFrameElement | undefined;
        const m = iframe?.src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
        if (m && m[1]) pageUrl = `https://www.youtube.com/watch?v=${m[1]}`;
      }
    }
    const sourcePlatform = detectPlatformFromUrl(pageUrl || src || location.href);
    dlog('Platform detected', { sourcePlatform, pageUrl, src });

    let transcriptSource: 'inpage' | 'fetched' | 'none' = cues.length ? 'inpage' : 'none';
    let transcriptLanguage: string | undefined;
    let transcriptTruncated = false;

    // Attempt fetch if YouTube and cues are insufficient
    if (sourcePlatform === VIDEO_PLATFORM.youtube) {
      const videoId = getYouTubeVideoId(pageUrl || href);
      if (videoId && cues.length < 20) {
        dlog('Attempting fetched transcript (in-page insufficient)', { videoId, inPageCount: cues.length });
        const fetched = await fetchYouTubeTranscript(videoId);
        if (fetched && fetched.cues.length > cues.length) {
          cues = fetched.cues;
          transcriptSource = 'fetched';
          transcriptLanguage = fetched.lang;
          transcriptTruncated = fetched.truncated;
          dlog('Fetched transcript adopted', { newCount: cues.length, transcriptLanguage, transcriptTruncated });
        }
      }
    }

    if (!cues.length) transcriptSource = 'none';

    const result: ExtractedVideo = { hasVideo: true, src, title, durationSec, cues, transcriptSource, transcriptLanguage, transcriptTruncated, pageUrl, sourcePlatform };
    dlog('Video extraction complete', { transcriptSource: result.transcriptSource, cues: result.cues?.length || 0 });
    return result;
  } catch (_e) {
    dwarn('extractVideo: failure');
    return { hasVideo: false };
  }
};

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg?.type === 'EXTRACT_PAGE') {
    dlog('Message received: EXTRACT_PAGE');
    (async () => {
      const t0 = performance.now();
      const video = await extractVideo();
      const mainText = extractMainText();
      dlog('Main text length', { length: mainText.length });
      const extract: ExtractedPage = { url: location.href, title: document.title || '', mainText, video };
      dlog('Sending extraction response', { elapsedMs: Math.round(performance.now() - t0) });
      sendResponse(extract);
    })();
    return true; // async
  }
});
// End of content script debug instrumentation
