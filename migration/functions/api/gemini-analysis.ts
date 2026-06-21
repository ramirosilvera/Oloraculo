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

  return `Sos un panel de tres expertos analizando la evolución de simulaciones Monte Carlo del Mundial FIFA 2026.

El panel está compuesto por:
• Estadístico — analiza patrones cuantitativos, distribución, varianza y confiabilidad del modelo.
• Periodista deportivo — narra el contexto real del torneo, vincula los números con lo que pasa en la cancha.
• Director Técnico — explica los factores tácticos, de plantel y de cuadro que determinan las probabilidades.

VARIACIÓN TOTAL entre el primer y el último snapshot (los movimientos más grandes):
${deltaTable}

EVOLUCIÓN COMPLETA (${n} snapshots, ${firstDate} → ${lastDate}):
${data}

Usá tu conocimiento del Mundial FIFA 2026 —resultados reales, fases jugadas, rendimiento de los equipos— para enriquecer el análisis. No te limites a repetir los números: explicá el PORQUÉ detrás de cada movimiento.

Respondé ÚNICAMENTE con el siguiente formato markdown en español:

## Panorama estadístico
[Estadístico] Describí la distribución y concentración de probabilidades. ¿Hay consenso claro entre snapshots o hay mucha volatilidad? ¿Qué tan determinístico se muestra el modelo? Incluí cifras concretas.

## Lo que cuentan los números
[Periodista] Narrá la evolución como una historia: qué selecciones emergieron y cuáles perdieron terreno, los movimientos más llamativos. Contextualizá con lo que realmente pasó en el torneo: ¿los números reflejan la cancha o hay sorpresas?

## Por qué el modelo favorece a estos equipos
[DT] Explicá los factores que probablemente explican las probabilidades de los equipos top: estilo de juego, profundidad del plantel, fase del torneo en que son más fuertes, ventajas de cuadro, desempeño en eliminación directa. Analizá al menos 3 equipos en detalle.

## Sorpresas y anomalías
¿Hay equipos sobreestimados o subestimados por el modelo? ¿Inconsistencias entre lo estadístico y la realidad? ¿Posibles "dark horses" que el modelo no está captando bien y por qué?

## Claves para la próxima simulación
Los 3 puntos de inflexión más importantes: partidos decisivos pendientes, equipos en zona de cambio brusco, grupos o llaves que pueden redistribuir las probabilidades significativamente.

Sé específico y profundo. Citá cifras exactas de los snapshots. Cada sección debe tener al menos 3-4 oraciones con sustancia real, no generalidades.`;
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
