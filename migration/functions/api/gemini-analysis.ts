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
  const first     = snapshots[0]?.top15  ?? [];
  const last      = snapshots[n - 1]?.top15 ?? [];

  // Delta table: compare champion % from first to last snapshot
  const firstMap = new Map(first.map(t => [t.equipo, t]));
  const lastMap  = new Map(last.map(t => [t.equipo, t]));
  const allTeams = [...new Set([...first.map(t => t.equipo), ...last.map(t => t.equipo)])];
  const deltas = allTeams
    .map(eq => ({
      eq,
      ini:   firstMap.get(eq)?.campeon ?? 0,
      fin:   lastMap.get(eq)?.campeon  ?? 0,
      delta: (lastMap.get(eq)?.campeon ?? 0) - (firstMap.get(eq)?.campeon ?? 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12);

  let deltaTable = `Equipo              | Ini Campeón | Act Campeón |    Δ\n`;
  for (const d of deltas) {
    const sign  = d.delta >= 0 ? '↑ +' : '↓ ';
    const name  = d.eq.padEnd(18).slice(0, 18);
    deltaTable += `${name} | ${String(d.ini).padStart(10)}% | ${String(d.fin).padStart(10)}% | ${sign}${Math.abs(d.delta).toFixed(1)}pp\n`;
  }

  // Full evolution data
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

  return `Sos un analista de fútbol con criterio. Seguís la táctica, entendés cómo los modelos estadísticos funcionan y podés explicar por qué los números dicen lo que dicen. Estás hablando con alguien que también sigue el fútbol —no necesitás explicar conceptos básicos, pero sí tenés que justificar los números con argumentos futbolísticos reales.

Escribí como si hablaras, no como si redactaras una nota. Sin exaltación ni dramatismo. Si algo es interesante, que el argumento lo muestre. No inflés lo que no lo merece. Sin signos de exclamación. Sin frases tipo "esto es clave", "no hay que perder de vista" o "vale la pena destacar" —si algo importa, el razonamiento lo va a dejar claro solo. No repitas los números de la tabla: interpretalos.

MOVIMIENTOS MÁS IMPORTANTES (primer → último snapshot):
${deltaTable}

EVOLUCIÓN COMPLETA (${n} snapshots, ${firstDate} → ${lastDate}):
${data}

Usá tu conocimiento del Mundial FIFA 2026 —resultados, posiciones en grupos, fixture del cuadro, rendimiento de los equipos— para explicar causas reales detrás de los movimientos. Si un equipo subió, decí por qué: ¿un rival cayó? ¿el cuadro le quedó más libre? ¿ganó de una manera que el modelo pondera bien? Si bajó, qué lo explica.

Respondé con exactamente estas cuatro secciones y nada más:

## Cómo está el torneo
Una lectura rápida del estado actual: quiénes dominan las probabilidades, si hay un favorito claro o el torneo está abierto, qué tan concentradas están las chances. Una o dos ideas concretas, sin relleno.

## Por qué están donde están
El corazón del análisis. Para los equipos más relevantes, explicá qué los pone en esa posición: no basta con decir que tienen el 34%, explicá qué tiene ese equipo —plantel, sistema, momento del torneo, posición en el cuadro— que hace que el modelo los vea así. Nombrá jugadores o características concretas si ayudan al argumento.

## Qué cambió y por qué
Para los mayores movimientos del delta, conectalos con lo que pasó en la cancha o en el fixture. Un resultado que modificó el cuadro, un equipo que se eliminó y liberó un camino, un rendimiento por encima o por debajo de lo esperado. Si el cambio es ruido estadístico sin causa clara, decilo también.

## Qué mirar en los próximos días
Uno o dos partidos o situaciones concretas que pueden mover el mapa de probabilidades. No en abstracto —qué resultado específico cambiaría qué cosa y por qué.

Extensión total: entre 280 y 400 palabras. Texto corrido, sin listas de bullets.`;
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
          temperature:     0.7,
          maxOutputTokens: 2500,
          topP:            0.92,
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
