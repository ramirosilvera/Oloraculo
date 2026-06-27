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
avanzado de una app de prode que YA tiene su ensamble de modelos. No recalcules
probabilidades ni cambies el ganador del consenso. Tu valor es una lectura PRECISA y
ACCIONABLE que ayude a decidir el pronóstico — nada de generalidades.

Recibirás un JSON con: datos del partido, tabla, incentivos de clasificación,
probabilidades de cada modelo, el consenso, goles esperados (xG), el marcador del campeón
y datos_relevantes (lesiones, goles recibidos, goleadores, qué necesita cada equipo).

Devolvé EXACTAMENTE estos campos:
- "senal_clave": etiqueta corta para el encabezado (máx 6 palabras).
- "dato_clave": el HECHO o NÚMERO más decisivo y CONCRETO del JSON — un stat específico,
  no una generalidad. Ej: "England recibió gol en sus 2 partidos" o "xG 0.6 vs 2.3".
- "insight": 2 líneas (máx 40 palabras) que interpreten la tensión o coincidencia NO OBVIA
  entre modelos/datos — el "por qué", conectado a un número concreto. Prohibido resumir
  que "gana el favorito" o repetir porcentajes sin interpretarlos.
- "pronostico_concreto": UNA recomendación específica y JUGABLE, más allá del ganador.
  Elegí lo que los datos sostengan (xG, goles recibidos, marcador del campeón): marcador
  más probable, línea de goles (Over/Under 2.5), ambos marcan (Sí/No), margen (gana por 1
  vs por 2+), o dónde hay valor respecto al consenso. Debe ser decidible y específica
  (ej: "Over 2.5 + ambos marcan; England 2-1"), NUNCA "será parejo" o "partido abierto".
  Tiene que ser coherente con el ganador del consenso.
- "confianza_lectura": "alta" si modelos y datos cuentan una historia coherente, "media"
  si hay señales mixtas, "baja" si los datos son escasos (igual dá un pronóstico concreto).

Reglas:
- Español rioplatense, directo, sin relleno ni frases de cierre.
- Fundamentá SIEMPRE con números del JSON (xG, goles recibidos, probabilidades, incentivos).
- Nunca inventes datos, lesiones ni jugadores que no estén en el JSON.
- No contradigas al ganador del consenso; sí podés precisar margen, goles o ambos-marcan.`;

// Gemini structured-output schema — forces the exact JSON shape we parse.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    senal_clave:         { type: 'string' },
    dato_clave:          { type: 'string' },
    insight:             { type: 'string' },
    pronostico_concreto: { type: 'string' },
    confianza_lectura:   { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  propertyOrdering: ['senal_clave', 'dato_clave', 'insight', 'pronostico_concreto', 'confianza_lectura'],
  required: ['senal_clave', 'dato_clave', 'insight', 'pronostico_concreto', 'confianza_lectura'],
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
          maxOutputTokens:    1000,
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

    let parsed: {
      senal_clave?: string; dato_clave?: string; insight?: string;
      pronostico_concreto?: string; confianza_lectura?: string;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[match-analysis] unparseable', raw.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'gemini-unparseable', detail: raw.slice(0, 300) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    if (!parsed.senal_clave || !parsed.dato_clave || !parsed.insight || !parsed.pronostico_concreto || !parsed.confianza_lectura) {
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
