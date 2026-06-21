// =============================================================================
// Oloráculo — Squad Strength Model (L4.5 "Potencial del plantel")
// Adjusts Goal Model expected goals using squad market value, top-5 league
// presence and Champions League experience.
//
// Score formula:
//   valuePct    = market_value_m / maxValueInTournament
//   top5Pct     = top5_league_count / squad_size
//   strength    = 0.60 * valuePct + 0.40 * top5Pct
// (UCL players removed — they correlate too strongly with top5 and market value)
//
// Adjustment — INDEPENDENT log-ratio per team (avoids the saturation bug where
// France-USA received the same max adjustment as England-Haiti under netDiff):
//   homeFactor = log(homeStrength / avgStrength)   symmetric on log scale
//   awayFactor = log(awayStrength / avgStrength)
//   homeBoost  = clamp(homeFactor * SQUAD_BOOST, -0.55, +0.80)
//   awayBoost  = clamp(awayFactor * SQUAD_BOOST, -0.55, +0.80)
//   homeGoals  = baseHome * (1 + homeBoost)
//   awayGoals  = baseAway * (1 + awayBoost)
//
// SQUAD_BOOST = 0.50: England (log-ratio ≈ 1.35) → +67% on home goals;
//               France → +61%; Germany → +52%; USA → +18%; Japan → ~0%;
//               Haiti/Qatar → clamped at −55%.
// LOW_SCORE_RHO = −0.08: more aggressive than L4's −0.03, reducing the
//               over-weight on 0-0 and 1-1 draws to improve exact score accuracy.
// =============================================================================

import type { MatchContext, MatchPrediction, SquadStrengthEntry } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore as getMostLikely,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

const SQUAD_BOOST = 0.50;   // log-ratio scaling — England gets ~67% boost over base
const LOW_SCORE_RHO = -0.08; // stronger than L4's -0.03 → less over-weight on 0-0/1-1

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
    const score    = 0.60 * valuePct + 0.40 * top5Pct;
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

    // Independent log-ratio adjustments: each team's goals scaled by their
    // strength relative to the tournament average on a log scale.
    // log(score/avg) is symmetric: a team 3× above avg gets +log(3)≈+1.10,
    // a team 3× below avg gets −log(3)≈−1.10 — unlike the old (score−avg)/avg
    // which gave +2.0 above but only −0.67 below, causing asymmetric saturation.
    const homeFactor = homeScore > 0 ? Math.log(homeScore / avg) : 0;
    const awayFactor = awayScore > 0 ? Math.log(awayScore / avg) : 0;
    // Clamp per-team: max +80% boost for elites, max −55% for weakest teams
    const homeBoost = clamp(homeFactor * SQUAD_BOOST, -0.55, 0.80);
    const awayBoost = clamp(awayFactor * SQUAD_BOOST, -0.55, 0.80);

    homeGoals = Math.max(0.3, baseHome * (1 + homeBoost));
    awayGoals = Math.max(0.3, baseAway * (1 + awayBoost));

    featuresUsed.push('Valor de mercado del plantel', 'Jugadores en ligas top-5');
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
  const homeEntry = squadData.get(homeId);
  const awayEntry = squadData.get(awayId);
  const homeKP = homeEntry?.key_player ?? null;
  const awayKP = awayEntry?.key_player ?? null;
  const homeAge = homeEntry?.avg_age ?? null;
  const awayAge = awayEntry?.avg_age ?? null;
  if (appliedSquad) {
    const homeMv   = homeEntry ? `€${homeEntry.market_value_m.toFixed(0)}M` : 'promedio';
    const awayMv   = awayEntry ? `€${awayEntry.market_value_m.toFixed(0)}M` : 'promedio';
    explanation = `Potencial del plantel: ${ctx.homeTeam.name} ${homeMv}${homeKP ? `, referente ${homeKP}` : ''}; ${ctx.awayTeam.name} ${awayMv}${awayKP ? `, referente ${awayKP}` : ''}. Goles ajustados: ${homeGoals.toFixed(2)}-${awayGoals.toFixed(2)}.`;
  } else {
    explanation = `Sin datos de plantel disponibles. Goles base del modelo Poisson: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`;
  }

  const drivers: string[] = appliedSquad
    ? [
        `Valor de mercado: ${ctx.homeTeam.name} ${homeEntry ? `€${homeEntry.market_value_m.toFixed(0)}M` : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? `€${awayEntry.market_value_m.toFixed(0)}M` : 'n/d'}`,
        `Jugadores top-5 ligas: ${ctx.homeTeam.name} ${homeEntry ? `${homeEntry.top5_league_count}/${homeEntry.squad_size}` : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? `${awayEntry.top5_league_count}/${awayEntry.squad_size}` : 'n/d'}`,
        `Jugadores UCL: ${ctx.homeTeam.name} ${homeEntry ? homeEntry.ucl_players : 'n/d'} · ${ctx.awayTeam.name} ${awayEntry ? awayEntry.ucl_players : 'n/d'}`,
        `Marcador más probable: ${best.home}-${best.away}`,
        ...(homeKP || awayKP ? [`Jugador referente: ${ctx.homeTeam.name} ${homeKP ?? 'n/d'} · ${ctx.awayTeam.name} ${awayKP ?? 'n/d'}`] : []),
        ...(homeAge || awayAge ? [`Edad media del plantel: ${ctx.homeTeam.name} ${homeAge ? `${homeAge} años` : 'n/d'} · ${ctx.awayTeam.name} ${awayAge ? `${awayAge} años` : 'n/d'}`] : []),
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
