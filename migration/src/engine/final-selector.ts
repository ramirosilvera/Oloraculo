// =============================================================================
// Oloráculo — Final Prediction Selector
// Migrated from: Oloraculo.Web/Predictors/FinalPredictionSelector.cs
// Pure function — no server required
// =============================================================================

import type { MatchPrediction, OutcomeProbabilities } from '../types/domain';
import { normalizeOutcome, topPick } from './probability-helper';

const RANKING_BIAS_WEIGHT = 0.15;

function outcomeLabelEs(outcome: string): string {
  if (outcome === 'Home') return 'equipo A';
  if (outcome === 'Away') return 'equipo B';
  return 'empate';
}

function reason(p: MatchPrediction): string {
  if (p.featuresMissing.length === 0) return 'no era usable';
  const verb = p.featuresMissing.length === 1 ? 'faltaba' : 'faltaban';
  return `no era usable: ${verb} ${p.featuresMissing.join(', ')}`;
}

interface RankingBias {
  outcome: OutcomeProbabilities;
  consensusTopPick: string;
}

function tryBuildRankingBias(
  ordered: MatchPrediction[],
  selected: MatchPrediction,
): RankingBias | null {
  const elo = [...ordered].reverse().find(p => p.predictorName === 'Elo' && !p.degraded);
  const fifa = [...ordered].reverse().find(p => p.predictorName === 'Ranking FIFA' && !p.degraded);
  if (!elo || !fifa) return null;

  const consensusTopPick = topPick(elo.outcome);
  if (consensusTopPick !== topPick(fifa.outcome)) return null;
  if (consensusTopPick === topPick(selected.outcome)) return null;

  const consensus = normalizeOutcome({
    homeWin: (elo.outcome.homeWin + fifa.outcome.homeWin) / 2,
    draw: (elo.outcome.draw + fifa.outcome.draw) / 2,
    awayWin: (elo.outcome.awayWin + fifa.outcome.awayWin) / 2,
  });

  const sw = 1 - RANKING_BIAS_WEIGHT;
  return {
    outcome: normalizeOutcome({
      homeWin: selected.outcome.homeWin * sw + consensus.homeWin * RANKING_BIAS_WEIGHT,
      draw: selected.outcome.draw * sw + consensus.draw * RANKING_BIAS_WEIGHT,
      awayWin: selected.outcome.awayWin * sw + consensus.awayWin * RANKING_BIAS_WEIGHT,
    }),
    consensusTopPick,
  };
}

/**
 * Selects the highest usable predictor from the ladder.
 * Applies an optional Elo/FIFA consensus bias when they agree against the selected model.
 * Migrated from FinalPredictionSelector.Select()
 */
export function selectFinalPrediction(ladder: MatchPrediction[]): MatchPrediction {
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
  const selected = [...ordered].reverse().find(p => !p.degraded) ?? ordered[0];
  const skippedHigher = ordered.filter(
    p => p.predictorPriority > selected.predictorPriority && p.degraded,
  );
  const rankingBias = tryBuildRankingBias(ordered, selected);

  const drivers: string[] = [`Seleccionó ${selected.predictorName} como el escalón usable más alto.`];
  drivers.push(...skippedHigher.map(p => `Omitió ${p.predictorName}: ${reason(p)}`));
  drivers.push(...selected.drivers);
  if (rankingBias) {
    drivers.push(
      `Aplicó calibración Elo/FIFA de ${(RANKING_BIAS_WEIGHT * 100).toFixed(0)}% hacia ${outcomeLabelEs(rankingBias.consensusTopPick)}.`,
    );
  }

  const skippedStr = skippedHigher.map(p => `${p.predictorName} ${reason(p)}`).join('; ');
  const rankingSentence = rankingBias
    ? ` Aplicó calibración Elo/FIFA de ${(RANKING_BIAS_WEIGHT * 100).toFixed(0)}% hacia ${outcomeLabelEs(rankingBias.consensusTopPick)}.`
    : '';

  const explanation =
    skippedHigher.length === 0
      ? `El Oráculo final seleccionó ${selected.predictorName}, el escalón usable más alto. ${selected.explanation}${rankingSentence}`
      : `El Oráculo final seleccionó ${selected.predictorName} porque ${skippedStr}. ${selected.explanation}${rankingSentence}`;

  return {
    predictorName: 'Oráculo final',
    predictorPriority: selected.predictorPriority,
    fixtureId: selected.fixtureId,
    homeTeamId: selected.homeTeamId,
    awayTeamId: selected.awayTeamId,
    outcome: rankingBias?.outcome ?? selected.outcome,
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
