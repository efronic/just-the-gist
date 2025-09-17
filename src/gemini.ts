// Shared log tag (background context). We keep it simple vs reusing content tag to avoid confusion in DevTools.
const BG_TAG = '[gist][bg]';

interface GeminiCallOptionsBase {
  apiKey: string;
  model?: string;
  input: string;
  maxOutputTokens?: number; // allow caller to tune for detail level
}

export interface GeminiCallResultMeta {
  text: string;
  finishReason?: string;
  blockReason?: string;
  candidates?: number;
}

export const callGeminiRaw = async ({ apiKey, model = 'gemini-2.5-flash', input, maxOutputTokens }: GeminiCallOptionsBase): Promise<GeminiCallResultMeta> => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: input }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: maxOutputTokens ?? 2048
    }
  } as const;

  let res: Response;
  try {
    res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn(BG_TAG, 'Gemini fetch failed', (e as any)?.message);
    throw e;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Gemini response JSON parse error: ' + (e as any)?.message);
  }

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const promptFeedback = data?.promptFeedback;
  const first = candidates[0];
  const text: string = first?.content?.parts?.map((p: any) => p?.text || '').join('')?.trim() || '';
  const finishReason = first?.finishReason;
  const blockReason = promptFeedback?.blockReason;

  if (!text) {
    // Provide richer diagnostics so the UI can decide on fallback behavior.
    const safetyRatings = promptFeedback?.safetyRatings || first?.safetyRatings;
    const safetyBrief = Array.isArray(safetyRatings)
      ? safetyRatings.map((r: any) => `${r.category}:${r.probability}`).join(',')
      : undefined;
    const metaPieces = [
      blockReason && `blockReason=${blockReason}`,
      finishReason && `finishReason=${finishReason}`,
      safetyBrief && `safetyRatings=${safetyBrief}`,
      `candidates=${candidates.length}`
    ].filter(Boolean);
    const meta = metaPieces.join(' | ');
    console.warn(BG_TAG, 'Gemini returned empty text', { meta, raw: data });
    throw new Error(`Gemini returned no content${meta ? ` (${meta})` : ''}.`);
  }

  console.log(BG_TAG, 'Gemini response OK', { chars: text.length, finishReason, blockReason, candidates: candidates.length });
  return { text, finishReason, blockReason, candidates: candidates.length };
};

// Backwards compatible helper returning just text
export const callGemini = async (opts: GeminiCallOptionsBase): Promise<string> => {
  const r = await callGeminiRaw(opts);
  return r.text;
};
