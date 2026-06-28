// =============================================================================
// Match AI analysis — builds the per-match input_data JSON and calls the
// /api/match-analysis Cloudflare Pages Function (Gemini Flash, structured JSON).
// Pure data-assembly + a thin fetch; the engine already computed the numbers.
// =============================================================================

import type {
  Fixture, MatchPrediction, MatchPredictionResult, FixtureContext,
  Rating, WcActualResult, OutcomeProbabilities,
} from '../types/domain';
import type { PIEResult } from '../types/pie';
import type { MatchGoal } from './supabase-client';
import { topPick } from '../engine/probability-helper';
import { computeGroupStandingsDisplay } from '../utils/standings';

// ── Output (what Gemini returns) ─────────────────────────────────────────────
export interface MatchAnalysis {
  senal_clave: string;          // header chip (≤6 words)
  dato_clave: string;           // the single most decisive concrete fact/number
  insight: string;              // the non-obvious "why"
  pronostico_concreto: string;  // an actionable, specific call (score/goals line/BTTS/margin/value)
  confianza_lectura: 'alta' | 'media' | 'baja';
}

// ── Input (input_data sent to the model) ─────────────────────────────────────
type Pick = 'L' | 'E' | 'V';
interface ModelEntry { peso_historico: number | null; pick: Pick | null; prob: number | null; }
interface TablaEntry { puntos: number; pj: number; dg: number; posicion: number; }

export interface MatchAnalysisInput {
  partido: {
    local: string; visitante: string; grupo: string;
    jornada: number | null; fecha: string; instancia: 'fase_de_grupos' | 'eliminacion';
  };
  tabla_grupo: { local: TablaEntry; visitante: TablaEntry } | null;
  incentivos: { local: string; visitante: string };
  modelos: Record<'plantel'|'forma'|'elo_wc'|'elo'|'poisson'|'contexto'|'grupo'|'momentum', ModelEntry>;
  consenso: { resultado: Pick; prob: number };
  probabilidades_1x2: { local: number; empate: number; visitante: number };
  goles_esperados: { local: number; visitante: number } | null;
  pronostico_campeon: { marcador: string | null; ganador: string | null };
  // Knockout-only signals from the "Fase de Eliminación" model: nerves/inexperience,
  // penalty likelihood, who arrives better to a shootout (GK/takers proxy).
  factores_eliminacion?: string[];
  datos_relevantes: string[];
}

type EvalStats = { winnerAcc: number; n: number };

// predictorName → spec model key
const MODEL_KEY: Record<string, keyof MatchAnalysisInput['modelos']> = {
  'Potencial del plantel':       'plantel',
  'Forma reciente':              'forma',
  'Elo del Torneo':              'elo_wc',
  'Elo':                         'elo',
  'Modelo de goles (Poisson)':   'poisson',
  'Goles + contexto reciente':   'contexto',
  'Patrón de Grupo':             'grupo',
  'Momentum del Mundial':        'momentum',
};

function pickLetter(o: OutcomeProbabilities): Pick {
  const p = topPick(o);
  return p === 'Home' ? 'L' : p === 'Away' ? 'V' : 'E';
}
function pickProbPct(o: OutcomeProbabilities): number {
  const p = topPick(o);
  const v = p === 'Home' ? o.homeWin : p === 'Away' ? o.awayWin : o.draw;
  return Math.round(v * 100);
}

export interface BuildInputArgs {
  fixture: Fixture;
  homeName: string;
  awayName: string;
  pred: MatchPredictionResult;
  pieResult: PIEResult | null;
  context: FixtureContext | null;
  modelWeights?: ReadonlyMap<string, number>;
  modelEvalStats?: ReadonlyMap<string, EvalStats>;
  ratings: Rating[];
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  tournamentGoals: MatchGoal[];
}

