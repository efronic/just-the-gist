// Centralized types for page and video extraction

export type VideoPlatform = 'youtube' | 'vimeo' | 'other';

export const VIDEO_PLATFORM = {
    youtube: 'youtube',
    vimeo: 'vimeo',
    other: 'other'
} as const;

export type ExtractedCue = {
    text: string;
    startTime: number;
    endTime: number;
};

export interface ExtractedVideoBase {
    hasVideo: boolean;
}
export interface NoVideo extends ExtractedVideoBase {
    hasVideo: false;
}
export interface HasVideo extends ExtractedVideoBase {
    hasVideo: true;
    src?: string;
    videoId?: string;
    title?: string;
    durationSec?: number;
    cues: ExtractedCue[]; // Present (can be empty array)
    transcriptSource: 'inpage' | 'fetched' | 'none';
    transcriptLanguage?: string;
    transcriptTruncated?: boolean;
    pageUrl?: string;
    sourcePlatform?: VideoPlatform;
}
export type ExtractedVideo = NoVideo | HasVideo;

export interface ExtractedPage {
    url: string;
    title: string;
    mainText: string;
    video: ExtractedVideo;
}

// Summarization modes shared across UI and background
export type SummarizeMode = 'auto' | 'page' | 'video';
export const SUMMARIZE_MODE = {
    auto: 'auto',
    page: 'page',
    video: 'video'
} as const;

// Detail levels and their limits (centralized so popup/background stay in sync)
export const DETAIL_LEVELS = ['concise', 'standard', 'detailed', 'expanded'] as const;
export type DetailLevel = typeof DETAIL_LEVELS[number];
export const PAGE_CHAR_LIMIT: Record<DetailLevel, number> = {
    concise: 4000,
    standard: 8000,
    detailed: 15000,
    expanded: 22000
};
export const CUE_LIMIT: Record<DetailLevel, number | 'all'> = {
    concise: 60,
    standard: 200,
    detailed: 'all',
    expanded: 'all'
};

// Transcript cache entry shape in chrome.storage.local (for YouTube primarily)
export interface TranscriptCacheEntry {
    cues: ExtractedCue[];
    lang?: string;
    truncated?: boolean;
}
