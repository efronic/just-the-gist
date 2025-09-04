# Type System Overview

This document summarizes the core TypeScript model for the Just the Gist extension after the refactor.

## Runtime Messages

Defined in `src/types/messages.ts` as a discriminated union:

- `ExtractPageRequest` (`type: 'EXTRACT_PAGE'`)
- `SummarizeTabRequest` (`type: 'SUMMARIZE_TAB'`)

Helpers:

- `isRuntimeMessage(msg)` – runtime guard for either supported message.
- `isExtractPageRequest(msg)` / `isSummarizeTabRequest(msg)` – narrow to a specific message shape.

This removes the prior untyped `any` listener usage and ensures compile‑time safety during refactors.

## Extraction Model

`ExtractedVideo` is now a discriminated union:

- `NoVideo` – `{ hasVideo: false }`
- `HasVideo` – `{ hasVideo: true; src?; videoId?; title?; durationSec?; cues: ExtractedCue[]; transcriptSource; transcriptLanguage?; transcriptTruncated?; pageUrl?; sourcePlatform? }`

Advantages:

- Eliminates optional chaining at call sites (`video.hasVideo ? video.cues ...`).
- Prevents accidental access to video‑specific fields when no video exists.

`ExtractedPage` contains `{ url; title; mainText; video }`.

## Transcript Cache

Central interface: `TranscriptCacheEntry` `{ cues: ExtractedCue[]; lang?; truncated? }` used for `chrome.storage.local` entries keyed by `yt_transcript_<videoId>`.

## Detail Levels

Centralized constants in `types/extract.ts`:

- `DETAIL_LEVELS`: tuple of allowed levels.
- `DetailLevel` union type.
- `PAGE_CHAR_LIMIT` & `CUE_LIMIT` maps unify logic between popup and background.

## Future Extension Points

Recommended next enhancements (not yet implemented):

1. Add parsing result types for transcript fetch attempts with discriminated `status` (`ok` / `rate_limited` / `unavailable`).
2. Introduce `PromptContext` type bundling all inputs to the Gemini call for easier testability.
3. Add branded type for `VideoId` (`type VideoId = string & { readonly brand: unique symbol }`) to avoid mixing with arbitrary strings.
4. Provide a `Result<T, E>` helper for operations like transcript fetch, replacing current null returns.
5. Expose a lightweight public `index.d.ts` for external tooling or future integration tests.

## Testing Considerations

With the discriminated unions in place, unit tests (if added) can quickly assert exhaustiveness via `switch(video.hasVideo)` and `never` checks to catch future shape changes.

---

This refactor increases safety for navigation edge cases and simplifies reasoning about extraction flows. Feel free to extend this doc as the model evolves.
