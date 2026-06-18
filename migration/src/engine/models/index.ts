// =============================================================================
// Oloráculo — Prediction model suite
// Migrated from: Oloraculo.Web/Predictors/
// All models are pure functions — no server required
// =============================================================================

import type { MatchContext, MatchPrediction, OutcomeProbabilities } from '../../types/domain';
import { UNIFORM_OUTCOME } from '../../types/domain';
import {
  eloExpectation,
  outcomeFromExpectation,
  normalizeOutcome,
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore,
} from '../probability-helper';
import { GoalModel, matchTournamentWeight } from './goal-model';
import type { MatchResult } from '../../types/domain';

// ---------------------------------------------------------------------------
// L0 — NullModel: uniform probability (baseline)
// Migrated from: NullModel.cs
// ---------------------------------------------------------------------------
export function nullModelPredict(ctx: MatchContext): MatchPrediction {
  return {
    predictorName: 'Base',
    predictorPriority: 0,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome: { ...UNIFORM_OUTCOME },
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    scoreline: null,
    mostLikelyScore: null,
    explanation: 'Probabilidad uniforme: no hay datos disponibles para distinguir entre los equipos.',
    drivers: [],
    featuresUsed: [],
    featuresMissing: ['rankings', 'forma reciente', 'historial de goles'],
    sources: [],
    degraded: true,
  };
}

// ---------------------------------------------------------------------------
// L1 — FifaRankingModel: FIFA points-based prediction
// Migrated from: FifaRankingModel.cs
// ---------------------------------------------------------------------------
export function fifaModelPredict(ctx: MatchContext): MatchPrediction {
  if (!ctx.homeFifaRating || !ctx.awayFifaRating) {
    return {
      predictorName: 'Ranking FIFA',
      predictorPriority: 1,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'Faltan puntos FIFA para uno o ambos equipos.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['ranking FIFA'],
      sources: [],
      degraded: true,
    };
  }

  const expected = eloExpectation(ctx.homeFifaRating.value, ctx.awayFifaRating.value);
  const diff = ctx.homeFifaRating.value - ctx.awayFifaRating.value;
  const outcome = outcomeFromExpectation(expected, diff);

  return {
    predictorName: 'Ranking FIFA',
    predictorPriority: 1,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome,
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    scoreline: null,
    mostLikelyScore: null,
    explanation: `Basado en puntos FIFA ${ctx.homeFifaRating.value.toFixed(0)} para ${ctx.homeTeam.name} y ${ctx.awayFifaRating.value.toFixed(0)} para ${ctx.awayTeam.name}.`,
    drivers: [`Diferencia FIFA: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}`],
    featuresUsed: ['Puntos FIFA equipo A', 'Puntos FIFA equipo B'],
    featuresMissing: [],
    sources: [{ name: 'fifa_rankings.csv', kind: 'csv' }],
    degraded: false,
  };
}

// ---------------------------------------------------------------------------
// L2 — EloModel: Elo rating-based prediction
// Migrated from: EloModel.cs
// ---------------------------------------------------------------------------
export function eloModelPredict(ctx: MatchContext): MatchPrediction {
  if (!ctx.homeElo || !ctx.awayElo) {
    return {
      predictorName: 'Elo',
      predictorPriority: 2,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'Faltan ratings Elo para uno o ambos equipos.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['Elo'],
      sources: [],
      degraded: true,
    };
  }

  const expected = eloExpectation(ctx.homeElo.value, ctx.awayElo.value);
  const diff = ctx.homeElo.value - ctx.awayElo.value;
  const outcome = outcomeFromExpectation(expected, diff);

  return {
    predictorName: 'Elo',
    predictorPriority: 2,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome,
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    scoreline: null,
    mostLikelyScore: null,
    explanation: `Basado en Elo ${ctx.homeElo.value} para ${ctx.homeTeam.name} y ${ctx.awayElo.value} para ${ctx.awayTeam.name}.`,
    drivers: [`Diferencia Elo: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}`],
    featuresUsed: ['Elo equipo A', 'Elo equipo B'],
    featuresMissing: [],
    sources: [{ name: 'elo_snapshot.csv', kind: 'csv' }],
    degraded: false,
  };
}

// ---------------------------------------------------------------------------
// L3 — RecentFormModel: Elo + recent match history
// Migrated from: RecentFormModel.cs
// ---------------------------------------------------------------------------
export function formDelta(recentMatches: MatchResult[], teamId: string): number {
  let delta = 0;
  let weight = 1.0;
  const sorted = [...recentMatches].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  for (const match of sorted) {
    const goalsFor = match.home_team_id === teamId ? match.home_goals : match.away_goals;
    const goalsAgainst = match.home_team_id === teamId ? match.away_goals : match.home_goals;
    const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
    // Center at 1.0 so draws are neutral (0), wins positive (+36 base), losses negative (-18 base).
    // Scale by competition type: WC/qualifier results carry more signal than friendlies.
    const tWeight = matchTournamentWeight(match.tournament);
    delta += weight * tWeight * ((points - 1.0) * 18 + Math.max(-3, Math.min(3, goalsFor - goalsAgainst)) * 8);
    weight *= 0.8;
  }
  return Math.max(-100, Math.min(100, delta));
}

