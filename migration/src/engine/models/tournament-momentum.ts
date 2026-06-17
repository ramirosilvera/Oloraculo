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

  const bothNull = homeTF === null && awayTF === null;
  const hasInflation = ctx.tournamentGoalInflation !== null;
  // L6 is usable whenever the goal model is ok and there is any tournament signal
  // (either team form OR a computed inflation factor from WC actual results)
  const degraded = goalDegraded || (bothNull && !hasInflation);

  const homeTMS = homeTF?.momentumScore ?? 0;
  const awayTMS = awayTF?.momentumScore ?? 0;

  const netDiff = clamp(homeTMS - awayTMS, -1, 1);
  // Increased cap from ±12% to ±20% to give in-tournament form more weight
  const adjustment = netDiff * 0.20;
  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 3.0);

  let homeGoals = baseHome * inflation * (1 + adjustment);
  let awayGoals = baseAway * inflation * (1 - adjustment);

  // Incorporate player context so "Buscar bajas" still feeds the top model
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

  const scoreline = poissonScoreline(homeGoals, awayGoals, 8, -0.03);
  const best = mostLikelyScore(scoreline);

  const drivers: string[] = [
    `Inflación goleadora del torneo: ×${inflation.toFixed(3)}`,
    `Momentum: ${ctx.homeTeam.name} ${homeTMS.toFixed(3)} vs ${ctx.awayTeam.name} ${awayTMS.toFixed(3)} (diff ${netDiff.toFixed(3)}, ajuste ${(adjustment * 100).toFixed(1)}%)`,
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

  const inflationNote = inflation !== 1.0 ? ` · ×${inflation.toFixed(2)} inflación goleadora` : '';
  const contextNote = appliedContext ? ' · ajustado por bajas' : '';
  const explanation = bothNull && !hasInflation
    ? `Sin datos de torneo disponibles. Goles base: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`
    : `Goles base ajustados por momentum (${(adjustment * 100).toFixed(1)}%)${inflationNote}${contextNote}. ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

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
