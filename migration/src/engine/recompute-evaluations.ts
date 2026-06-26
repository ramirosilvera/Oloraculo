// =============================================================================
// Oloráculo — Recompute evaluations
// Re-runs the current prediction engine over every played match and rewrites
// the prediction_evaluations table. Used after a model change (e.g. squad
// strength tuning) so the Performance dashboard reflects the live models and
// backfills metrics such as exact_score_correct that older rows lack.
//
// PIE is evaluated via leave-one-out cross-validation (recomputePIELOO):
// for each match X the track records are built WITHOUT X, then X is predicted.
// This prevents in-sample inflation of PIE metrics.
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
 * Build evaluation rows for all statistical models (no PIE).
 * Pure and synchronous — PIE uses the separate LOO function below.
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

// ---------------------------------------------------------------------------
// PIE — Leave-One-Out cross-validation
// ---------------------------------------------------------------------------

export interface PIELOOProgress {
  current: number;
  total: number;
}

/**
 * Evaluate PIE using leave-one-out cross-validation.
 * For each match X: build track records from all matches EXCEPT X, then
 * predict X. This gives honest out-of-sample metrics — no data leakage.
 *
 * Async so the caller can yield between iterations and update a progress bar.
 */
export async function recomputePIELOO(
  deps: RecomputeDeps,
  onProgress: (p: PIELOOProgress) => void,
): Promise<{ rows: EvaluationInsert[]; fixtureIds: string[] }> {
  const { fixtures, ratingsList, wcResults } = deps;

  const fixtureById = new Map(fixtures.map(f => [f.id, f]));
  const rows: EvaluationInsert[] = [];
  const fixtureIds: string[] = [];
  const total = wcResults.length;

  const latestElo = (teamId: string) => {
    let best: Rating | null = null;
    for (const rt of ratingsList) {
      if (rt.team_id !== teamId || rt.type !== 'elo') continue;
      if (!best || rt.as_of > best.as_of) best = rt;
    }
    return best?.value ?? 0;
  };

  const actual = (hg: number, ag: number): 'Home' | 'Draw' | 'Away' =>
    hg > ag ? 'Home' : hg === ag ? 'Draw' : 'Away';

  for (let idx = 0; idx < total; idx++) {
    const r = wcResults[idx];
    const fixture = fixtureById.get(r.fixture_id);

    if (fixture) {
      // Training set: all matches except this one.
      // Skip if fewer than 5 training matches — rankings are too noisy to be meaningful.
      const trainResults = wcResults.filter((_, i) => i !== idx);
      if (trainResults.length < 5) {
        onProgress({ current: idx + 1, total });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        continue;
      }

      // Build Elo map from training set only
      const eloByFixture = new Map<string, { home: number; away: number }>();
      for (const wr of trainResults) {
        const wf = fixtureById.get(wr.fixture_id);
        if (wf) eloByFixture.set(wr.fixture_id, {
          home: latestElo(wf.home_team_id),
          away: latestElo(wf.away_team_id),
        });
      }

      // Track records built WITHOUT the target match
      const pieRecords = buildPIETrackRecords(fixtures, trainResults, eloByFixture);

      const homeElo = latestElo(fixture.home_team_id);
      const awayElo = latestElo(fixture.away_team_id);

      // Predict using training-only records; form bonus also excludes match X
      const pieResult = computePIEFromRecords(
        fixture, homeElo, awayElo, trainResults, fixtures, pieRecords,
      );

      if (!pieResult.degraded) {
        const out = {
          homeWin: pieResult.pick_probabilities.home,
          draw:    pieResult.pick_probabilities.draw,
          awayWin: pieResult.pick_probabilities.away,
        };
        const act = actual(r.home_goals, r.away_goals);

        // PIE Consenso — weighted top-K consensus
        rows.push({
          model_name: 'PIE Consenso',
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
          predicted_home_goals: pieResult.mostLikelyScore?.home ?? null,
          predicted_away_goals: pieResult.mostLikelyScore?.away ?? null,
        });
        fixtureIds.push(r.fixture_id);

        // PIE Campeón — the #1-ranked individual player's personal pick
        if (pieResult.leader) {
          const leaderPick = pieResult.leader.pick;
          // Soft probability: 0.70 for the picked direction, 0.15 for each other
          const chProbs = {
            homeWin: leaderPick === 'Home' ? 0.70 : 0.15,
            draw:    leaderPick === 'Draw' ? 0.70 : 0.15,
            awayWin: leaderPick === 'Away' ? 0.70 : 0.15,
          };
          rows.push({
            model_name: 'PIE Campeón',
            fixture_id: fixture.id,
            home_team_id: fixture.home_team_id,
            away_team_id: fixture.away_team_id,
            home_goals: r.home_goals,
            away_goals: r.away_goals,
            home_win: chProbs.homeWin,
            draw: chProbs.draw,
            away_win: chProbs.awayWin,
            actual: act,
            brier_score: brierScore(chProbs, act),
            ranked_probability_score: rankedProbabilityScore(chProbs, act),
            log_loss: logLoss(chProbs, act),
            top_pick_correct: leaderPick === act,
            exact_score_correct: pieResult.leader.pickScore != null
              ? pieResult.leader.pickScore.home === r.home_goals && pieResult.leader.pickScore.away === r.away_goals
              : null,
            predicted_home_goals: pieResult.leader.pickScore?.home ?? null,
            predicted_away_goals: pieResult.leader.pickScore?.away ?? null,
          });
        }
      }
    }

    onProgress({ current: idx + 1, total });
    // Yield to the event loop so the UI progress bar can repaint
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  return { rows, fixtureIds };
}
