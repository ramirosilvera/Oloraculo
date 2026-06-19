// =============================================================================
// Oloráculo — Probability Engine
// Migrated from: Oloraculo.Web/Probability/ProbabilityHelper.cs
// Pure functions — no dependencies, fully browser-safe
// =============================================================================

import type { OutcomeProbabilities, ScorelineDistribution } from '../types/domain';

/** Elo expected win probability for team A given Elo ratings A and B */
export function eloExpectation(eloA: number, eloB: number): number {
  return 1.0 / (1.0 + Math.pow(10, (eloB - eloA) / 400.0));
}

/**
 * Convert a win expectation [0,1] to Home/Draw/Away probabilities.
 * Draw probability shrinks as the strength gap grows.
 * Migrated from ProbabilityHelper.OutcomeFromExpectation
 */
export function outcomeFromExpectation(
  expectedHome: number,
  strengthGap: number,
): OutcomeProbabilities {
  const closenessGap = Math.abs(strengthGap);
  let drawProbability = 0.3 * Math.exp(-closenessGap / 550.0) + 0.13;
  // Floor raised 0.08→0.13: WC 2026 group stage has ~36% draws vs historical 27%.
  // Higher floor reduces the gap between draw and best-outcome for mismatched teams,
  // making the margin threshold more effective at catching actual draws.
  drawProbability = Math.max(0.13, Math.min(0.38, drawProbability));
  const remaining = 1.0 - drawProbability;

  return normalizeOutcome({
    homeWin: expectedHome * remaining,
    draw: drawProbability,
    awayWin: remaining * (1.0 - expectedHome),
  });
}

/** Normalize so homeWin + draw + awayWin = 1.0 */
export function normalizeOutcome(p: OutcomeProbabilities): OutcomeProbabilities {
  const sum = p.homeWin + p.draw + p.awayWin;
  if (sum <= 0) return { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 };
  return { homeWin: p.homeWin / sum, draw: p.draw / sum, awayWin: p.awayWin / sum };
}

/**
 * Dixon-Coles correction for low-scoring matches.
 * Migrated from ProbabilityHelper.DixonColesTau
 */
function dixonColesTau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1.0 - lh * la * rho;
  if (h === 0 && a === 1) return 1.0 + lh * rho;
  if (h === 1 && a === 0) return 1.0 + la * rho;
  if (h === 1 && a === 1) return 1.0 - rho;
  return 1.0;
}

/** Poisson PMF: P(X=k | lambda) */
function poisson(lambda: number, k: number): number {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return Math.pow(lambda, k) * Math.exp(-lambda) / factorial;
}

/**
 * Build a scoreline probability matrix using Poisson + Dixon-Coles correction.
 * Migrated from ProbabilityHelper.PoissonScoreline
 * Returns a [maxGoals+1][maxGoals+1] matrix of probabilities.
 */
export function poissonScoreline(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = 8,
  lowScoreRho = -0.06,
): ScorelineDistribution {
  const lh = Math.max(0.05, Math.min(6.0, lambdaHome));
  const la = Math.max(0.05, Math.min(6.0, lambdaAway));

  const matrix: number[][] = Array.from({ length: maxGoals + 1 }, () =>
    new Array(maxGoals + 1).fill(0),
  );

  let sum = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = Math.max(
        0,
        poisson(lh, h) * poisson(la, a) * dixonColesTau(h, a, lh, la, lowScoreRho),
      );
      matrix[h][a] = p;
      sum += p;
    }
  }

  if (sum > 0) {
    for (let h = 0; h <= maxGoals; h++)
      for (let a = 0; a <= maxGoals; a++) matrix[h][a] /= sum;
  }

  return { maxGoals, matrix };
}

