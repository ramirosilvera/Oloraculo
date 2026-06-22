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
// Team, SquadStrengthEntry kept for RecomputeDeps callers
import { buildEvaluationRows, type EvaluationInsert } from './evaluation';
import { buildPIETrackRecords, computePIEFromRecords } from './pie/engine';
import { brierScore, rankedProbabilityScore, logLoss, topPick } from './probability-helper';

export interface RecomputeDeps {
  engine: PredictionEngine;
  fixtures: Fixture[];
  teamMap: Map<string, Team>;
  ratingsList: Rating[];
  contextMap: Map<string, FixtureContext>;
  wcResults: WcActualResult[];
  squadStrengthData?: Record<string, SquadStrengthEntry>;
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

  const actual = (hg: number, ag: number): 'Home' | 'Draw' | 'Away' =>
    hg > ag ? 'Home' : hg === ag ? 'Draw' : 'Away';

  // Build Elo lookup and PIE track records ONCE (not once per fixture)
  const latestElo = (teamId: string) => {
    let best: Rating | null = null;
    for (const rt of ratingsList) {
      if (rt.team_id !== teamId || rt.type !== 'elo') continue;
      if (!best || rt.as_of > best.as_of) best = rt;
    }
    return best?.value ?? 0;
  };
  const eloByFixture = new Map<string, { home: number; away: number }>();
  for (const wr of wcResults) {
    const wf = fixtureById.get(wr.fixture_id);
    if (wf) eloByFixture.set(wr.fixture_id, { home: latestElo(wf.home_team_id), away: latestElo(wf.away_team_id) });
  }
  const pieRecords = buildPIETrackRecords(fixtures, wcResults, eloByFixture);

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

    // PIE evaluation row
    {
      const pieResult = computePIEFromRecords(
        fixture,
        latestElo(fixture.home_team_id),
        latestElo(fixture.away_team_id),
        wcResults,
        fixtures,
        pieRecords,
      );
      if (!pieResult.degraded) {
        const out = { homeWin: pieResult.pick_probabilities.home, draw: pieResult.pick_probabilities.draw, awayWin: pieResult.pick_probabilities.away };
        const act = actual(r.home_goals, r.away_goals);
        rows.push({
          model_name: 'PIE',
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
          top_pick_correct: pieResult.most_probable_pick === act,
          exact_score_correct: pieResult.mostLikelyScore != null
            ? pieResult.mostLikelyScore.home === r.home_goals && pieResult.mostLikelyScore.away === r.away_goals
            : null,
        });
      }
    }

    fixtureIds.push(r.fixture_id);
    matchesProcessed++;
  }

  return { rows, fixtureIds, matchesProcessed, matchesSkipped };
}
