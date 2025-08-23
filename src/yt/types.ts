import type { ExtractedCue } from '../types/extract';

export interface YtCaptionTrackMeta { baseUrl: string; languageCode?: string; vssId?: string; kind?: string; name?: any; }
export interface InnertubeMeta { apiKey: string; clientName: string; clientVersion: string; visitorData?: string; }
export interface FetchTranscriptResult { cues: ExtractedCue[]; lang?: string; truncated: boolean; }