/** Derive Home/Draw/Away probabilities from a scoreline distribution */
export function scorelineToOutcome(dist: ScorelineDistribution): OutcomeProbabilities {
  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h <= dist.maxGoals; h++) {
    for (let a = 0; a <= dist.maxGoals; a++) {
      const p = dist.matrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  return normalizeOutcome({ homeWin, draw, awayWin });
}

/** Find the (home, away) score with highest probability */
export function mostLikelyScore(dist: ScorelineDistribution): { home: number; away: number } {
  let bestP = -1, bestH = 0, bestA = 0;
  for (let h = 0; h <= dist.maxGoals; h++) {
    for (let a = 0; a <= dist.maxGoals; a++) {
      if (dist.matrix[h][a] > bestP) {
        bestP = dist.matrix[h][a];
        bestH = h;
        bestA = a;
      }
    }
  }
  return { home: bestH, away: bestA };
}

export interface ScoreWithProb { home: number; away: number; prob: number }
export interface ScorelinePerOutcome {
  homeWin: ScoreWithProb | null;
  draw:    ScoreWithProb | null;
  awayWin: ScoreWithProb | null;
}

/**
 * For each outcome (homeWin / draw / awayWin), find the single most probable
 * scoreline within that outcome. Coherent with the outcome bar: if the model
 * says awayWin=44%, the displayed score will be an actual away-win scoreline.
 */
export function mostLikelyScorePerOutcome(dist: ScorelineDistribution): ScorelinePerOutcome {
  let hP = -1, hH = 0, hA = 1;
  let dP = -1, dH = 0, dA = 0;
  let aP = -1, aH = 0, aA = 1;
  for (let h = 0; h <= dist.maxGoals; h++) {
    for (let a = 0; a <= dist.maxGoals; a++) {
      const p = dist.matrix[h][a];
      if (h > a && p > hP) { hP = p; hH = h; hA = a; }
      if (h === a && p > dP) { dP = p; dH = h; dA = a; }
      if (h < a && p > aP) { aP = p; aH = h; aA = a; }
    }
  }
  return {
    homeWin: hP >= 0 ? { home: hH, away: hA, prob: hP } : null,
    draw:    dP >= 0 ? { home: dH, away: dA, prob: dP } : null,
    awayWin: aP >= 0 ? { home: aH, away: aA, prob: aP } : null,
  };
}

/**
 * Sample a (home, away) score from the distribution using inverse CDF.
 * Migrated from ProbabilityHelper.SampleScore
 */
export function sampleScore(dist: ScorelineDistribution, rng: () => number): { home: number; away: number } {
  const roll = rng();
  let cumulative = 0;
  for (let h = 0; h <= dist.maxGoals; h++) {
    for (let a = 0; a <= dist.maxGoals; a++) {
      cumulative += dist.matrix[h][a];
      if (roll <= cumulative) return { home: h, away: a };
    }
  }
  return mostLikelyScore(dist);
}

// ---------------------------------------------------------------------------
// Scoring metrics
// Migrated from ProbabilityHelper.BrierScore / RPS / LogLoss
// ---------------------------------------------------------------------------

export function brierScore(p: OutcomeProbabilities, actual: 'Home' | 'Draw' | 'Away'): number {
  const h = actual === 'Home' ? 1 : 0;
  const d = actual === 'Draw' ? 1 : 0;
  const a = actual === 'Away' ? 1 : 0;
  return Math.pow(p.homeWin - h, 2) + Math.pow(p.draw - d, 2) + Math.pow(p.awayWin - a, 2);
}

export function rankedProbabilityScore(p: OutcomeProbabilities, actual: 'Home' | 'Draw' | 'Away'): number {
  const o1 = actual === 'Home' ? 1 : 0;
  const o2 = actual === 'Home' || actual === 'Draw' ? 1 : 0;
  const p1 = p.homeWin;
  const p2 = p.homeWin + p.draw;
  return (Math.pow(p1 - o1, 2) + Math.pow(p2 - o2, 2)) / 2.0;
}

export function logLoss(p: OutcomeProbabilities, actual: 'Home' | 'Draw' | 'Away'): number {
  const prob = actual === 'Home' ? p.homeWin : actual === 'Draw' ? p.draw : p.awayWin;
  return -Math.log(Math.max(0.001, Math.min(0.999, prob)));
}

// Argmax alone suppresses draws: e.g. home=0.32 draw=0.28 away=0.40 picks Away
// even though draw is competitive. The margin closes that gap.
// 0.03 (was 0.04): grid search on 178 WC 2026 evals shows t=0.03 gives same draw
// recall as 0.04 (6.3%) but fewer false-positive draw predictions → higher global acc.
export const DRAW_MARGIN_THRESHOLD = 0.03;

export function topPick(
  p: OutcomeProbabilities,
  drawMarginThreshold = DRAW_MARGIN_THRESHOLD,
): 'Home' | 'Draw' | 'Away' {
  const best = Math.max(p.homeWin, p.awayWin);
  if (best - p.draw < drawMarginThreshold) return 'Draw';
  if (p.homeWin >= p.awayWin) return 'Home';
  return 'Away';
}

// Updated from historical WC avg (27% draw) to WC 2026 group stage actuals (~35% draw).
const WC_GROUP_PRIOR: OutcomeProbabilities = { homeWin: 0.40, draw: 0.34, awayWin: 0.26 };
const CALIBRATION_BLEND = 0.18;

export function applyDrawCalibration(p: OutcomeProbabilities): OutcomeProbabilities {
  const sw = 1 - CALIBRATION_BLEND;
  return normalizeOutcome({
    homeWin: p.homeWin * sw + WC_GROUP_PRIOR.homeWin * CALIBRATION_BLEND,
    draw:    p.draw    * sw + WC_GROUP_PRIOR.draw    * CALIBRATION_BLEND,
    awayWin: p.awayWin * sw + WC_GROUP_PRIOR.awayWin * CALIBRATION_BLEND,
  });
}
