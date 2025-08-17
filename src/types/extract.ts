// Centralized types for page and video extraction

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
    sourcePlatform?: 'youtube' | 'vimeo' | 'other';
};

export type ExtractedPage = {
    url: string;
    title: string;
    mainText: string;
    video: ExtractedVideo;
};
