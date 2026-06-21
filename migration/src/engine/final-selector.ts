// =============================================================================
// Oloráculo — Final Prediction Selector
// Migrated from: Oloraculo.Web/Predictors/FinalPredictionSelector.cs
// Pure function — no server required
// =============================================================================

import type { Fixture, MatchPrediction, OutcomeProbabilities, PredictionEvaluation } from '../types/domain';
import { applyDrawCalibration, normalizeOutcome, topPick } from './probability-helper';

// Minimum evaluations per model before its weight is trusted
const MIN_EVALS_FOR_WEIGHT = 5;

// Static fallback ensemble weights (used when Brier history is too sparse).
// Calibrated on WC historical data: Goals/Momentum is the strongest signal,
// Squad Quality adds market-value grounding, Elo/Form provide stability.
const STATIC_FALLBACK_WEIGHTS = new Map<string, number>([
  ['Momentum del Mundial', 0.40],
  ['Potencial del plantel', 0.20],
  ['Elo',                  0.25],
  ['Forma reciente',       0.15],
]);

/**
 * Compute ensemble weights for each model from evaluation history.
 * Hybrid signal: winner-rate × inverse-Brier. This means a model needs both
 * directional accuracy (picks the right winner) AND probability calibration
 * (low Brier score) to earn high ensemble weight.
 * Models with fewer than MIN_EVALS_FOR_WEIGHT evaluations are excluded.
 * Returns an empty map when there's not enough data to form an ensemble.
 */
export function computeModelWeights(evals: PredictionEvaluation[]): Map<string, number> {
  // Count evaluations per model
  const counts = new Map<string, number>();
  for (const e of evals) counts.set(e.model_name, (counts.get(e.model_name) ?? 0) + 1);

  // Recency-weighted Brier score + winner rate per model.
  // Decay 0.97 (was 0.92): with only ~28 matches in a single tournament phase
  // there is no regime shift, so older matches should not be discounted heavily.
  const sorted = [...evals].sort(
    (a, b) => new Date(a.predicted_at).getTime() - new Date(b.predicted_at).getTime(),
  );
  const n = sorted.length;
  const accum = new Map<string, { wBrierSum: number; wWinSum: number; wSum: number }>();
  for (let i = 0; i < n; i++) {
    const e = sorted[i];
    const rw = Math.pow(0.97, n - 1 - i); // most-recent match → weight 1.0
    const acc = accum.get(e.model_name) ?? { wBrierSum: 0, wWinSum: 0, wSum: 0 };
    acc.wBrierSum += e.brier_score * rw;
    acc.wWinSum  += (e.top_pick_correct ? 1 : 0) * rw;
    acc.wSum     += rw;
    accum.set(e.model_name, acc);
  }

  const raw = new Map<string, number>();
  for (const [model, acc] of accum) {
    if ((counts.get(model) ?? 0) < MIN_EVALS_FOR_WEIGHT) continue;
    const avgBrier = acc.wBrierSum / acc.wSum;
    const winRate  = acc.wWinSum  / acc.wSum;
    // winner-rate × inverse-Brier: both factors must be good for a high weight.
    // Since weights are normalized, absolute scale doesn't matter.
    raw.set(model, Math.max(0.001, winRate) * (1 / Math.max(0.05, avgBrier)));
  }

  if (raw.size < 2) return STATIC_FALLBACK_WEIGHTS;

  const total = [...raw.values()].reduce((s, v) => s + v, 0);
  const weights = new Map<string, number>();
  for (const [k, v] of raw) weights.set(k, v / total);
  return weights;
}

const RANKING_BIAS_WEIGHT = 0.15;

function outcomeLabelEs(outcome: string): string {
  if (outcome === 'Home') return 'equipo A';
  if (outcome === 'Away') return 'equipo B';
  return 'empate';
}

function reason(p: MatchPrediction): string {
  if (p.featuresMissing.length === 0) return 'degradado sin detalle';
  const verb = p.featuresMissing.length === 1 ? 'faltaba' : 'faltaban';
  return `no era usable: ${verb} ${p.featuresMissing.join(', ')}`;
}

interface RankingBias {
  outcome: OutcomeProbabilities;
  consensusTopPick: string;
}

// Applies a small Elo correction when Elo strongly disagrees with the selected model.
// FIFA Ranking was removed from the ladder (redundant with Elo, 0.82 correlation),
// so the consensus is now Elo-only.
function tryBuildRankingBias(
  ordered: MatchPrediction[],
  selected: MatchPrediction,
): RankingBias | null {
  const elo = [...ordered].reverse().find(p => p.predictorName === 'Elo' && !p.degraded);
  if (!elo) return null;

  const consensusTopPick = topPick(elo.outcome);
  if (consensusTopPick === topPick(selected.outcome)) return null;

  const sw = 1 - RANKING_BIAS_WEIGHT;
  return {
    outcome: normalizeOutcome({
      homeWin: selected.outcome.homeWin * sw + elo.outcome.homeWin * RANKING_BIAS_WEIGHT,
      draw: selected.outcome.draw * sw + elo.outcome.draw * RANKING_BIAS_WEIGHT,
      awayWin: selected.outcome.awayWin * sw + elo.outcome.awayWin * RANKING_BIAS_WEIGHT,
    }),
    consensusTopPick,
  };
}

