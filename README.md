# JustTheGist (Chrome/Edge MV3)

A minimal Chrome/Edge extension that summarizes the current page (and any detected video metadata and cues) with Google Gemini. The page URL is always included in the prompt.

## Features

- Popup button to summarize the active tab
- Context menu entry: right-click anywhere and choose "Summarize with Gemini"
- Options page to set your Gemini API key and preferred model
- Extracts main page text and basic <video> metadata + text tracks (when accessible)

## Setup

1) Get a Google Gemini API key from Google AI Studio: https://aistudio.google.com/app/apikey

2) In the extension Options page, paste your API key and pick a model (default: gemini-2.5-flash).

3) Load the extension in Chrome/Edge:
   - Navigate to chrome://extensions (or edge://extensions)
   - Enable Developer mode
   - Click "Load unpacked" and select this folder

## Usage

- Click the extension icon, optionally choose a mode (Auto/Page/Video), then press "Summarize this page".
- Or right-click on a page and use the context menu entry.
- The summary appears in the popup.

## Notes

- The extension uses a service worker background script (MV3). Requests to the Gemini API are made from the background.
- If a <video> element is present and text tracks are accessible (same-origin), the first ~60 cues are included in the prompt.
- Some sites restrict content extraction; the extension falls back to best-effort text via visible headings, paragraphs, and list items.

## Security

- Your API key is stored in Chrome sync storage and used only to call the Gemini API.
- Do not commit your API key to source control.

## Files

- manifest.json — MV3 config
- src/background.ts — handles context menu, messages, and calls Gemini
- src/contentScript.ts — extracts page text and video metadata
- src/gemini.ts — minimal Gemini API client (fetch)
- src/popup.html/ts/css — popup UI
- src/options.html/ts — options page for API key and model

## License

MIT
