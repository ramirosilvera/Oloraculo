// =============================================================================
// Oloráculo — L6.8 Knockout Pattern Model ("Fase de Eliminación")
// Adjusts goal expectations for knockout rounds:
//   - Base KO compression: historically ~15% fewer goals than group stage
//   - Round depth factor: QF/SF/Final = more elite teams = more tactical caution
//   - Tournament form asymmetry: better-form team gets edge (no second chances)
//   - Tactical draw compression: higher draw probability at 90 min in KO
//   - More negative rho: increases 0-0 / 1-1 probability (KO teams play to not lose)
//   - NERVES: low knockout-pedigree teams underperform in tight late rounds
//   - PENALTIES: estimates shootout likelihood (round + parity + low scoring) and
//     nudges the pick toward the team better equipped for penalties (GK/takers
//     proxy via squad pedigree, since no player-level pen data exists)
// Degraded for group stage fixtures (id not ko:).
// Symmetric with Patrón de Grupo: exactly one of the two is active per match type.
// =============================================================================

import type { MatchContext, MatchPrediction, SquadStrengthEntry } from '../../types/domain';
import { UNIFORM_OUTCOME } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  normalizeOutcome,
  mostLikelyScore as getMostLikely,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function norm(v: number, max: number) { return clamp(v / max, 0, 1); }

const ROUND_DATA: Record<string, { scale: number; neutralize: number; depth: number; label: string }> = {
  r32:   { scale: 0.97, neutralize: 0.07, depth: 0.20, label: 'R32 (Dieciséisavos)' },
  r16:   { scale: 0.94, neutralize: 0.11, depth: 0.40, label: 'R16 (Octavos)'       },
  qf:    { scale: 0.91, neutralize: 0.15, depth: 0.60, label: 'QF (Cuartos)'        },
  sf:    { scale: 0.89, neutralize: 0.18, depth: 0.85, label: 'SF (Semifinal)'      },
  final: { scale: 0.88, neutralize: 0.20, depth: 1.00, label: 'Final'               },
  '3rd': { scale: 0.92, neutralize: 0.09, depth: 0.30, label: '3er puesto'          },
};

function detectRound(fixtureId: string): string {
  if (fixtureId.includes(':r32:'))   return 'r32';
  if (fixtureId.includes(':r16:'))   return 'r16';
  if (fixtureId.includes(':qf:'))    return 'qf';
  if (fixtureId.includes(':sf:'))    return 'sf';
  if (fixtureId.includes(':final:')) return 'final';
  if (fixtureId.includes(':3rd:'))   return '3rd';
  return 'r32';
}

// Per-team knockout MENTALITY profile (no GK/penalty data exists; proxy it).
// Deliberately EXCLUDES elo & market value: those already drive the base lambdas,
// so reusing them here would double-count strength and amplify the favorite.
// This captures the *residual* of big-match temperament: UCL experience, a settled
// (not too young) age, squad depth of takers, and current momentum.
//   composure: resistance to nerves under knockout pressure.
//   penReady:  shootout readiness (composure + takers' top-level exposure + depth).
interface KoProfile { composure: number; penReady: number; hasData: boolean }
function koProfile(squad: SquadStrengthEntry | undefined, momentum: number): KoProfile {
  const ucl   = squad?.ucl_players ?? 0;
  const top5  = squad?.top5_league_count ?? 0;
  const age   = squad?.avg_age ?? 27.5;
  const depth = clamp(squad?.squad_depth ?? 0.5, 0, 1);
  const agePeak = 1 - clamp(Math.abs(age - 28) / 7, 0, 1) * 0.6;   // peak composure ~28
  const mom = clamp(momentum, -1, 1);

  // Weights renormalized after dropping the elo/mv terms.
  const composure = clamp((0.34 * norm(ucl, 12) + 0.16 * norm(top5, 16) + 0.10 * agePeak + 0.06 * ((mom + 1) / 2)) / 0.66, 0, 1);
  const penReady  = clamp((0.40 * composure + 0.20 * norm(top5, 16) + 0.10 * depth) / 0.70, 0, 1);
  return { composure, penReady, hasData: !!squad };
}

