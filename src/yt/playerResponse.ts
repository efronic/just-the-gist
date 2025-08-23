import { dlog, dwarn } from '../log.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const readWindowPlayerResponse = (): any | undefined => {
    const wAny = window as any;
    if (wAny.ytInitialPlayerResponse) return wAny.ytInitialPlayerResponse;
    const prStr = wAny.ytplayer?.config?.args?.player_response;
    if (prStr && typeof prStr === 'string') { try { return JSON.parse(prStr); } catch { } }
    return undefined;
};

export const parsePlayerResponseFromScripts = (): any | undefined => {
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

export const getPlayerResponseWithRetry = async (): Promise<any | undefined> => {
    for (let attempt = 0; attempt < 6; attempt++) {
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
