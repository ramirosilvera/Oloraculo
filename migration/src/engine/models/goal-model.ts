// =============================================================================
// Oloráculo — Goal Model (Dixon-Coles Poisson, L4)
// Migrated from: Oloraculo.Web/Predictors/GoalModel.cs
// Pure function — no server required
// =============================================================================

import type { MatchContext, MatchPrediction } from '../../types/domain';
import type { MatchResult } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore as getMostLikely,
  eloExpectation,
} from '../probability-helper';

const DEFAULT_AVERAGE_GOALS = 1.25;
const PRIOR_MATCHES = 1.5;
const GOAL_SCALE = 1.10;
const LOW_SCORE_RHO = -0.03;
const HOME_ADVANTAGE_MULTIPLIER = 1.08;
const MIN_TEAM_MATCHES = 3;
const ITERATIONS = 8;
// Elo-gap multiplier for lambda: at P(home)=0.95 (≈500pt gap), home λ ×1.60 and away λ ×0.40.
// Increased from 1.0 → 1.3: WC2026 shows 3-0/3-1 at 18% combined (was 12% historical).
// Poisson with old sensitivity over-produced 2-0/2-1 for clear mismatches; raising this shifts
// probability mass from the "medium-dominant" zone into proper blowout territory.
const ELO_GOAL_SENSITIVITY = 1.3;

export interface GoalStrength {
  attack: number;
  defenseVulnerability: number;
  matches: number;
}

interface FitResult {
  strengths: Map<string, GoalStrength>;
  avgGoals: number;
  matchesUsed: number;
}

/**
 * Weight multiplier by competition type so that World Cup / qualifier results
 * inform the model more than low-stakes friendlies.
 * Friendly: 0.5 × | Qualifier: 1.2 × | Major tournament: 1.5 × | Default: 1.0 ×
 */
export function matchTournamentWeight(tournament: string): number {
  const t = (tournament ?? '').toLowerCase();
  if (t.includes('world cup') || t.includes('copa del mundo') || t.includes('fifa world')) return 1.5;
  if (t.includes('qualifier') || t.includes('qualification') || t.includes('eliminat')) return 1.2;
  if (
    t.includes('euro') || t.includes('copa america') || t.includes('african cup') ||
    t.includes('gold cup') || t.includes('asian cup') || t.includes('nations cup')
  ) return 1.3;
  if (t.includes('nations league') || t.includes('liga de naciones')) return 1.1;
  if (t.includes('friendly') || t.includes('amistoso') || t.includes('test match')) return 0.5;
  return 1.0;
}

function shrinkToNeutral(value: number, weight: number): number {
  return Math.max(0.45, Math.min(2.25, ((value * weight) + PRIOR_MATCHES) / (weight + PRIOR_MATCHES)));
}

function normalizeMean(values: Map<string, number>): void {
  if (values.size === 0) return;
  const mean = [...values.values()].reduce((a, b) => a + b, 0) / values.size;
  if (mean <= 0) return;
  for (const [k, v] of values) values.set(k, v / mean);
}

/** Iterative Dixon-Coles fitting — ported 1:1 from GoalModel.Fit() */
export function fitGoalModel(results: MatchResult[], yearsWindow = 8): FitResult {
  if (results.length === 0) {
    return { strengths: new Map(), avgGoals: DEFAULT_AVERAGE_GOALS, matchesUsed: 0 };
  }

  const latest = new Date(Math.max(...results.map(r => new Date(r.date).getTime())));
  const cutoffMs = yearsWindow > 0
    ? new Date(latest.getFullYear() - yearsWindow, latest.getMonth(), latest.getDate()).getTime()
    : -Infinity;

  let window = results.filter(r => new Date(r.date).getTime() >= cutoffMs);
  if (window.length === 0) window = [...results];

  const teams = [...new Set(window.flatMap(r => [r.home_team_id, r.away_team_id]))];
  const attacks = new Map(teams.map(t => [t, 1.0]));
  const vulnerabilities = new Map(teams.map(t => [t, 1.0]));
  const matches = new Map(teams.map(t => [t, 0]));

  for (const r of window) {
    matches.set(r.home_team_id, (matches.get(r.home_team_id) ?? 0) + 1);
    matches.set(r.away_team_id, (matches.get(r.away_team_id) ?? 0) + 1);
  }

  const weighted = window.map(r => {
    const yearsAgo = Math.max(0, (latest.getTime() - new Date(r.date).getTime()) / (365.25 * 86400_000));
    return { result: r, weight: Math.pow(0.75, yearsAgo) * matchTournamentWeight(r.tournament) };
  });

  const totalWeight = weighted.reduce((s, { weight }) => s + weight, 0);
  let avg = totalWeight <= 0
    ? DEFAULT_AVERAGE_GOALS
    : weighted.reduce((s, { result: r, weight }) => s + weight * (r.home_goals + r.away_goals), 0) / (2 * totalWeight);
  avg = Math.max(0.6, Math.min(2.4, avg));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const nextAttacks = new Map<string, number>();
    const nextVulnerabilities = new Map<string, number>();

    for (const team of teams) {
      let goalsFor = 0, attackExpected = 0, goalsAgainst = 0, defenseExpected = 0, teamWeight = 0;

      for (const { result: r, weight } of weighted) {
        const atk = attacks.get(r.away_team_id) ?? 1;
        const def = attacks.get(r.home_team_id) ?? 1;
        const vulH = vulnerabilities.get(r.home_team_id) ?? 1;
        const vulA = vulnerabilities.get(r.away_team_id) ?? 1;

        if (r.home_team_id === team) {
          goalsFor += weight * r.home_goals;
          attackExpected += weight * avg * vulA;
          goalsAgainst += weight * r.away_goals;
          defenseExpected += weight * avg * atk;
          teamWeight += weight;
        } else if (r.away_team_id === team) {
          goalsFor += weight * r.away_goals;
          attackExpected += weight * avg * vulH;
          goalsAgainst += weight * r.home_goals;
          defenseExpected += weight * avg * def;
          teamWeight += weight;
        }
      }

      nextAttacks.set(team, shrinkToNeutral(attackExpected <= 0 ? 1 : goalsFor / attackExpected, teamWeight));
      nextVulnerabilities.set(team, shrinkToNeutral(defenseExpected <= 0 ? 1 : goalsAgainst / defenseExpected, teamWeight));
    }

    normalizeMean(nextAttacks);
    normalizeMean(nextVulnerabilities);
    for (const [k, v] of nextAttacks) attacks.set(k, v);
    for (const [k, v] of nextVulnerabilities) vulnerabilities.set(k, v);
  }

  const strengths = new Map<string, GoalStrength>(
    teams.map(t => [
      t,
      {
        attack: Math.max(0.45, Math.min(2.25, attacks.get(t) ?? 1)),
        defenseVulnerability: Math.max(0.45, Math.min(2.25, vulnerabilities.get(t) ?? 1)),
        matches: matches.get(t) ?? 0,
      },
    ]),
  );

  return { strengths, avgGoals: avg, matchesUsed: window.length };
}

