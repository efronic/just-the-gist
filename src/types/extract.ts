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

export type ExtractedVideo = {
    // Indicates if the page has a primary video
    hasVideo: boolean;
    // Direct media source or embed source if available
    src?: string;
    // Human-readable title of the video
    title?: string;
    // Length of the video in seconds, if detectable
    durationSec?: number;
    // Up to N cues (e.g., from text tracks / captions)
    cues?: ExtractedCue[];
    // Canonical video page URL if known (e.g., a YouTube watch URL)
    pageUrl?: string;
    // Detected video platform (used for platform-aware logic)
    sourcePlatform?: VideoPlatform;
};

export type ExtractedPage = {
    url: string;
    title: string;
    mainText: string;
    video: ExtractedVideo;
};

// Summarization modes shared across UI and background
export type SummarizeMode = 'auto' | 'page' | 'video';
export const SUMMARIZE_MODE = {
    auto: 'auto',
    page: 'page',
    video: 'video'
} as const;
