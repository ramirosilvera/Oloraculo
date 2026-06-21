/**
 * POST /api/gemini-analysis
 * Body: { snapshots: CondensedSnapshot[] }
 *
 * Calls Gemini 1.5 Flash with condensed tournament simulation data and
 * returns a structured markdown analysis in Spanish.
 *
 * Env vars (set in Cloudflare Pages):
 *   GEMINI_API_KEY
 */

interface Env {
  GEMINI_API_KEY: string;
}

interface CondensedTeam {
  equipo:    string;
  grupo:     string;
  clasifica: number;
  semis:     number;
  final:     number;
  campeon:   number;
}

interface CondensedSnapshot {
  fecha:        string;
  simulaciones: number;
  top15:        CondensedTeam[];
}

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function buildPrompt(snapshots: CondensedSnapshot[]): string {
  const n         = snapshots.length;
  const firstDate = snapshots[0]?.fecha ?? '';
  const lastDate  = snapshots[n - 1]?.fecha ?? '';

  let data = '';
  for (const snap of snapshots) {
    data += `\n--- ${snap.fecha}  (${snap.simulaciones.toLocaleString('es')} sims) ---\n`;
    data += `Equipo              | Grp | Clasif | SF   | Final | Campeón\n`;
    for (const t of snap.top15) {
      const name = t.equipo.padEnd(18).slice(0, 18);
      const grp  = t.grupo.padEnd(3);
      data += `${name} | ${grp} | ${String(t.clasifica).padStart(5)}% | ${String(t.semis).padStart(4)}% | ${String(t.final).padStart(4)}% | ${String(t.campeon).padStart(5)}%\n`;
    }
  }

  return `Eres un analista experto en predicciones estadísticas de fútbol.
Analizás la evolución de simulaciones Monte Carlo del Mundial FIFA 2026 a medida que avanza el torneo.

Se tomaron ${n} snapshots entre el ${firstDate} y el ${lastDate}.
Cada snapshot ejecutó miles de simulaciones para calcular la probabilidad de cada selección de llegar a cada fase.

DATOS DE LAS SIMULACIONES:
${data}

Analizá la evolución y respondé ÚNICAMENTE con el siguiente formato markdown en español:

## Resumen
[2-3 oraciones resumiendo qué se observa globalmente en la evolución de las simulaciones]

## Favorito actual
[El equipo líder, su probabilidad actual, cómo evolucionó desde el primer snapshot y qué factores probablemente explican el cambio]

## Mayores movimientos
[Los 3-4 equipos con cambios más notorios entre la primera y la última simulación. Usá ↑ o ↓ y puntos porcentuales exactos]

## Tendencias del modelo
[3-4 patrones que se repiten en las simulaciones: concentración de favoritos, equipos consistentes, volatilidad, sesgos detectados]

## Qué mirar en la próxima simulación
[2-3 puntos concretos a observar: partidos clave pendientes, equipos en zona de inflexión, grupos o llaves que pueden cambiar el mapa]

Usá datos específicos de los snapshots. Sé conciso y directo. No uses asteriscos dobles excepto para resaltar nombres de equipos o cifras clave.`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured in Cloudflare Pages.' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  let body: { snapshots?: CondensedSnapshot[] };
  try {
    body = await request.json() as { snapshots?: CondensedSnapshot[] };
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  if (!Array.isArray(body.snapshots) || body.snapshots.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No snapshots provided.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const prompt = buildPrompt(body.snapshots);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.65,
          maxOutputTokens: 1400,
          topP:            0.9,
        },
      }),
      signal: controller.signal,
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `gemini-${geminiRes.status}`, detail: errText.slice(0, 300) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const geminiData = await geminiRes.json() as any;
    const analysis: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!analysis) {
      return new Response(
        JSON.stringify({ error: 'gemini-empty-response' }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? 'internal' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } finally {
    clearTimeout(timer);
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
