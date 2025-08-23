import type { ExtractedCue } from '../types/extract';

export const parseRawTranscriptText = (raw: string): ExtractedCue[] => {
    const trimmed = raw.trim().replace(/^\)]}'/, '');
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
        } catch { }
    }
    if (trimmed.includes('<transcript') || trimmed.includes('<text')) {
        const regex = /<text[^>]*start="([0-9.]+)"[^>]*dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
        const cues: ExtractedCue[] = []; let m: RegExpExecArray | null;
        while ((m = regex.exec(trimmed))) {
            const start = parseFloat(m[1]); const dur = parseFloat(m[2]);
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
