// =============================================================================
// Oloráculo — Recompute evaluations
// Re-runs the current prediction engine over every played match and rewrites
// the prediction_evaluations table. Used after a model change (e.g. squad
// strength tuning) so the Performance dashboard reflects the live models and
// backfills metrics such as exact_score_correct that older rows lack.
//
// Runs in the browser (where Supabase + the engine are both available).
// =============================================================================

import type { PredictionEngine } from './prediction-engine';
import type {
  Fixture,
  Rating,
  Team,
  FixtureContext,
  WcActualResult,
  SquadStrengthEntry,
} from '../types/domain';
import { buildEvaluationRows, type EvaluationInsert } from './evaluation';
import { buildSCFContext } from './scf/context-builder';
import { computeSCFScore, STATIC_HEURISTICS } from './scf/engine';
import { brierScore, rankedProbabilityScore, logLoss, topPick } from './probability-helper';

export interface RecomputeDeps {
  engine: PredictionEngine;
  fixtures: Fixture[];
  teamMap: Map<string, Team>;
  ratingsList: Rating[];
  contextMap: Map<string, FixtureContext>;
  wcResults: WcActualResult[];
  squadStrengthData: Record<string, SquadStrengthEntry>;
}

export interface RecomputeResult {
  rows: EvaluationInsert[];
  fixtureIds: string[];
  matchesProcessed: number;
  matchesSkipped: number;
}

/**
 * Build a fresh set of evaluation rows for every played match.
 * Pure: it only reads data and returns rows — persistence is the caller's job.
 */
export function recomputeEvaluations(deps: RecomputeDeps): RecomputeResult {
  const { engine, fixtures, teamMap, ratingsList, contextMap, wcResults, squadStrengthData } = deps;

  const fixtureById = new Map(fixtures.map(f => [f.id, f]));
  const rows: EvaluationInsert[] = [];
  const fixtureIds: string[] = [];
  let matchesProcessed = 0;
  let matchesSkipped = 0;

  const actual = (hg: number, ag: number): 'Home' | 'Draw' | 'Away' =>
    hg > ag ? 'Home' : hg === ag ? 'Draw' : 'Away';

  for (const r of wcResults) {
    const fixture = fixtureById.get(r.fixture_id);
    if (!fixture) { matchesSkipped++; continue; }

    // Per-model ladder predictions are independent of the ensemble weighting,
    // so we predict without weights for a clean, deterministic per-model eval.
    const ctx = engine.buildContext(fixture, teamMap, ratingsList, contextMap, wcResults, fixtures);
    const result = engine.predict(ctx);

    const built = buildEvaluationRows(result.predictions, fixture, r.home_goals, r.away_goals);
    if (built.length === 0) { matchesSkipped++; continue; }

    rows.push(...built);

    // SCF evaluation row
    const homeTeam = teamMap.get(fixture.home_team_id);
    const awayTeam = teamMap.get(fixture.away_team_id);
    if (homeTeam && awayTeam) {
      const scfCtx = buildSCFContext(fixture, homeTeam, awayTeam, ratingsList, fixtures, wcResults, squadStrengthData);
      const scfResult = computeSCFScore(scfCtx, STATIC_HEURISTICS);
      if (!scfResult.degraded) {
        const out = scfResult.outcome;
        const act = actual(r.home_goals, r.away_goals);
        rows.push({
          model_name: 'S. Común Futbolero',
          fixture_id: fixture.id,
          home_team_id: fixture.home_team_id,
          away_team_id: fixture.away_team_id,
          home_goals: r.home_goals,
          away_goals: r.away_goals,
          home_win: out.homeWin,
          draw: out.draw,
          away_win: out.awayWin,
          actual: act,
          brier_score: brierScore(out, act),
          ranked_probability_score: rankedProbabilityScore(out, act),
          log_loss: logLoss(out, act),
          top_pick_correct: topPick(out) === act,
          exact_score_correct: scfResult.mostLikelyScore != null
            ? scfResult.mostLikelyScore.home === r.home_goals && scfResult.mostLikelyScore.away === r.away_goals
            : null,
        });
      }
    }

    fixtureIds.push(r.fixture_id);
    matchesProcessed++;
  }

  return { rows, fixtureIds, matchesProcessed, matchesSkipped };
}
