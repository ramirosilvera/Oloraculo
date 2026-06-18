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
} from '../types/domain';
import { buildEvaluationRows, type EvaluationInsert } from './evaluation';

export interface RecomputeDeps {
  engine: PredictionEngine;
  fixtures: Fixture[];
  teamMap: Map<string, Team>;
  ratingsList: Rating[];
  contextMap: Map<string, FixtureContext>;
  wcResults: WcActualResult[];
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
  const { engine, fixtures, teamMap, ratingsList, contextMap, wcResults } = deps;

  const fixtureById = new Map(fixtures.map(f => [f.id, f]));
  const rows: EvaluationInsert[] = [];
  const fixtureIds: string[] = [];
  let matchesProcessed = 0;
  let matchesSkipped = 0;

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
    fixtureIds.push(r.fixture_id);
    matchesProcessed++;
  }

  return { rows, fixtureIds, matchesProcessed, matchesSkipped };
}