export function buildMatchAnalysisInput(a: BuildInputArgs): MatchAnalysisInput {
  const { fixture, homeName, awayName, pred, pieResult, context } = a;
  const isKnockout = fixture.id.startsWith('ko:');

  // ── models ─────────────────────────────────────────────────────────────────
  const modelos = {} as MatchAnalysisInput['modelos'];
  for (const key of ['plantel','forma','elo_wc','elo','poisson','contexto','grupo','momentum'] as const) {
    modelos[key] = { peso_historico: null, pick: null, prob: null };
  }
  for (const p of pred.predictions) {
    const key = MODEL_KEY[p.predictorName];
    if (!key || p.degraded) continue;
    const st = a.modelEvalStats?.get(p.predictorName);
    modelos[key] = {
      peso_historico: st && st.n >= 5 ? Math.round(st.winnerAcc * 100) : null,
      pick: pickLetter(p.outcome),
      prob: pickProbPct(p.outcome),
    };
  }

  // ── consensus + 1x2 (ensemble) ───────────────────────────────────────────────
  const cons = pred.bestPrediction.outcome;
  const consenso = { resultado: pickLetter(cons), prob: pickProbPct(cons) };
  const probabilidades_1x2 = {
    local: +(cons.homeWin * 100).toFixed(1),
    empate: +(cons.draw * 100).toFixed(1),
    visitante: +(cons.awayWin * 100).toFixed(1),
  };

  // ── expected goals (xG) — enables over/under & BTTS calls ────────────────────
  const xgSrc = pred.predictions.find(
    p => p.predictorName === 'Modelo de goles (Poisson)' && p.expectedHomeGoals != null,
  ) ?? pred.bestPrediction;
  const goles_esperados = (xgSrc.expectedHomeGoals != null && xgSrc.expectedAwayGoals != null)
    ? { local: +xgSrc.expectedHomeGoals.toFixed(2), visitante: +xgSrc.expectedAwayGoals.toFixed(2) }
    : null;

  // ── champion / PIE scoreline ─────────────────────────────────────────────────
  const score = (pieResult && !pieResult.degraded ? pieResult.mostLikelyScore : null)
    ?? pred.bestPrediction.mostLikelyScore;
  const champPick = pieResult && !pieResult.degraded ? pieResult.most_probable_pick : topPick(cons);
  const pronostico_campeon = {
    marcador: score ? `${score.home}-${score.away}` : null,
    ganador: champPick === 'Home' ? homeName : champPick === 'Away' ? awayName : 'Empate',
  };

  // ── group standings (tabla + incentives + conceded) ──────────────────────────
  // FIFA 2026: top 2 of each group AND the 8 best third-placed teams advance, so
  // a 3rd can already be through and two qualified teams can be playing for 1st.
  const playedMap = new Map<string, WcActualResult>(a.wcResults.map(r => [r.fixture_id, r]));
  let tabla_grupo: MatchAnalysisInput['tabla_grupo'] = null;
  let jornada: number | null = null;
  const incentivos = { local: 'eliminacion_directa', visitante: 'eliminacion_directa' };
  const concededBits: string[] = [];
  let stakeBullet: string | null = null;

  if (!isKnockout && fixture.group_name) {
    const fifaMap = new Map(a.ratings.filter(r => r.type === 'fifa').map(r => [r.team_id, r.value]));
    const groupFixtures = a.allFixtures.filter(f => f.id.startsWith('grp:') && f.group_name === fixture.group_name);
    const teamIds = [...new Set(groupFixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
    const sorted = computeGroupStandingsDisplay(teamIds, groupFixtures, playedMap, fifaMap);
    const bestThirdIds = computeBestThirdIds(a.allFixtures, playedMap, fifaMap);
    const rowOf = (id: string) => sorted.find(r => r.id === id);
    const posOf = (id: string) => sorted.findIndex(r => r.id === id) + 1;
    const h = rowOf(fixture.home_team_id), v = rowOf(fixture.away_team_id);
    if (h && v) {
      tabla_grupo = {
        local:     { puntos: h.pts, pj: h.pj, dg: h.gd, posicion: posOf(fixture.home_team_id) },
        visitante: { puntos: v.pts, pj: v.pj, dg: v.gd, posicion: posOf(fixture.away_team_id) },
      };
      jornada = fixture.is_played ? Math.max(h.pj, v.pj) : Math.min(3, Math.max(h.pj, v.pj) + 1);
      const sH = teamStatus(fixture.home_team_id, sorted, bestThirdIds);
      const sV = teamStatus(fixture.away_team_id, sorted, bestThirdIds);
      const qH = sH === 'top2' || sH === 'best3';
      const qV = sV === 'top2' || sV === 'best3';
      incentivos.local     = teamIncentive(sH, sorted, fixture.home_team_id, jornada, fixture.is_played, qH && qV);
      incentivos.visitante = teamIncentive(sV, sorted, fixture.away_team_id, jornada, fixture.is_played, qH && qV);
      // What the match actually decides.
      if (!fixture.is_played && qH && qV) {
        stakeBullet = (sH === 'top2' && sV === 'top2')
          ? 'Ambos ya clasificados: el partido define el 1° del grupo (y un mejor cruce en eliminatorias)'
          : 'Ambos con la clasificación encaminada (incluye zona de mejores terceros); se define posición';
      }
      if (h.pj > 0) concededBits.push(`${homeName} recibió ${h.ga} goles en ${h.pj} partido(s) de grupo`);
      if (v.pj > 0) concededBits.push(`${awayName} recibió ${v.ga} goles en ${v.pj} partido(s) de grupo`);
    }
  }

  // ── datos_relevantes ─────────────────────────────────────────────────────────
  const datos: string[] = [];
  // what the match decides (qualification already settled → playing for 1st, etc.)
  if (stakeBullet) datos.push(stakeBullet);
  // what each team needs (group stage)
  if (!isKnockout && tabla_grupo && !stakeBullet) {
    if (incentivos.local !== 'partido_jugado') datos.push(`${homeName}: ${humanIncentive(incentivos.local)}`);
    if (incentivos.visitante !== 'partido_jugado') datos.push(`${awayName}: ${humanIncentive(incentivos.visitante)}`);
  }
  // injuries / availability
  if (context) {
    if (context.notes && context.notes.trim()) datos.push(context.notes.trim().slice(0, 120));
    else {
      if (context.unavailable_home_players > 0) datos.push(`${homeName} con ${context.unavailable_home_players} baja(s)`);
      if (context.unavailable_away_players > 0) datos.push(`${awayName} con ${context.unavailable_away_players} baja(s)`);
    }
  }
  // goals conceded (defensive fragility signal)
  datos.push(...concededBits);
  // top scorer per team across the tournament
  const ts1 = topScorer(a.tournamentGoals, fixture.home_team_id);
  if (ts1) datos.push(`${ts1.name} lleva ${ts1.goals} gol(es) para ${homeName} en el torneo`);
  const ts2 = topScorer(a.tournamentGoals, fixture.away_team_id);
  if (ts2) datos.push(`${ts2.name} lleva ${ts2.goals} gol(es) para ${awayName} en el torneo`);

  // ── knockout factors (nerves / penalties / shootout readiness) from L6.8 ─────
  let factores_eliminacion: string[] | undefined;
  if (isKnockout) {
    const ko = pred.predictions.find(p => p.predictorName === 'Fase de Eliminación' && !p.degraded);
    const picked = ko?.drivers.filter(d => /penal|nervio|experiencia|pedigr|llega mejor/i.test(d)) ?? [];
    if (picked.length) factores_eliminacion = picked;
  }

  return {
    partido: {
      local: homeName, visitante: awayName,
      grupo: fixture.group_name || (fixture.id.match(/^ko:([a-z0-9]+):/)?.[1].toUpperCase() ?? ''),
      jornada, fecha: (fixture.kickoff_utc ?? '').slice(0, 10),
      instancia: isKnockout ? 'eliminacion' : 'fase_de_grupos',
    },
    tabla_grupo,
    incentivos,
    modelos,
    consenso,
    probabilidades_1x2,
    goles_esperados,
    pronostico_campeon,
    factores_eliminacion,
    datos_relevantes: datos.slice(0, 5),
  };
}

type TeamStatus = 'top2' | 'best3' | 'bubble3' | 'out';

// Snapshot qualifying status under the 2026 format (top-2 + 8 best thirds).
function teamStatus(
  id: string,
  sorted: { id: string }[],
  bestThirdIds: Set<string>,
): TeamStatus {
  const pos = sorted.findIndex(r => r.id === id) + 1;
  if (pos <= 2) return 'top2';
  if (pos === 3) return bestThirdIds.has(id) ? 'best3' : 'bubble3';
  return 'out';
}

function teamIncentive(
  status: TeamStatus,
  sorted: { id: string; pts: number }[],
  id: string,
  jornada: number,
  played: boolean,
  bothQualified: boolean,
): string {
  if (played) return 'partido_jugado';
  if (status === 'top2') return bothQualified ? 'clasificado_define_primer_puesto' : 'clasificado_top2';
  if (status === 'best3') return 'clasifica_como_mejor_tercero';
  if (status === 'bubble3') return jornada >= 3 ? 'pelea_por_mejor_tercero' : 'en_pelea_por_clasificar';
  // 'out'
  const second = sorted[1]?.pts ?? 0;
  const row = sorted.find(r => r.id === id);
  if (jornada >= 3 && row && row.pts + 3 < second) return 'eliminado_matematicamente_juega_por_orgullo';
  return 'necesita_ganar_para_clasificar';
}

// 8 best third-placed teams across all 12 groups (current standings snapshot).
function computeBestThirdIds(
  allFixtures: Fixture[],
  playedMap: Map<string, WcActualResult>,
  fifaMap: Map<string, number>,
): Set<string> {
  const byGroup = new Map<string, Fixture[]>();
  for (const f of allFixtures) {
    if (!f.id.startsWith('grp:') || !f.group_name) continue;
    (byGroup.get(f.group_name) ?? byGroup.set(f.group_name, []).get(f.group_name)!).push(f);
  }
  const thirds: { id: string; pts: number; gd: number; gf: number }[] = [];
  for (const [, fix] of byGroup) {
    const teamIds = [...new Set(fix.flatMap(f => [f.home_team_id, f.away_team_id]))];
    const s = computeGroupStandingsDisplay(teamIds, fix, playedMap, fifaMap);
    if (s[2] && s[2].pj > 0) thirds.push({ id: s[2].id, pts: s[2].pts, gd: s[2].gd, gf: s[2].gf });
  }
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return new Set(thirds.slice(0, 8).map(t => t.id));
}

function humanIncentive(code: string): string {
  switch (code) {
    case 'clasificado_define_primer_puesto':            return 'ya clasificado, define el 1° del grupo';
    case 'clasificado_top2':                            return 'ya clasificado (top 2)';
    case 'clasifica_como_mejor_tercero':                return 'clasifica como mejor tercero';
    case 'pelea_por_mejor_tercero':                     return 'pelea un lugar de mejor tercero';
    case 'en_pelea_por_clasificar':                     return 'en pelea por clasificar';
    case 'necesita_ganar_para_clasificar':              return 'necesita ganar para clasificar';
    case 'eliminado_matematicamente_juega_por_orgullo': return 'eliminado, juega por orgullo';
    case 'eliminacion_directa':                         return 'partido de eliminación directa';
    default:                                            return code.replace(/_/g, ' ');
  }
}

function topScorer(goals: MatchGoal[], teamId: string): { name: string; goals: number } | null {
  const counts = new Map<string, number>();
  for (const g of goals) {
    if (g.team_id !== teamId || g.goal_type === 'own_goal') continue;
    counts.set(g.player_name, (counts.get(g.player_name) ?? 0) + 1);
  }
  let best: { name: string; goals: number } | null = null;
  for (const [name, n] of counts) if (!best || n > best.goals) best = { name, goals: n };
  return best;
}

// Stable cache key — changes only when an input that affects the analysis changes.
export function matchAnalysisCacheKey(input: MatchAnalysisInput): string {
  return JSON.stringify([
    'v3', // bump when the prompt/output shape changes
    input.partido.local, input.partido.visitante, input.partido.jornada,
    input.consenso, input.pronostico_campeon, input.goles_esperados, input.tabla_grupo,
    Object.values(input.modelos).map(m => [m.pick, m.prob]),
    input.factores_eliminacion, input.datos_relevantes,
  ]);
}

export type MatchAnalysisResult = MatchAnalysis | { error: string };

export function isAnalysisError(r: MatchAnalysisResult | null | undefined): r is { error: string } {
  return !!r && 'error' in r;
}

export async function callMatchAnalysis(input: MatchAnalysisInput): Promise<MatchAnalysisResult> {
  try {
    const res = await fetch('/api/match-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_data: input }),
    });
    const body = await res.json().catch(() => ({})) as Partial<MatchAnalysis> & { error?: string; detail?: unknown };
    if (!res.ok) {
      const reason = [`HTTP ${res.status}`, body.error, body.detail && JSON.stringify(body.detail)].filter(Boolean).join(' · ');
      console.warn('[match-analysis] failed:', reason);
      return { error: reason };
    }
    if (!body.senal_clave || !body.dato_clave || !body.insight || !body.pronostico_concreto || !body.confianza_lectura) {
      console.warn('[match-analysis] incomplete payload:', body);
      return { error: 'respuesta incompleta' };
    }
    return body as MatchAnalysis;
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'network';
    console.warn('[match-analysis] error:', reason);
    return { error: reason }; // UI still degrades silently unless ai-debug is on
  }
}
