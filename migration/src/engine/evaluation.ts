// =============================================================================
// Oloráculo — Evaluation row builder
// Shared logic used both when recording a result live (MatchesPage) and when
// recomputing the full evaluation history (PerformancePage "Recalcular").
// Keeping it in one place guarantees both paths produce identical rows.
// =============================================================================

import type { Fixture, MatchPrediction, PredictionEvaluation } from '../types/domain';
import { brierScore, rankedProbabilityScore, logLoss, topPick } from './probability-helper';

export type EvaluationInsert = Omit<PredictionEvaluation, 'id' | 'predicted_at'>;

/**
 * Build one evaluation row per non-degraded model for a played fixture.
 * `exact_score_correct` is true only when the model's most-likely scoreline
 * matches the real result exactly; null when the model has no scoreline.
 */
export function buildEvaluationRows(
  predictions: MatchPrediction[],
  fixture: Pick<Fixture, 'id' | 'home_team_id' | 'away_team_id'>,
  homeGoals: number,
  awayGoals: number,
): EvaluationInsert[] {
  const actual: 'Home' | 'Draw' | 'Away' =
    homeGoals > awayGoals ? 'Home' : homeGoals === awayGoals ? 'Draw' : 'Away';

  return predictions
    .filter(p => !p.degraded)
    .map(p => ({
      model_name: p.predictorName,
      fixture_id: fixture.id,
      home_team_id: fixture.home_team_id,
      away_team_id: fixture.away_team_id,
      home_goals: homeGoals,
      away_goals: awayGoals,
      home_win: p.outcome.homeWin,
      draw: p.outcome.draw,
      away_win: p.outcome.awayWin,
      actual,
      brier_score: brierScore(p.outcome, actual),
      ranked_probability_score: rankedProbabilityScore(p.outcome, actual),
      log_loss: logLoss(p.outcome, actual),
      top_pick_correct: topPick(p.outcome) === actual,
      exact_score_correct: p.mostLikelyScore != null
        ? p.mostLikelyScore.home === homeGoals && p.mostLikelyScore.away === awayGoals
        : null,
    }));
}
