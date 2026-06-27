/**
 * POST /api/match-analysis
 * Body: { input_data: MatchAnalysisInput }
 *
 * Calls Gemini 2.5 Flash with a single match's structured data and returns a
 * short expert "insight" (the why behind the numbers) as strict JSON. The model
 * never recomputes probabilities or contradicts the ensemble consensus.
 *
 * Env vars (set in Cloudflare Pages):
 *   GEMINI_API_KEY
 *
 * On any failure returns a non-200 JSON error; the frontend degrades silently
 * (hides the AI block) rather than surfacing an error.
 */

interface Env {
  GEMINI_API_KEY: string;
}

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SYSTEM_PROMPT = `Eres un analista experto en fútbol y modelos predictivos, escribiendo para un usuario
avanzado de una app de prode (predicciones) que ya tiene su propio ensamble de modelos
estadísticos. Tu trabajo NO es recalcular probabilidades — ya están dadas — sino dar
una lectura breve que un usuario experto no vería a simple vista mirando los números.

Recibirás un JSON con: datos del partido, posición en la tabla de grupo, incentivos de
clasificación de cada equipo, las probabilidades de cada modelo del ensamble, el consenso,
y una lista de datos relevantes (lesiones, rachas, suspensiones, qué necesita cada equipo).

Generá un análisis de 2-3 líneas (máximo 50 palabras) que:
1. Señale la tensión o coincidencia MÁS interesante entre los modelos (ej: si el consenso
   dice empate pero Poisson solo se aparta con una victoria, explicá en una frase por qué
   pasa eso, conectándolo con datos_relevantes — no repitas los porcentajes, interpretalos).
2. Mencione el incentivo de clasificación si es relevante para cómo se va a jugar el
   partido (ej: un equipo que solo necesita empatar suele jugar distinto a uno obligado
   a ganar).
3. NUNCA contradigas el consenso del ensamble ni propongas tu propio pick de 1X2 distinto
   al consenso — tu rol es explicar el "por qué" detrás de los números, no generar una
   predicción nueva o paralela.

Reglas de estilo:
- Español rioplatense, tono directo y analítico, sin relleno ni frases de cierre tipo
  "en resumen" o "será un partido interesante".
- No repitas el marcador exacto del pronóstico de campeón si ya está visible en otra
  parte de la tarjeta — enfocate en el INSIGHT, no en restating de datos ya mostrados.
- Si los datos_relevantes no alcanzan para decir algo no obvio, es mejor un análisis más
  corto y específico que uno largo y genérico.
- Nunca inventes datos, lesiones o nombres de jugadores que no estén en el JSON de entrada.

"confianza_lectura" refleja qué tan claro es el patrón en los datos: "alta" si los
modelos y los datos_relevantes cuentan una historia coherente, "media" si hay señales
mixtas, "baja" si los datos_relevantes son escasos y el insight es más especulativo.`;

// Gemini structured-output schema — forces the exact JSON shape we parse.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    insight:            { type: 'string' },
    senal_clave:        { type: 'string' },
    confianza_lectura:  { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['insight', 'senal_clave', 'confianza_lectura'],
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured in Cloudflare Pages.' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  let body: { input_data?: unknown };
  try {
    body = await request.json() as { input_data?: unknown };
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  if (!body.input_data || typeof body.input_data !== 'object') {
    return new Response(
      JSON.stringify({ error: 'No input_data provided.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const prompt = `${SYSTEM_PROMPT}\n\nDATOS DEL PARTIDO (input_data):\n${JSON.stringify(body.input_data)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:        0.35,
          // 2.5-flash "thinking" is on by default and eats maxOutputTokens; with
          // a small budget the text comes back EMPTY (finishReason MAX_TOKENS).
          // Disable thinking + give headroom so the JSON actually fits.
          thinkingConfig:     { thinkingBudget: 0 },
          maxOutputTokens:    800,
          topP:               0.9,
          responseMimeType:   'application/json',
          responseSchema:     RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('[match-analysis] gemini http', geminiRes.status, errText.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `gemini-${geminiRes.status}`, detail: errText.slice(0, 500) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiData = await geminiRes.json() as any;
    const cand = geminiData.candidates?.[0];
    const raw: string = cand?.content?.parts?.[0]?.text ?? '';
    // Diagnostics surfaced in the error body so the client can log the real cause.
    const diag = {
      finishReason:   cand?.finishReason ?? null,
      promptFeedback: geminiData.promptFeedback ?? null,
      usage:          geminiData.usageMetadata ?? null,
    };

    if (!raw) {
      console.error('[match-analysis] empty output', diag);
      return new Response(
        JSON.stringify({ error: 'gemini-empty-response', detail: diag }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    let parsed: { insight?: string; senal_clave?: string; confianza_lectura?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[match-analysis] unparseable', raw.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'gemini-unparseable', detail: raw.slice(0, 300) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    if (!parsed.insight || !parsed.senal_clave || !parsed.confianza_lectura) {
      return new Response(
        JSON.stringify({ error: 'gemini-incomplete', detail: parsed }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'internal';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } finally {
    clearTimeout(timer);
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