/** Stateful GoalModel — build once per session, predict many */
export class GoalModel {
  readonly name = 'Modelo de goles (Poisson)';
  readonly priority = 4;

  private readonly strengths: Map<string, GoalStrength>;
  readonly avgGoals: number;
  private readonly matchesUsed: number;
  readonly yearsWindow: number;

  constructor(results: MatchResult[], yearsWindow = 8) {
    this.yearsWindow = yearsWindow;
    const fit = fitGoalModel(results, yearsWindow);
    this.strengths = fit.strengths;
    this.avgGoals = fit.avgGoals;
    this.matchesUsed = fit.matchesUsed;
  }

  expectedGoals(ctx: MatchContext): { home: number; away: number; degraded: boolean } {
    const home = this.strengths.get(ctx.homeTeam.id);
    const away = this.strengths.get(ctx.awayTeam.id);
    const degraded =
      !home || !away || (home.matches < MIN_TEAM_MATCHES) || (away.matches < MIN_TEAM_MATCHES);

    const h = home ?? { attack: 1, defenseVulnerability: 1, matches: 0 };
    const a = away ?? { attack: 1, defenseVulnerability: 1, matches: 0 };

    let homeGoals = this.avgGoals * h.attack * a.defenseVulnerability * GOAL_SCALE;
    let awayGoals = this.avgGoals * a.attack * h.defenseVulnerability * GOAL_SCALE;
    if (!ctx.fixture.neutral_venue) homeGoals *= HOME_ADVANTAGE_MULTIPLIER;

    // Elo-gap adjustment: teams with large rating differences get proportionally
    // more/fewer expected goals. This corrects for sparse-data teams (e.g. Haiti)
    // that default to neutral attack/defense despite being heavily outclassed.
    const homeEloVal = ctx.homeElo?.value ?? null;
    const awayEloVal = ctx.awayElo?.value ?? null;
    if (homeEloVal !== null && awayEloVal !== null) {
      const eloP  = eloExpectation(homeEloVal, awayEloVal); // P(home wins) from Elo
      const eloAdj = (eloP - 0.5) * ELO_GOAL_SENSITIVITY;  // 0 for equal, ±0.5 for max gap
      homeGoals *= (1 + eloAdj);
      awayGoals *= (1 - eloAdj);
    }

    return {
      home: Math.max(0.1, Math.min(5.5, homeGoals)),
      away: Math.max(0.1, Math.min(5.5, awayGoals)),
      degraded,
    };
  }

  predict(ctx: MatchContext): MatchPrediction {
    const { home, away, degraded } = this.expectedGoals(ctx);
    const scoreline = poissonScoreline(home, away, 8, LOW_SCORE_RHO);
    const best = getMostLikely(scoreline);

    return {
      predictorName: this.name,
      predictorPriority: this.priority,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: scorelineToOutcome(scoreline),
      expectedHomeGoals: Math.round(home * 100) / 100,
      expectedAwayGoals: Math.round(away * 100) / 100,
      scoreline,
      mostLikelyScore: best,
      explanation: `Goles esperados: ${ctx.homeTeam.name} ${home.toFixed(2)} - ${away.toFixed(2)} ${ctx.awayTeam.name}, ajustado con ${this.matchesUsed} resultados históricos en una ventana de ${this.yearsWindow} años.`,
      drivers: [`Marcador más probable: ${best.home}-${best.away}`],
      featuresUsed: [
        'Fuerza de ataque ajustada por rival',
        'Vulnerabilidad defensiva ajustada por rival',
        'Grilla de marcadores Dixon-Coles',
      ],
      featuresMissing: degraded ? ['historial de goles suficiente para ambos equipos'] : [],
      sources: [{ name: 'historical_results.csv', kind: 'csv' }],
      degraded,
    };
  }
}
