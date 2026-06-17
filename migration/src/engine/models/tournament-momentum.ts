// =============================================================================
// Oloráculo — L6 Tournament Momentum Model ("Momentum del Mundial")
// Uses in-tournament form (WC actual results) to adjust goal expectations.
//
// Goal formula (v3):
//   tournamentBase = base * inflation                (doubles goals when WC is high-scoring)
//   momentumPush   = netDiff * inflation * BOOST     (additive push in actual goal units)
//   homeGoals      = tournamentBase + momentumPush
//   awayGoals      = tournamentBase - momentumPush
//
// The additive push crosses Poisson integer boundaries directly, so the
// displayed "most likely score" changes: 1-1 → 2-2 (inflation) → 3-2 (momentum).
// A multiplicative % adjustment cannot do this reliably (floor(2.53)=floor(2.88)=2).
// =============================================================================

import type { MatchContext, MatchPrediction } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// How many actual goals the momentum difference pushes toward the stronger team.
// With inflation=1.84 and netDiff=0.5: push = 0.5 × 1.84 × 0.70 = 0.644 goals
// → (3-1 instead of 2-2). With netDiff=1.0: push = 1.29 goals → (3-1 or 4-1).
const MOMENTUM_GOAL_BOOST = 0.70;

export function tournamentMomentumPredict(
  ctx: MatchContext,
  goalModel: GoalModel,
): MatchPrediction {
  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);

  const homeTF = ctx.homeTournamentForm;
  const awayTF = ctx.awayTournamentForm;

  const bothNull = homeTF === null && awayTF === null;
  const hasInflation = ctx.tournamentGoalInflation !== null;
  // L6 is usable whenever the goal model is ok and there is any tournament signal
  // (either team form OR a computed inflation factor from WC actual results)
  const degraded = goalDegraded || (bothNull && !hasInflation);

  const homeTMS = homeTF?.momentumScore ?? 0;
  const awayTMS = awayTF?.momentumScore ?? 0;
  const netDiff = clamp(homeTMS - awayTMS, -1, 1);
  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 3.0);

  // Phase 1: apply tournament inflation to the base goal model
  const tournamentHome = baseHome * inflation;
  const tournamentAway = baseAway * inflation;

  // Phase 2: additive momentum push in actual goal units
  // Positive netDiff → home team has more in-tournament momentum → they get extra goals
  const momentumPush = netDiff * inflation * MOMENTUM_GOAL_BOOST;

  let homeGoals = tournamentHome + momentumPush;
  let awayGoals = tournamentAway - momentumPush;

  // Phase 3: player context (unavailability) applied after momentum
  const fc = ctx.fixtureContext;
  let appliedContext = false;
  if (fc) {
    const hasRoleImpact =
      fc.unavailable_home_attack_impact > 0 || fc.unavailable_home_defense_impact > 0 ||
      fc.unavailable_away_attack_impact > 0 || fc.unavailable_away_defense_impact > 0;
    if (hasRoleImpact) {
      homeGoals *= Math.max(0.82, 1 - fc.unavailable_home_attack_impact);
      awayGoals *= Math.max(0.82, 1 - fc.unavailable_away_attack_impact);
      homeGoals *= 1 + fc.unavailable_away_defense_impact;
      awayGoals *= 1 + fc.unavailable_home_defense_impact;
      appliedContext = true;
    } else if (fc.unavailable_home_players > 0 || fc.unavailable_away_players > 0) {
      homeGoals *= Math.max(0.86, 1 - fc.unavailable_home_players * 0.02);
      awayGoals *= Math.max(0.86, 1 - fc.unavailable_away_players * 0.02);
      appliedContext = true;
    }
  }

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  // Use maxGoals=10 to handle high-scoring predictions properly (WC2026 pace)
  const scoreline = poissonScoreline(homeGoals, awayGoals, 10, -0.03);
  const best = mostLikelyScore(scoreline);

  const pushSign = momentumPush >= 0 ? '+' : '';
  const drivers: string[] = [
    `Inflación goleadora: ×${inflation.toFixed(2)} (base: ${baseHome.toFixed(2)}-${baseAway.toFixed(2)} → torneo: ${tournamentHome.toFixed(2)}-${tournamentAway.toFixed(2)})`,
    `Momentum: ${ctx.homeTeam.name} ${homeTMS.toFixed(2)} vs ${ctx.awayTeam.name} ${awayTMS.toFixed(2)} → push ${pushSign}${momentumPush.toFixed(2)} goles → ${homeGoals.toFixed(2)}-${awayGoals.toFixed(2)}`,
  ];

  if (appliedContext && fc) {
    const hasRoleImpact = fc.unavailable_home_attack_impact > 0 || fc.unavailable_away_attack_impact > 0;
    if (hasRoleImpact) {
      drivers.push(`Bajas: ataque ${ctx.homeTeam.name} -${(fc.unavailable_home_attack_impact * 100).toFixed(0)}%, ${ctx.awayTeam.name} -${(fc.unavailable_away_attack_impact * 100).toFixed(0)}%`);
    } else {
      drivers.push(`Bajas: ${ctx.homeTeam.name} ${fc.unavailable_home_players}, ${ctx.awayTeam.name} ${fc.unavailable_away_players}`);
    }
  }

  if (homeTF && homeTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.homeTeam.name}): +${homeTF.upsetBonus.toFixed(3)}`);
  }
  if (awayTF && awayTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.awayTeam.name}): +${awayTF.upsetBonus.toFixed(3)}`);
  }

  const featuresUsed: string[] = ['Modelo de goles', `Inflación goleadora ×${inflation.toFixed(2)}`];
  const featuresMissing: string[] = [];

  if (homeTF !== null) {
    featuresUsed.push(`Forma en torneo (${ctx.homeTeam.name}: ${homeTF.played} partidos)`);
  } else {
    featuresMissing.push(`forma en torneo de ${ctx.homeTeam.name}`);
  }
  if (awayTF !== null) {
    featuresUsed.push(`Forma en torneo (${ctx.awayTeam.name}: ${awayTF.played} partidos)`);
  } else {
    featuresMissing.push(`forma en torneo de ${ctx.awayTeam.name}`);
  }
  if (appliedContext) featuresUsed.push('Disponibilidad de jugadores');
  if (goalDegraded) featuresMissing.push('datos requeridos por el modelo de goles');

  const pushNote = momentumPush !== 0
    ? ` · ${ctx.homeTeam.name} ${pushSign}${momentumPush.toFixed(2)} goles por momentum`
    : '';
  const contextNote = appliedContext ? ' · ajustado por bajas' : '';
  const explanation = bothNull && !hasInflation
    ? `Sin datos de torneo disponibles. Goles base: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`
    : `×${inflation.toFixed(2)} inflación goleadora${pushNote}${contextNote}. Goles finales: ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

  return {
    predictorName: 'Momentum del Mundial',
    predictorPriority: 6,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome: scorelineToOutcome(scoreline),
    expectedHomeGoals: Math.round(homeGoals * 100) / 100,
    expectedAwayGoals: Math.round(awayGoals * 100) / 100,
    scoreline,
    mostLikelyScore: best,
    explanation,
    drivers,
    featuresUsed,
    featuresMissing,
    sources: [
      { name: 'historical_results.csv', kind: 'csv' },
      { name: 'wc_actual_results', kind: 'db' },
    ],
    degraded,
  };
}