export function recentFormModelPredict(ctx: MatchContext): MatchPrediction {
  if (!ctx.homeElo || !ctx.awayElo) {
    return {
      predictorName: 'Forma reciente',
      predictorPriority: 3,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'Se necesitan ratings Elo para ambos equipos.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['Elo'],
      sources: [],
      degraded: true,
    };
  }

  const homeDelta = formDelta(ctx.homeRecentResults, ctx.homeTeam.id);
  const awayDelta = formDelta(ctx.awayRecentResults, ctx.awayTeam.id);
  const home = ctx.homeElo.value + homeDelta;
  const away = ctx.awayElo.value + awayDelta;
  const expected = eloExpectation(home, away);
  const outcome = outcomeFromExpectation(expected, home - away);
  const missingHistory = ctx.homeRecentResults.length === 0 || ctx.awayRecentResults.length === 0;

  return {
    predictorName: 'Forma reciente',
    predictorPriority: 3,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome,
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    scoreline: null,
    mostLikelyScore: null,
    explanation: `Elo más forma reciente: ${ctx.homeTeam.name} delta ${homeDelta.toFixed(1)}, ${ctx.awayTeam.name} delta ${awayDelta.toFixed(1)}.`,
    drivers: ['Resultados recientes'],
    featuresUsed: ['Resultados recientes', 'Ratings Elo'],
    featuresMissing: missingHistory ? ['historial reciente para uno o ambos equipos'] : [],
    sources: [
      { name: 'elo_snapshot.csv', kind: 'csv' },
      { name: 'historical_results.csv', kind: 'csv' },
    ],
    degraded: missingHistory,
  };
}

// ---------------------------------------------------------------------------
// L5 — GoalPlusRecentContextModel: Goal model adjusted by player availability
// Migrated from: GoalPlusRecentContextModel.cs
// ---------------------------------------------------------------------------
export function goalContextModelPredict(ctx: MatchContext, goalModel: GoalModel): MatchPrediction {
  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);
  let homeGoals = baseHome;
  let awayGoals = baseAway;
  const usedFeatures = ['Modelo de goles'];
  const missingFeatures: string[] = [];
  const drivers: string[] = [];
  let appliedContext = false;

  if (goalDegraded) missingFeatures.push('datos requeridos por el modelo de goles');

  const fc = ctx.fixtureContext;
  if (fc) {
    const hasRoleImpact =
      fc.unavailable_home_attack_impact > 0 ||
      fc.unavailable_home_defense_impact > 0 ||
      fc.unavailable_away_attack_impact > 0 ||
      fc.unavailable_away_defense_impact > 0;

    if (hasRoleImpact) {
      homeGoals *= Math.max(0.82, 1 - fc.unavailable_home_attack_impact);
      awayGoals *= Math.max(0.82, 1 - fc.unavailable_away_attack_impact);
      homeGoals *= 1 + fc.unavailable_away_defense_impact;
      awayGoals *= 1 + fc.unavailable_home_defense_impact;
      usedFeatures.push('Disponibilidad de jugadores');
      drivers.push(
        `Impacto por rol. A: ataque -${(fc.unavailable_home_attack_impact * 100).toFixed(1)}%, defensa -${(fc.unavailable_home_defense_impact * 100).toFixed(1)}%; B: ataque -${(fc.unavailable_away_attack_impact * 100).toFixed(1)}%, defensa -${(fc.unavailable_away_defense_impact * 100).toFixed(1)}%.`,
      );
      appliedContext = true;
    } else if (fc.unavailable_home_players > 0 || fc.unavailable_away_players > 0) {
      homeGoals *= Math.max(0.86, 1 - fc.unavailable_home_players * 0.02);
      awayGoals *= Math.max(0.86, 1 - fc.unavailable_away_players * 0.02);
      usedFeatures.push('Disponibilidad de jugadores');
      drivers.push(`Bajas: equipo A ${fc.unavailable_home_players}, equipo B ${fc.unavailable_away_players}.`);
      appliedContext = true;
    } else {
      missingFeatures.push('disponibilidad de jugadores con impacto');
    }

    if (!fc.has_lineups) missingFeatures.push('alineaciones');
    if (!fc.has_odds) missingFeatures.push('cuotas');
  } else {
    missingFeatures.push('disponibilidad de jugadores', 'alineaciones', 'cuotas');
  }

  const scoreline = poissonScoreline(homeGoals, awayGoals, 8, -0.03);
  const best = mostLikelyScore(scoreline);

  return {
    predictorName: 'Goles + contexto reciente',
    predictorPriority: 5,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome: scorelineToOutcome(scoreline),
    expectedHomeGoals: Math.round(homeGoals * 100) / 100,
    expectedAwayGoals: Math.round(awayGoals * 100) / 100,
    scoreline,
    mostLikelyScore: best,
    explanation: appliedContext
      ? `Modelo de goles ajustado con contexto. ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`
      : `Ningún contexto modificó el modelo de goles. ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`,
    drivers: drivers.length === 0 ? ['No se aplicó ajuste de contexto'] : drivers,
    featuresUsed: usedFeatures,
    featuresMissing: missingFeatures,
    sources: [
      { name: 'historical_results.csv', kind: 'csv' },
      { name: 'api-football', kind: 'api' },
      ...(fc?.has_availability_news ? [{ name: 'availability-news', kind: 'llm' }] : []),
    ],
    degraded: goalDegraded || !appliedContext,
  };
}

// Re-export GoalModel for convenience
export { GoalModel } from './goal-model';
export type { GoalStrength } from './goal-model';
export { tournamentMomentumPredict } from './tournament-momentum';
export { detectDailyPattern, PATTERN_MODIFIERS } from './daily-pattern';
export { squadStrengthModelPredict, buildSquadStrengthMap } from './squad-strength-model';
