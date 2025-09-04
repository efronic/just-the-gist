// Centralized Chrome runtime message types & helpers
// This creates a discriminated union so listeners can narrow on msg.type safely.

import type { SummarizeMode, ExtractedPage } from './extract';

export interface SummarizeTabRequest {
    type: 'SUMMARIZE_TAB';
    tabId: number;
    mode: SummarizeMode;
    detailLevel: string;
}

export interface ExtractPageRequest {
    type: 'EXTRACT_PAGE';
    mode: SummarizeMode;
}

export type InboundRuntimeMessage = SummarizeTabRequest | ExtractPageRequest;

export interface SummarizeTabSuccess {
    ok: true;
    result: { text: string; extract: ExtractedPage; };
}
export interface SummarizeTabFailure {
    ok: false;
    error: string;
}
export type SummarizeTabResponse = SummarizeTabSuccess | SummarizeTabFailure;

export const isRuntimeMessage = (msg: any): msg is InboundRuntimeMessage => {
    return msg && typeof msg === 'object' && typeof msg.type === 'string' && (
        msg.type === 'SUMMARIZE_TAB' || msg.type === 'EXTRACT_PAGE'
    );
};

export const isSummarizeTabRequest = (msg: InboundRuntimeMessage): msg is SummarizeTabRequest => msg.type === 'SUMMARIZE_TAB';
export const isExtractPageRequest = (msg: InboundRuntimeMessage): msg is ExtractPageRequest => msg.type === 'EXTRACT_PAGE';
