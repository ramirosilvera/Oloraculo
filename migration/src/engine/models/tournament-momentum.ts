// =============================================================================
// Oloráculo — L6 Tournament Momentum Model ("Momentum del Mundial")
// Uses in-tournament form (WC actual results) to adjust goal expectations.
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

export function tournamentMomentumPredict(
  ctx: MatchContext,
  goalModel: GoalModel,
): MatchPrediction {
  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);

  const homeTF = ctx.homeTournamentForm;
  const awayTF = ctx.awayTournamentForm;

  // Degraded only if BOTH forms are null (no tournament data at all)
  const bothNull = homeTF === null && awayTF === null;
  const degraded = goalDegraded || bothNull;

  const homeTMS = homeTF?.momentumScore ?? 0;
  const awayTMS = awayTF?.momentumScore ?? 0;

  const netDiff = clamp(homeTMS - awayTMS, -1, 1);
  const adjustment = netDiff * 0.12;

  let homeGoals = baseHome * (1 + adjustment);
  let awayGoals = baseAway * (1 - adjustment);

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  const scoreline = poissonScoreline(homeGoals, awayGoals, 8, -0.03);
  const best = mostLikelyScore(scoreline);

  const drivers: string[] = [
    `Momentum: ${ctx.homeTeam.name} ${homeTMS.toFixed(3)} vs ${ctx.awayTeam.name} ${awayTMS.toFixed(3)} (diff ${netDiff.toFixed(3)}, ajuste ${(adjustment * 100).toFixed(1)}%)`,
  ];

  if (homeTF && homeTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.homeTeam.name}): +${homeTF.upsetBonus.toFixed(3)}`);
  }
  if (awayTF && awayTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.awayTeam.name}): +${awayTF.upsetBonus.toFixed(3)}`);
  }

  const featuresUsed: string[] = ['Modelo de goles'];
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
  if (goalDegraded) featuresMissing.push('datos requeridos por el modelo de goles');

  const explanation = bothNull
    ? `Sin datos de torneo disponibles. Goles base: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`
    : `Modelo de goles ajustado por momentum en torneo (${(adjustment * 100).toFixed(1)}%). ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

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
