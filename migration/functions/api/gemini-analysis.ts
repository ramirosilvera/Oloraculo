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

  return `Sos un analista de fútbol apasionado que escribe para una revista deportiva de primer nivel —mezcla de periodismo de cancha, ojo táctico y pasión mundialera. Tu misión: interpretar la evolución de las simulaciones del Mundial FIFA 2026 de manera que cualquier hincha lo entienda y disfrute, sin perder profundidad.

MOVIMIENTOS MÁS IMPORTANTES entre el primer y el último snapshot:
${deltaTable}

EVOLUCIÓN COMPLETA (${n} simulaciones, ${firstDate} → ${lastDate}):
${data}

Usá tu conocimiento real del Mundial FIFA 2026 —partidos jugados, resultados, goleadores, lesiones, polémicas— para explicar POR QUÉ se mueven las probabilidades, no solo QUÉ se movió. Hablá de los equipos como lo haría un fanático inteligente: con nombres de jugadores clave, estilos de juego, momentos del torneo.

Respondé ÚNICAMENTE con el siguiente formato. Sin etiquetas de roles, sin lenguaje técnico estadístico, con tono futbolero y pasión:

## Así está el mapa del Mundial
El estado actual del torneo según el modelo: quiénes mandan, por cuánto, y si eso tiene sentido con lo que se vio en la cancha. Explicá si hay un claro candidato o si está apretado. 3-4 oraciones con sustancia y color futbolero.

## Los que subieron, los que cayeron
Los movimientos más llamativos entre la primera y la última simulación. Para cada uno: cuánto subió o bajó en probabilidad de ser campeón, y lo más importante —¿POR QUÉ? ¿Qué pasó en la cancha que lo explica? ¿Un resultado clave, una actuación que convenció o decepcionó, un rival que se cruzó en el camino?

## Por qué el modelo los pone arriba
Para los 2-3 equipos más favoritos: explicá con criterio táctico y mundialero qué los hace tan difíciles de derrotar. Hablá del estilo de juego, los jugadores que hacen la diferencia, cómo rinden en partidos de eliminación directa, qué tan complicado es el camino que les toca. Nada de porcentajes solos —explicá la razón futbolística detrás.

## El ojo clínico: lo que sorprende
¿Hay algún equipo que el modelo sobrevalora o subvalora respecto a lo que se ve en la cancha? ¿Algún "dark horse" que está más cerca de explotar de lo que dicen los números? ¿Algo que no cierra entre la simulación y la realidad del torneo?

## Lo que viene: partidos que pueden cambiar todo
Los 2-3 partidos o situaciones concretas de los próximos días que pueden mover el mapa de probabilidades significativamente. Explicá qué resultado cambiaría más las cosas y por qué.

Escribí con pasión mundialera. Usá datos exactos de los snapshots pero explicalos en lenguaje de cancha. Que se lea como una nota de ESPN o una columna de Olé, no como un paper académico.`;
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
