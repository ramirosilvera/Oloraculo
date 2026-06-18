// =============================================================================
// Oloráculo — Squad Strength Model (L4.5 "Potencial del plantel")
// Adjusts Goal Model expected goals using squad market value, top-5 league
// presence and Champions League experience.
//
// Score formula (UCL raised to 25% — more predictive in WC knockout context):
//   valuePct    = market_value_m / maxValueInTournament
//   top5Pct     = top5_league_count / squad_size
//   uclPct      = ucl_players / squad_size
//   strength    = 0.40 * valuePct + 0.35 * top5Pct + 0.25 * uclPct
//
// Adjustment (higher SQUAD_BOOST = 0.25 → ±25% max impact on Poisson goals):
//   avgStrength = mean(all strengths)
//   homeAdj     = (homeStrength - avg) / avg   → saturates near ±1 for extremes
//   awayAdj     = (awayStrength - avg) / avg
//   netDiff     = clamp(homeAdj - awayAdj, -1, 1)
//   homeGoals   = baseHome * (1 + netDiff * SQUAD_BOOST)
//   awayGoals   = baseAway * (1 - netDiff * SQUAD_BOOST)
//
// Design intent: clear mismatches (e.g. England €1380M vs Haiti €12M) saturate
// netDiff → 1.0 and receive the full 25% boost, while near-equal squads get
// close to zero adjustment.
// =============================================================================

import type { MatchContext, MatchPrediction, SquadStrengthEntry } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore as getMostLikely,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

const SQUAD_BOOST = 0.25;
const LOW_SCORE_RHO = -0.03;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the squad strength map from the raw JSON object.
 * Keys are team IDs (lower-case, matching team data).
 */
export function buildSquadStrengthMap(
  raw: Record<string, SquadStrengthEntry>,
): Map<string, SquadStrengthEntry> {
  const map = new Map<string, SquadStrengthEntry>();
  for (const [key, entry] of Object.entries(raw)) {
    // Skip meta-keys like "_placeholder"
    if (key.startsWith('_')) continue;
    map.set(key, entry);
  }
  return map;
}

interface StrengthScore {
  teamId: string;
  score: number;
}

function computeAllScores(
  squadData: Map<string, SquadStrengthEntry>,
): Map<string, number> {
  if (squadData.size === 0) return new Map();

  // Find max market value across all entries for normalization
  let maxValue = 0;
  for (const entry of squadData.values()) {
    if (entry.market_value_m > maxValue) maxValue = entry.market_value_m;
  }
  if (maxValue <= 0) maxValue = 1;

  const scores = new Map<string, number>();
  for (const [teamId, entry] of squadData) {
    const size = entry.squad_size > 0 ? entry.squad_size : 26;
    const valuePct = entry.market_value_m / maxValue;
    const top5Pct  = entry.top5_league_count / size;
    const uclPct   = entry.ucl_players / size;
    const score    = 0.40 * valuePct + 0.35 * top5Pct + 0.25 * uclPct;
    scores.set(teamId, score);
  }
  return scores;
}

function meanOfMap(scores: Map<string, number>): number {
  if (scores.size === 0) return 0;
  let sum = 0;
  for (const v of scores.values()) sum += v;
  return sum / scores.size;
}

