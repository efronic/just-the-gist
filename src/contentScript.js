function extractMainText() {
  try {
    // Prefer <article>
    const article = document.querySelector('article');
    const root = article || document.body;
    // Collect readable text nodes from headings and paragraphs
    const parts = [];
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote').forEach(el => {
      const t = el.innerText?.trim();
      if (t && t.length > 1) parts.push(t);
    });
    let text = parts.join('\n');
    // Collapse whitespace and limit
    text = text.replace(/\n{3,}/g, '\n\n');
    if (text.length > 30000) text = text.slice(0, 30000) + '\n...[truncated]';
    return text;
  } catch (e) {
    return document.title || '';
  }
}

function extractVideo() {
  try {
    const vid = document.querySelector('video');
    if (!vid) return { hasVideo: false };
    let src = vid.currentSrc || vid.src || '';
    // Try common meta if page is YouTube or has meta tags
    if (!src) {
      const ogVideo = document.querySelector('meta[property="og:video"]')?.content;
      if (ogVideo) src = ogVideo;
    }

    const title = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
    const durationSec = Number.isFinite(vid.duration) ? Math.round(vid.duration) : undefined;

    let cues = [];
    try {
      for (const track of vid.textTracks || []) {
        // Ensure cues are loaded
        const list = track?.cues;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c?.text) cues.push({
            text: c.text,
            startTime: Math.round(c.startTime),
            endTime: Math.round(c.endTime)
          });
          if (cues.length >= 60) break; // cap
        }
        if (cues.length >= 60) break;
      }
    } catch (_) {
      // Ignore cross-origin issues
    }

    return { hasVideo: true, src, title, durationSec, cues };
  } catch (e) {
    return { hasVideo: false };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_PAGE') {
    const extract = {
      url: location.href,
      title: document.title || '',
      mainText: extractMainText(),
      video: extractVideo()
    };
    sendResponse(extract);
  }
});
