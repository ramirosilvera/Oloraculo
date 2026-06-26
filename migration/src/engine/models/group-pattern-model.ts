// =============================================================================
// Oloráculo — L6.5 Group Pattern Model ("Patrón de Grupo")
// Adjusts goal expectations based on group stage context:
//   - MD3 tactical draw scenario: compresses toward even lambdas
//   - Must-win pressure: boosts attacking team's expected goals
//   - Dead rubber: compresses toward neutral
// Degraded for knockout fixtures (groupContext is null).
// =============================================================================

import type { MatchContext, MatchPrediction } from '../../types/domain';
import { UNIFORM_OUTCOME } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore as getMostLikely,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function groupPatternPredict(ctx: MatchContext, goalModel: GoalModel): MatchPrediction {
  const gc = ctx.groupContext;

  if (!gc) {
    return {
      predictorName: 'Patrón de Grupo',
      predictorPriority: 6.5,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'No es un partido de fase de grupos — sin contexto de grupo disponible.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['fase de grupos'],
      sources: [],
      degraded: true,
    };
  }

  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);
  if (goalDegraded) {
    return {
      predictorName: 'Patrón de Grupo',
      predictorPriority: 6.5,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'Modelo de goles degradado — datos insuficientes.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['datos del modelo de goles'],
      sources: [],
      degraded: true,
    };
  }

  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 2.5);
  let homeGoals = baseHome * inflation;
  let awayGoals = baseAway * inflation;
  const drivers: string[] = [];

  // MD3 tactical draw: both top-2 teams benefit from not losing → compress lambdas
  if (gc.bothAdvanceWithDraw) {
    const avg = (homeGoals + awayGoals) / 2;
    homeGoals = homeGoals * 0.55 + avg * 0.45;
    awayGoals = awayGoals * 0.55 + avg * 0.45;
    homeGoals *= 0.92;
    awayGoals *= 0.92;
    drivers.push(`MD3 empate clasifica a ambos → compresión táctica de lambdas`);
  }

  // Must-win pressure: desperate team attacks more, opponent defends deeper
  if (gc.homeMustWin && !gc.homeIsEliminated) {
    homeGoals *= 1.14;
    awayGoals *= 0.93;
    drivers.push(`${ctx.homeTeam.name} necesita ganar → +14% ataque local`);
  }
  if (gc.awayMustWin && !gc.awayIsEliminated) {
    awayGoals *= 1.14;
    homeGoals *= 0.93;
    drivers.push(`${ctx.awayTeam.name} necesita ganar → +14% ataque visitante`);
  }

  // Dead rubber: reduced intensity, compress toward neutral
  if (gc.isDead) {
    const avg = (homeGoals + awayGoals) / 2;
    homeGoals = homeGoals * 0.65 + avg * 0.35;
    awayGoals = awayGoals * 0.65 + avg * 0.35;
    homeGoals *= 0.88;
    awayGoals *= 0.88;
    drivers.push('Partido sin consecuencias → reducción de intensidad');
  }

  if (drivers.length === 0) {
    drivers.push(`MD${gc.matchDay}: sin modificadores de grupo activos (posiciones ${gc.homePosition}°/${gc.awayPosition}°)`);
  }

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  const scoreline = poissonScoreline(homeGoals, awayGoals, 9, -0.06);
  const best = getMostLikely(scoreline);

  return {
    predictorName: 'Patrón de Grupo',
    predictorPriority: 6.5,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome: scorelineToOutcome(scoreline),
    expectedHomeGoals: Math.round(homeGoals * 100) / 100,
    expectedAwayGoals: Math.round(awayGoals * 100) / 100,
    scoreline,
    mostLikelyScore: best,
    explanation: `MD${gc.matchDay} · pos ${gc.homePosition}°/${gc.awayPosition}° · ×${inflation.toFixed(2)} inflación. ${drivers.join('. ')}. Goles: ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} – ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`,
    drivers,
    featuresUsed: [
      `MD${gc.matchDay}`,
      `Posición ${gc.homePosition}°/${gc.awayPosition}° en el grupo`,
      `Inflación ×${inflation.toFixed(2)}`,
      'Modelo de goles base',
    ],
    featuresMissing: [],
    sources: [
      { name: 'wc_actual_results', kind: 'db' },
      { name: 'historical_results.csv', kind: 'csv' },
    ],
    degraded: false,
  };
}
