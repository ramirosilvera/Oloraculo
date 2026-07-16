import { type Env, json, preflight } from '../_shared';

const SYSTEM = `Sos un asesor de carteras estilo Munger/Buffett. Te paso la lista de posiciones
(ticker, sector, rol, peso objetivo) de un portfolio. En español rioplatense, en 5-8 frases,
analizá SOLO lo cualitativo:
- Concentración: ¿hay una o dos posiciones que dominan el riesgo?
- Correlación / factores: ¿hay posiciones que son la misma apuesta (mismo sector, mismo
  driver macro, ej. dos empresas de litio, o todo tecnología)?
- Diversificación sectorial: ¿está balanceado o sesgado?
- Coherencia: ¿la mezcla es consistente con una estrategia de calidad de largo plazo?
No inventes precios ni números que no estén. No des recomendación de compra/venta; señalá
riesgos de construcción de cartera. Sé concreto.`;

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY no configurada' }, 503);
  const body = await request.json().catch(() => ({})) as { posiciones?: unknown };
  if (!body.posiciones) return json({ error: 'posiciones requeridas' }, 400);

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const prompt = `${SYSTEM}\n\nPOSICIONES:\n${JSON.stringify(body.posiciones)}`;

  let text = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 700 } }),
    });
    if (res.status === 429 || res.status === 503) { await new Promise(r => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    if (!res.ok) return json({ error: `gemini-${res.status}` }, 502);
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    break;
  }
  if (!text) return json({ error: 'gemini-sin-respuesta' }, 502);
  return json({ analisis: text, modelo: model });
};
