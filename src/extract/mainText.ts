import { dlog, dwarn } from '../log.js';

export const extractMainText = (): string => {
    try {
        dlog('extractMainText: start');
        const article = document.querySelector('article');
        const root = (article as HTMLElement) || document.body;
        const parts: string[] = [];
        root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote').forEach((el) => {
            const t = (el as HTMLElement).innerText?.trim();
            if (t && t.length > 1) parts.push(t);
        });
        let text = parts.join('\n');
        text = text.replace(/\n{3,}/g, '\n\n');
        if (text.length > 30000) {
            dlog('extractMainText: truncating large text', { originalLength: text.length });
            text = text.slice(0, 30000) + '\n...[truncated]';
        }
        dlog('extractMainText: done', { length: text.length });
        return text;
    } catch {
        dwarn('extractMainText: failed; falling back to title');
        return document.title || '';
    }
};
