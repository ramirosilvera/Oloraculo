// =============================================================================
// Oloráculo — L6.8 Knockout Pattern Model ("Fase de Eliminación")
// Adjusts goal expectations for knockout rounds:
//   - Base KO compression: historically ~15% fewer goals than group stage
//   - Round depth factor: QF/SF/Final = more elite teams = more tactical caution
//   - Tournament form asymmetry: better-form team gets edge (no second chances)
//   - Tactical draw compression: higher draw probability at 90 min in KO
//   - More negative rho: increases 0-0 / 1-1 probability (KO teams play to not lose)
// Degraded for group stage fixtures (groupContext is not null → it's a group match).
// Symmetric with Patrón de Grupo: exactly one of the two is active per match type.
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

const ROUND_DATA: Record<string, { scale: number; neutralize: number; label: string }> = {
  r32:   { scale: 0.97, neutralize: 0.07,  label: 'R32 (Dieciséisavos)' },
  r16:   { scale: 0.94, neutralize: 0.11,  label: 'R16 (Octavos)'       },
  qf:    { scale: 0.91, neutralize: 0.15,  label: 'QF (Cuartos)'        },
  sf:    { scale: 0.89, neutralize: 0.18,  label: 'SF (Semifinal)'      },
  final: { scale: 0.88, neutralize: 0.20,  label: 'Final'               },
  '3rd': { scale: 0.92, neutralize: 0.09,  label: '3er puesto'          },
};

function detectRound(fixtureId: string): string {
  if (fixtureId.includes(':r32:'))   return 'r32';
  if (fixtureId.includes(':r16:'))   return 'r16';
  if (fixtureId.includes(':qf:'))    return 'qf';
  if (fixtureId.includes(':sf:'))    return 'sf';
  if (fixtureId.includes(':final:')) return 'final';
  if (fixtureId.includes(':3rd:'))   return '3rd';
  return 'r32'; // safe fallback
}

export function knockoutPatternPredict(ctx: MatchContext, goalModel: GoalModel): MatchPrediction {
  // Degrade for group stage fixtures (groupContext non-null = it IS a group match)
  if (!ctx.fixture.id.startsWith('ko:')) {
    return {
      predictorName: 'Fase de Eliminación',
      predictorPriority: 6.8,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'No es un partido de fase eliminatoria — sin contexto de knockout disponible.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['fase de eliminación'],
      sources: [],
      degraded: true,
    };
  }

  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);
  if (goalDegraded) {
    return {
      predictorName: 'Fase de Eliminación',
      predictorPriority: 6.8,
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

  const round = detectRound(ctx.fixture.id);
  const rd = ROUND_DATA[round];
  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 2.5);
  const drivers: string[] = [];

  // Step 1: base goals + tournament inflation
  let homeGoals = baseHome * inflation;
  let awayGoals = baseAway * inflation;

  // Step 2: knockout base compression — KO matches average ~15% fewer goals than groups
  const KO_BASE = 0.87;
  homeGoals *= KO_BASE;
  awayGoals *= KO_BASE;
  drivers.push(`Eliminatoria: compresión base ×${KO_BASE} (menos goles histórico vs grupos)`);

  // Step 3: round depth factor — later rounds = more elite, more tactical
  homeGoals *= rd.scale;
  awayGoals *= rd.scale;
  drivers.push(`${rd.label}: profundidad de ronda ×${rd.scale.toFixed(2)}`);

  // Step 4: tournament form asymmetry — no second chances amplifies form edge
  const homeTMS = clamp(ctx.homeTournamentForm?.momentumScore ?? 0, -1, 1);
  const awayTMS  = clamp(ctx.awayTournamentForm?.momentumScore  ?? 0, -1, 1);
  const formDiff = clamp(homeTMS - awayTMS, -1, 1);
  if (Math.abs(formDiff) > 0.08) {
    const formPush = formDiff * 0.16;
    homeGoals += formPush;
    awayGoals -= formPush;
    const leader = formDiff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
    drivers.push(`Forma diferencial ${formDiff >= 0 ? '+' : ''}${formDiff.toFixed(2)} → ventaja ${leader} en eliminatoria`);
  }

  // Step 5: tactical draw compression — compress lambdas toward average
  // (more draws at 90 min expected in KO; both teams play not to concede)
  const avg = (homeGoals + awayGoals) / 2;
  homeGoals = homeGoals * (1 - rd.neutralize) + avg * rd.neutralize;
  awayGoals = awayGoals * (1 - rd.neutralize) + avg * rd.neutralize;
  drivers.push(`Compresión táctica ×${rd.neutralize.toFixed(2)} → mayor prob. empate al 90'`);

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  // rho = -0.13: more negative than group stage (-0.06) to boost 0-0/1-1 probability
  const scoreline = poissonScoreline(homeGoals, awayGoals, 9, -0.13);
  const best = getMostLikely(scoreline);

  const explanation = `${rd.label} · ×${inflation.toFixed(2)} inflación · ×${KO_BASE} KO · ×${rd.scale.toFixed(2)} ronda. ${drivers.slice(2).join('. ')}. Goles: ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} – ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

  return {
    predictorName: 'Fase de Eliminación',
    predictorPriority: 6.8,
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
    featuresUsed: [
      rd.label,
      `Inflación ×${inflation.toFixed(2)}`,
      'Modelo de goles base',
      ...(Math.abs(formDiff) > 0.08 ? [`Forma torneo (diff ${formDiff.toFixed(2)})`] : []),
    ],
    featuresMissing: [],
    sources: [
      { name: 'wc_actual_results', kind: 'db' },
      { name: 'historical_results.csv', kind: 'csv' },
    ],
    degraded: false,
  };
}