export function knockoutPatternPredict(
  ctx: MatchContext,
  goalModel: GoalModel,
  squadData?: Map<string, SquadStrengthEntry>,
): MatchPrediction {
  const base = {
    predictorName: 'Fase de Eliminación',
    predictorPriority: 6.8,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
  };

  // Degrade for group stage fixtures
  if (!ctx.fixture.id.startsWith('ko:')) {
    return {
      ...base, outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null, expectedAwayGoals: null, scoreline: null, mostLikelyScore: null,
      explanation: 'No es un partido de fase eliminatoria — sin contexto de knockout disponible.',
      drivers: [], featuresUsed: [], featuresMissing: ['fase de eliminación'], sources: [], degraded: true,
    };
  }

  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);
  if (goalDegraded) {
    return {
      ...base, outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null, expectedAwayGoals: null, scoreline: null, mostLikelyScore: null,
      explanation: 'Modelo de goles degradado — datos insuficientes.',
      drivers: [], featuresUsed: [], featuresMissing: ['datos del modelo de goles'], sources: [], degraded: true,
    };
  }

  const round = detectRound(ctx.fixture.id);
  const rd = ROUND_DATA[round];
  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 2.5);
  const drivers: string[] = [];

  // Step 1: base goals + tournament inflation
  let homeGoals = baseHome * inflation;
  let awayGoals = baseAway * inflation;

  // Step 2: knockout base compression
  const KO_BASE = 0.87;
  homeGoals *= KO_BASE; awayGoals *= KO_BASE;
  drivers.push(`Eliminatoria: compresión base ×${KO_BASE} (menos goles histórico vs grupos)`);

  // Step 3: round depth factor
  homeGoals *= rd.scale; awayGoals *= rd.scale;
  drivers.push(`${rd.label}: profundidad de ronda ×${rd.scale.toFixed(2)}`);

  // Step 4: tournament form asymmetry
  const homeTMS = clamp(ctx.homeTournamentForm?.momentumScore ?? 0, -1, 1);
  const awayTMS = clamp(ctx.awayTournamentForm?.momentumScore ?? 0, -1, 1);
  const formDiff = clamp(homeTMS - awayTMS, -1, 1);
  if (Math.abs(formDiff) > 0.08) {
    const formPush = formDiff * 0.16;
    homeGoals += formPush; awayGoals -= formPush;
    const leader = formDiff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
    drivers.push(`Forma diferencial ${formDiff >= 0 ? '+' : ''}${formDiff.toFixed(2)} → ventaja ${leader} en eliminatoria`);
  }

  // Step 5: NERVES — inexperienced (low-pedigree) teams underperform in tight late
  // rounds. Keyed off the mentality residual (not raw strength, already in lambdas).
  const hp = koProfile(squadData?.get(ctx.homeTeam.id), homeTMS);
  const ap = koProfile(squadData?.get(ctx.awayTeam.id), awayTMS);
  const nervH = 0.10 * rd.depth * Math.max(0, 0.5 - hp.composure);
  const nervA = 0.10 * rd.depth * Math.max(0, 0.5 - ap.composure);
  homeGoals *= (1 - nervH);
  awayGoals *= (1 - nervA);
  if (Math.max(nervH, nervA) > 0.015) {
    const nervy = nervH > nervA ? ctx.homeTeam.name : ctx.awayTeam.name;
    drivers.push(`Poca experiencia KO: los nervios penalizan a ${nervy} en ronda decisiva`);
  }

  // Step 6: tactical draw compression
  const avg = (homeGoals + awayGoals) / 2;
  homeGoals = homeGoals * (1 - rd.neutralize) + avg * rd.neutralize;
  awayGoals = awayGoals * (1 - rd.neutralize) + avg * rd.neutralize;
  drivers.push(`Compresión táctica ×${rd.neutralize.toFixed(2)} → mayor prob. empate al 90'`);

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  const scoreline = poissonScoreline(homeGoals, awayGoals, 9, -0.13);
  const best = getMostLikely(scoreline);
  const raw = scorelineToOutcome(scoreline);

  // Step 7: PENALTIES — likelihood + who arrives better. A 90' draw goes to ET/pens;
  // chance rises with round depth, parity and low scoring. (Estimate for the read;
  // the better-prepared team also gets a small edge out of the draw mass.)
  const parity = clamp(1 - Math.abs(raw.homeWin - raw.awayWin), 0, 1);
  const penProb = clamp(raw.draw * 0.50 * (0.85 + 0.30 * rd.depth) * (0.7 + 0.6 * parity), 0, raw.draw);
  const penReadyDiff = hp.penReady - ap.penReady;   // home − away (residual, no strength)
  const compDiff = hp.composure - ap.composure;

  let { homeWin, draw, awayWin } = raw;
  // Shift part of the draw mass to the team better set for a shootout / more composed.
  // Bounded small (residual signal only) so it nudges the pick, never overrides it.
  const shift = clamp(0.10 * penReadyDiff + 0.05 * compDiff, -0.05, 0.05);
  const take = Math.min(Math.abs(shift), draw * 0.6);
  if (shift >= 0) homeWin += take; else awayWin += take;
  draw -= take;
  const outcome = normalizeOutcome({ homeWin, draw, awayWin });

  const hasSquad = hp.hasData && ap.hasData;
  if (hasSquad && penProb >= 0.12) {
    drivers.push(`Alta probabilidad de penales (~${Math.round(penProb * 100)}%) por ronda y paridad`);
  }
  if (hasSquad && Math.abs(penReadyDiff) > 0.12 && penProb >= 0.08) {
    const better = penReadyDiff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
    drivers.push(`${better} llega mejor a penales (arquero/pateadores, proxy de plantel)`);
  }
  if (hasSquad && Math.abs(compDiff) > 0.20) {
    const elite = compDiff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
    drivers.push(`${elite} con más experiencia de partido grande (UCL/veteranía)`);
  }

  const explanation = `${rd.label} · ×${inflation.toFixed(2)} inflación · ×${KO_BASE} KO · ×${rd.scale.toFixed(2)} ronda. ${drivers.slice(2).join('. ')}. Goles: ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} – ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

  return {
    ...base,
    outcome,
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
      ...(hasSquad ? ['Composure/experiencia KO', 'Preparación para penales'] : []),
    ],
    featuresMissing: hasSquad ? [] : ['datos de plantel (composure/penales)'],
    sources: [
      { name: 'wc_actual_results', kind: 'db' },
      { name: 'historical_results.csv', kind: 'csv' },
      ...(hasSquad ? [{ name: 'squad-strength.json', kind: 'json' as const }] : []),
    ],
    degraded: false,
  };
}