export function squadStrengthModelPredict(
  ctx: MatchContext,
  goalModel: GoalModel,
  squadData: Map<string, SquadStrengthEntry>,
): MatchPrediction {
  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);

  const homeId = ctx.homeTeam.id;
  const awayId = ctx.awayTeam.id;

  const noSquadData = squadData.size === 0;
  const hasHome = squadData.has(homeId);
  const hasAway = squadData.has(awayId);
  const bothMissing = !hasHome && !hasAway;

  // Degraded when goal model is degraded OR we have no squad data for either team
  const degraded = goalDegraded || bothMissing || noSquadData;

  const allScores = computeAllScores(squadData);
  const avg = meanOfMap(allScores);

  let homeGoals = baseHome;
  let awayGoals = baseAway;

  const missingFeatures: string[] = [];
  const featuresUsed: string[] = ['Modelo de goles'];
  let appliedSquad = false;

  if (goalDegraded) {
    missingFeatures.push('datos requeridos por el modelo de goles');
  }

  if (!noSquadData && !bothMissing && avg > 0) {
    // Get home strength — fall back to tournament average when data is missing for one team
    const homeScore = hasHome ? (allScores.get(homeId) ?? avg) : avg;
    const awayScore = hasAway ? (allScores.get(awayId) ?? avg) : avg;

    const homeAdj = (homeScore - avg) / avg;
    const awayAdj = (awayScore - avg) / avg;
    const netDiff = clamp(homeAdj - awayAdj, -1, 1);

    homeGoals = baseHome * (1 + netDiff * SQUAD_BOOST);
    awayGoals = baseAway * (1 - netDiff * SQUAD_BOOST);
    homeGoals = Math.max(0.3, homeGoals);
    awayGoals = Math.max(0.3, awayGoals);

    featuresUsed.push('Valor de mercado del plantel', 'Jugadores en ligas top-5', 'Experiencia en UCL');
    appliedSquad = true;

    if (!hasHome) missingFeatures.push(`datos de plantel de ${ctx.homeTeam.name}`);
    if (!hasAway) missingFeatures.push(`datos de plantel de ${ctx.awayTeam.name}`);
  } else {
    if (noSquadData) {
      missingFeatures.push('archivo squad-strength.json');
    } else {
      missingFeatures.push(`datos de plantel de ${ctx.homeTeam.name}`, `datos de plantel de ${ctx.awayTeam.name}`);
    }
  }

  const scoreline = poissonScoreline(homeGoals, awayGoals, 8, LOW_SCORE_RHO);
  const best = getMostLikely(scoreline);

  // Build explanation
  let explanation: string;
  if (appliedSquad) {
    const homeEntry = squadData.get(homeId);
    const awayEntry = squadData.get(awayId);
    const homeMv   = homeEntry ? `€${homeEntry.market_value_m.toFixed(0)}M` : 'promedio';
    const awayMv   = awayEntry ? `€${awayEntry.market_value_m.toFixed(0)}M` : 'promedio';
    const homeTop5 = homeEntry
      ? `${homeEntry.top5_league_count}/${homeEntry.squad_size} top-5`
      : 'promedio';
    const awayTop5 = awayEntry
      ? `${awayEntry.top5_league_count}/${awayEntry.squad_size} top-5`
      : 'promedio';
    explanation = `Potencial del plantel: ${ctx.homeTeam.name} ${homeMv}, ${homeTop5}; ${ctx.awayTeam.name} ${awayMv}, ${awayTop5}. Goles ajustados: ${homeGoals.toFixed(2)}-${awayGoals.toFixed(2)}.`;
  } else {
    explanation = `Sin datos de plantel disponibles. Goles base del modelo Poisson: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`;
  }

  const homeEntry = squadData.get(homeId);
  const awayEntry = squadData.get(awayId);
  const drivers: string[] = appliedSquad
    ? [
        `Valor de mercado: ${ctx.homeTeam.name} ${homeEntry ? `€${homeEntry.market_value_m.toFixed(0)}M` : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? `€${awayEntry.market_value_m.toFixed(0)}M` : 'n/d'}`,
        `Jugadores top-5 ligas: ${ctx.homeTeam.name} ${homeEntry ? `${homeEntry.top5_league_count}/${homeEntry.squad_size}` : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? `${awayEntry.top5_league_count}/${awayEntry.squad_size}` : 'n/d'}`,
        `Jugadores UCL: ${ctx.homeTeam.name} ${homeEntry ? homeEntry.ucl_players : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? awayEntry.ucl_players : 'n/d'}`,
        `Marcador más probable: ${best.home}-${best.away}`,
      ]
    : ['Sin datos de plantel — usando modelo de goles sin ajuste'];

  return {
    predictorName: 'Potencial del plantel',
    predictorPriority: 4.5,
    fixtureId: ctx.fixture.id,
    homeTeamId: homeId,
    awayTeamId: awayId,
    outcome: scorelineToOutcome(scoreline),
    expectedHomeGoals: Math.round(homeGoals * 100) / 100,
    expectedAwayGoals: Math.round(awayGoals * 100) / 100,
    scoreline,
    mostLikelyScore: best,
    explanation,
    drivers,
    featuresUsed,
    featuresMissing: missingFeatures,
    sources: [
      { name: 'historical_results.csv', kind: 'csv' },
      { name: 'squad-strength.json', kind: 'json' },
    ],
    degraded,
  };
}