/**
 * Selects the highest usable predictor from the ladder.
 *
 * When modelWeights is supplied (computed from historical Brier scores via
 * computeModelWeights), blends outcome probabilities from all usable models
 * inversely proportional to their past error — lower Brier → higher weight.
 * Falls back to Elo/FIFA ranking-bias adjustment when no learned weights exist.
 *
 * Migrated from FinalPredictionSelector.Select()
 */
function isGroupStageFixture(fixture: Pick<Fixture, 'group_name'>): boolean {
  return fixture.group_name !== '' && fixture.group_name != null;
}

export function selectFinalPrediction(
  ladder: MatchPrediction[],
  modelWeights?: Map<string, number>,
  fixture?: Pick<Fixture, 'group_name'>,
): MatchPrediction {
  if (ladder.length === 0) {
    return {
      predictorName: 'Oráculo final',
      predictorPriority: 0,
      fixtureId: '',
      homeTeamId: '',
      awayTeamId: '',
      outcome: { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'El Oráculo final no tenía predicciones en la escalera.',
      drivers: ['No había predicciones disponibles.'],
      featuresUsed: [],
      featuresMissing: ['predicciones de la escalera'],
      sources: [],
      degraded: true,
    };
  }

  const ordered = [...ladder].sort((a, b) => a.predictorPriority - b.predictorPriority);
  const usable = ordered.filter(p => !p.degraded);
  const selected = usable.length > 0 ? usable[usable.length - 1] : ordered[0];
  const skippedHigher = ordered.filter(
    p => p.predictorPriority > selected.predictorPriority && p.degraded,
  );

  // Ensemble: blend usable models weighted by inverse Brier score
  const weightedUsable = usable.filter(p => (modelWeights?.get(p.predictorName) ?? 0) > 0);
  const isEnsemble = modelWeights !== undefined && weightedUsable.length >= 2;

  let finalOutcome: OutcomeProbabilities;
  const drivers: string[] = [`Seleccionó ${selected.predictorName} como el escalón usable más alto.`];
  drivers.push(...skippedHigher.map(p => `Omitió ${p.predictorName}: ${reason(p)}`));
  drivers.push(...selected.drivers);

  let ensembleNote = '';
  if (isEnsemble) {
    const totalW = weightedUsable.reduce((s, p) => s + modelWeights!.get(p.predictorName)!, 0);
    finalOutcome = normalizeOutcome({
      homeWin: weightedUsable.reduce((s, p) => s + p.outcome.homeWin * modelWeights!.get(p.predictorName)!, 0) / totalW,
      draw:    weightedUsable.reduce((s, p) => s + p.outcome.draw    * modelWeights!.get(p.predictorName)!, 0) / totalW,
      awayWin: weightedUsable.reduce((s, p) => s + p.outcome.awayWin * modelWeights!.get(p.predictorName)!, 0) / totalW,
    });
    const parts = weightedUsable.map(p => `${p.predictorName} ${(modelWeights!.get(p.predictorName)! * 100).toFixed(0)}%`);
    drivers.push(`Ensemble adaptativo (${weightedUsable.length} modelos): ${parts.join(', ')}`);
    ensembleNote = ` Ensemble de ${weightedUsable.length} modelos calibrado por historial.`;
  } else {
    const rankingBias = tryBuildRankingBias(ordered, selected);
    finalOutcome = rankingBias?.outcome ?? selected.outcome;
    if (rankingBias) {
      const rb = rankingBias.consensusTopPick;
      drivers.push(`Aplicó calibración Elo/FIFA de ${(RANKING_BIAS_WEIGHT * 100).toFixed(0)}% hacia ${outcomeLabelEs(rb)}.`);
      ensembleNote = ` Aplicó calibración Elo/FIFA de ${(RANKING_BIAS_WEIGHT * 100).toFixed(0)}% hacia ${outcomeLabelEs(rb)}.`;
    }
  }

  let calibrationNote = '';
  if (fixture && isGroupStageFixture(fixture)) {
    finalOutcome = applyDrawCalibration(finalOutcome);
    calibrationNote = ' Calibración de empate fase de grupos aplicada.';
    drivers.push('Aplicó calibración bayesiana de empate (prior Copa del Mundo fase de grupos).');
  }

  const skippedStr = skippedHigher.map(p => `${p.predictorName} ${reason(p)}`).join('; ');
  const explanation = (skippedHigher.length === 0
    ? `El Oráculo final seleccionó ${selected.predictorName}, el escalón usable más alto. ${selected.explanation}`
    : `El Oráculo final seleccionó ${selected.predictorName} porque ${skippedStr}. ${selected.explanation}`)
    + ensembleNote + calibrationNote;

  return {
    predictorName: 'Oráculo final',
    predictorPriority: selected.predictorPriority,
    fixtureId: selected.fixtureId,
    homeTeamId: selected.homeTeamId,
    awayTeamId: selected.awayTeamId,
    outcome: finalOutcome,
    expectedHomeGoals: selected.expectedHomeGoals,
    expectedAwayGoals: selected.expectedAwayGoals,
    scoreline: selected.scoreline,
    mostLikelyScore: selected.mostLikelyScore,
    explanation,
    drivers,
    featuresUsed: selected.featuresUsed,
    featuresMissing: selected.featuresMissing,
    sources: [...new Set([...selected.sources, { name: 'model ladder', kind: 'derived' }])],
    degraded: selected.degraded,
  };
}
