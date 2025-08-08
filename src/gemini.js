export async function callGemini({ apiKey, model = 'gemini-1.5-flash', input }) {
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
      maxOutputTokens: 2048
    }
  };

  const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ||
               data?.candidates?.[0]?.content?.parts?.[0]?.text ||
               '';
  if (!text) throw new Error('Empty response from Gemini.');
  return text;
}
