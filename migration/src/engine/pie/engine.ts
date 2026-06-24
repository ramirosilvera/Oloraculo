// =============================================================================
// PIE — Prode Intelligence Engine (competition model, 1 000 000 players)
//
// 100 000 virtual players compete across played WC matches.
// Ranking: composite = exactCorrect×3 + correct×1 + upsetCorrect×1.5
// Prediction = consensus of top-K players (K = max(25, floor(M×1.25))), adaptive
// to tournament progress — grows from 25 early-game to ~75 by end of groups.
// Reduced upset weight vs earlier iterations keeps EQUILIBRADO dominant in the elite pool.
//
// Architecture:
//   buildPIETrackRecords  — O(N×M), memoized once per wcResults change (~300 ms)
//   computePIEFromRecords — O(2N) per fixture, memoized per expansion (~20 ms)
//   computePIEScore       — backward-compat wrapper for recompute-evaluations
// =============================================================================

import type { PIELeaderEntry, PIEResult, PIETrackRecords, ArchetypeId } from '../../types/pie';
import {
  N, FAV_SKEW, DRAW_SKEW, NOISE_LEVEL, ARCHETYPE, ARCHETYPE_IDS,
} from './players';
import type { Fixture, WcActualResult } from '../../types/domain';

// ---------------------------------------------------------------------------
// Score pools — archetype-specific
// ---------------------------------------------------------------------------

type ScoreEntry = { home: number; away: number; w: number };

const POOL_HOME_EQ: ScoreEntry[] = [
  { home: 1, away: 0, w: 34 }, { home: 2, away: 0, w: 22 },
  { home: 2, away: 1, w: 20 }, { home: 3, away: 0, w:  8 },
  { home: 3, away: 1, w:  7 }, { home: 4, away: 0, w:  3 },
  { home: 3, away: 2, w:  4 }, { home: 4, away: 1, w:  2 },
];
const POOL_DRAW_EQ: ScoreEntry[] = [
  { home: 1, away: 1, w: 55 }, { home: 0, away: 0, w: 35 },
  { home: 2, away: 2, w:  8 }, { home: 3, away: 3, w:  2 },
];
const POOL_AWAY_EQ: ScoreEntry[] = [
  { home: 0, away: 1, w: 34 }, { home: 0, away: 2, w: 22 },
  { home: 1, away: 2, w: 20 }, { home: 0, away: 3, w:  8 },
  { home: 1, away: 3, w:  7 }, { home: 0, away: 4, w:  3 },
  { home: 2, away: 3, w:  4 }, { home: 1, away: 4, w:  2 },
];
const POOL_HOME_FAV: ScoreEntry[] = [
  { home: 1, away: 0, w: 28 }, { home: 2, away: 0, w: 24 },
  { home: 2, away: 1, w: 16 }, { home: 3, away: 0, w: 16 },
  { home: 3, away: 1, w: 12 }, { home: 4, away: 0, w:  4 },
];
const POOL_DRAW_FAV: ScoreEntry[] = [
  { home: 1, away: 1, w: 70 }, { home: 0, away: 0, w: 20 }, { home: 2, away: 2, w: 10 },
];
const POOL_AWAY_FAV: ScoreEntry[] = [
  { home: 0, away: 1, w: 28 }, { home: 0, away: 2, w: 24 },
  { home: 1, away: 2, w: 16 }, { home: 0, away: 3, w: 16 },
  { home: 1, away: 3, w: 12 }, { home: 0, away: 4, w:  4 },
];
const POOL_HOME_SOR: ScoreEntry[] = [
  { home: 1, away: 0, w: 50 }, { home: 2, away: 1, w: 30 },
  { home: 3, away: 2, w: 12 }, { home: 2, away: 0, w:  8 },
];
const POOL_DRAW_SOR: ScoreEntry[] = [
  { home: 0, away: 0, w: 50 }, { home: 1, away: 1, w: 35 }, { home: 2, away: 2, w: 15 },
];
const POOL_AWAY_SOR: ScoreEntry[] = [
  { home: 0, away: 1, w: 50 }, { home: 1, away: 2, w: 30 },
  { home: 2, away: 3, w: 12 }, { home: 0, away: 2, w:  8 },
];
const POOL_HOME_EMP: ScoreEntry[] = [
  { home: 2, away: 1, w: 40 }, { home: 1, away: 0, w: 35 },
  { home: 3, away: 2, w: 15 }, { home: 2, away: 0, w: 10 },
];
const POOL_DRAW_EMP: ScoreEntry[] = [
  { home: 0, away: 0, w: 48 }, { home: 1, away: 1, w: 38 },
  { home: 2, away: 2, w: 12 }, { home: 3, away: 3, w:  2 },
];
const POOL_AWAY_EMP: ScoreEntry[] = [
  { home: 1, away: 2, w: 40 }, { home: 0, away: 1, w: 35 },
  { home: 2, away: 3, w: 15 }, { home: 0, away: 2, w: 10 },
];
const POOL_HOME_CAO: ScoreEntry[] = [
  { home: 1, away: 0, w: 10 }, { home: 2, away: 0, w: 10 }, { home: 2, away: 1, w: 10 },
  { home: 3, away: 0, w:  9 }, { home: 3, away: 1, w:  9 }, { home: 3, away: 2, w:  9 },
  { home: 4, away: 0, w:  8 }, { home: 4, away: 1, w:  8 }, { home: 4, away: 2, w:  7 },
  { home: 5, away: 1, w:  7 }, { home: 5, away: 2, w:  6 }, { home: 6, away: 1, w:  4 },
  { home: 7, away: 0, w:  3 },
];
const POOL_DRAW_CAO: ScoreEntry[] = [
  { home: 0, away: 0, w: 25 }, { home: 1, away: 1, w: 28 }, { home: 2, away: 2, w: 22 },
  { home: 3, away: 3, w: 15 }, { home: 4, away: 4, w:  7 }, { home: 5, away: 5, w:  3 },
];
const POOL_AWAY_CAO: ScoreEntry[] = [
  { home: 0, away: 1, w: 10 }, { home: 0, away: 2, w: 10 }, { home: 1, away: 2, w: 10 },
  { home: 0, away: 3, w:  9 }, { home: 1, away: 3, w:  9 }, { home: 2, away: 3, w:  9 },
  { home: 0, away: 4, w:  8 }, { home: 1, away: 4, w:  8 }, { home: 2, away: 4, w:  7 },
  { home: 1, away: 5, w:  7 }, { home: 2, away: 5, w:  6 }, { home: 1, away: 6, w:  4 },
  { home: 0, away: 7, w:  3 },
];

type PoolWithTotal = { entries: ScoreEntry[]; total: number };
function buildPool(entries: ScoreEntry[]): PoolWithTotal {
  return { entries, total: entries.reduce((s, e) => s + e.w, 0) };
}

// Indexed by archetype number 0-4 for O(1) lookup without string key
const ARC_HOME_POOLS: PoolWithTotal[] = [
  buildPool(POOL_HOME_FAV), // 0 FAVORITO
  buildPool(POOL_HOME_SOR), // 1 SORPRESA
  buildPool(POOL_HOME_EMP), // 2 EMPATE
  buildPool(POOL_HOME_EQ),  // 3 EQUILIBRADO
  buildPool(POOL_HOME_CAO), // 4 CAOTICO
];
const ARC_DRAW_POOLS: PoolWithTotal[] = [
  buildPool(POOL_DRAW_FAV),
  buildPool(POOL_DRAW_SOR),
  buildPool(POOL_DRAW_EMP),
  buildPool(POOL_DRAW_EQ),
  buildPool(POOL_DRAW_CAO),
];
const ARC_AWAY_POOLS: PoolWithTotal[] = [
  buildPool(POOL_AWAY_FAV),
  buildPool(POOL_AWAY_SOR),
  buildPool(POOL_AWAY_EMP),
  buildPool(POOL_AWAY_EQ),
  buildPool(POOL_AWAY_CAO),
];

// ---------------------------------------------------------------------------
// Fast integer RNG
// ---------------------------------------------------------------------------

function fnv1aInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// salt 0 = pick, salt 1 = score
function fastRng(playerIdx: number, fixHash: number, salt: number): number {
  let h = (Math.imul(playerIdx + 1, 2654435761) ^ fixHash ^ Math.imul(salt, 2246822519)) >>> 0;
  h ^= h >>> 13;
  h = (h * 0x5a4bcfb1) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function wSamplePool(pool: PoolWithTotal, rng: number): ScoreEntry {
  let r = rng * pool.total;
  for (const item of pool.entries) {
    r -= item.w;
    if (r <= 0) return item;
  }
  return pool.entries[pool.entries.length - 1];
}

// ---------------------------------------------------------------------------
// Poisson score model (industry standard for football betting)
// ---------------------------------------------------------------------------

// P(k goals; lambda) via log-space to avoid underflow
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda / i);
  return Math.exp(logP);
}

// Dixon-Coles low-score correction (1997): 0-0, 1-0, 0-1, 1-1 are more/less
// frequent than pure Poisson predicts. rho ≈ -0.13 is empirically calibrated.
function dixonColesCorr(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// Most likely exact score consistent with the given outcome direction.
// Uses independent Poisson goal models with Dixon-Coles low-score correction.
// lambdaHome/Away derived from Elo win probabilities.
function poissonConstrainedMode(
  lambdaHome: number,
  lambdaAway: number,
  direction: 'Home' | 'Draw' | 'Away',
): { home: number; away: number } {
  const RHO = -0.13; // Dixon-Coles empirical parameter
  let bestH = 0, bestA = 0, bestProb = -1;
  for (let h = 0; h <= 6; h++) {
    const ph = poissonPMF(h, lambdaHome);
    if (ph < 1e-7) continue;
    for (let a = 0; a <= 6; a++) {
      const compatible = direction === 'Home' ? h > a : direction === 'Away' ? a > h : h === a;
      if (!compatible) continue;
      const pa = poissonPMF(a, lambdaAway);
      const corr = dixonColesCorr(h, a, lambdaHome, lambdaAway, RHO);
      const prob = ph * pa * corr;
      if (prob > bestProb) { bestProb = prob; bestH = h; bestA = a; }
    }
  }
  return { home: bestH, away: bestA };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wcFormBonus(
  teamId: string,
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
): number {
  const playedMap = new Map(wcResults.map(r => [r.fixture_id, r]));
  let bonus = 0;
  for (const f of allFixtures) {
    const r = playedMap.get(f.id);
    if (!r) continue;
    const isHome = f.home_team_id === teamId;
    const isAway = f.away_team_id === teamId;
    if (!isHome && !isAway) continue;
    const gf = isHome ? r.home_goals : r.away_goals;
    const ga = isHome ? r.away_goals : r.home_goals;
    if      (gf > ga)   bonus += 25;
    else if (gf === ga) bonus += 5;
    else                bonus -= 15;
  }
  return bonus;
}

function eloBasedPrior(
  homeElo: number,
  awayElo: number,
): { home: number; draw: number; away: number } {
  const diff = homeElo - awayElo;
  const homeWinRaw = 1 / (1 + Math.pow(10, -diff / 400));
  const drawBase = 0.26 - 0.15 * Math.abs(diff / 400);
  const draw = Math.max(0.10, Math.min(0.35, drawBase));
  const rem = 1 - draw;
  return { home: homeWinRaw * rem, draw, away: (1 - homeWinRaw) * rem };
}

// ---------------------------------------------------------------------------
// Module-level pick buffer (reused — JS is single-threaded)
// ---------------------------------------------------------------------------
const _picks = new Uint8Array(N); // 0=Home 1=Draw 2=Away

// ---------------------------------------------------------------------------
// buildPIETrackRecords — expensive O(N×M), called once per wcResults change
// ---------------------------------------------------------------------------

export function buildPIETrackRecords(
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
  eloByFixture: Map<string, { home: number; away: number }>,
): PIETrackRecords {
  const correct = new Int32Array(N);
  const exact   = new Float32Array(N); // soft counting: pool probability, not a random sample
  const total   = new Int32Array(N);
  const upset   = new Int32Array(N);

  const fixtureById = new Map(allFixtures.map(f => [f.id, f]));

  // Cache form bonuses per team (wcFormBonus is O(allFixtures) per call)
  const formCache = new Map<string, number>();
  const cachedForm = (teamId: string) => {
    if (!formCache.has(teamId)) formCache.set(teamId, wcFormBonus(teamId, allFixtures, wcResults));
    return formCache.get(teamId)!;
  };

  for (const r of wcResults) {
    const fixture = fixtureById.get(r.fixture_id);
    if (!fixture) continue;
    const elos = eloByFixture.get(r.fixture_id);
    if (!elos || elos.home === 0 || elos.away === 0) continue;

    const prior = eloBasedPrior(
      elos.home + cachedForm(fixture.home_team_id),
      elos.away + cachedForm(fixture.away_team_id),
    );

    // Encode actual as number to avoid per-player string comparison
    const actual: 0 | 1 | 2 =
      r.home_goals > r.away_goals ? 0 : r.home_goals === r.away_goals ? 1 : 2;

    const isUpset =
      (actual === 2 && prior.home > prior.away + 0.10) ||
      (actual === 0 && prior.away > prior.home + 0.10);

    const fixHash = fnv1aInt(r.fixture_id);
    const pH = prior.home, pD = prior.draw, pA = prior.away;
    const hg = r.home_goals, ag = r.away_goals;
    // In a neutral-venue tournament the Elo-favored team may be listed as home or away.
    // favIsHome=true means the stronger team (by Elo prior) is in the home slot.
    const favIsHome = pH >= pA;

    for (let i = 0; i < N; i++) {
      const fs = FAV_SKEW[i], ds = DRAW_SKEW[i], nl = NOISE_LEVEL[i];
      // Apply FAV_SKEW toward the stronger team, regardless of home/away position
      const hs = favIsHome ? fs : -fs;

      let h = pH + hs; if (h < 0.02) h = 0.02;
      let d = pD + ds; if (d < 0.02) d = 0.02;
      let a = pA - hs - ds; if (a < 0.02) a = 0.02;
      const inv = 1 / (h + d + a);
      h *= inv; d *= inv;
      const nlc = 1 - nl, u = 0.33333333;
      h = h * nlc + u * nl;
      d = d * nlc + u * nl;

      const rng1 = fastRng(i, fixHash, 0);
      const pick: 0 | 1 | 2 = rng1 < h ? 0 : rng1 < h + d ? 1 : 2;

      total[i]++;
      if (pick === actual) {
        correct[i]++;
        if (isUpset) upset[i]++;
        // Soft counting: add the pool probability of the actual score (no random sample).
        // Deterministic ranking — players whose archetype pools align with real scores rank higher.
        const arc = ARCHETYPE[i];
        const sPool = pick === 0 ? ARC_HOME_POOLS[arc] : pick === 2 ? ARC_AWAY_POOLS[arc] : ARC_DRAW_POOLS[arc];
        for (const e of sPool.entries) {
          if (e.home === hg && e.away === ag) { exact[i] += e.w / sPool.total; break; }
        }
      }
    }
  }

  return { correct, exact, total, upset };
}

// ---------------------------------------------------------------------------
// computePIEFromRecords — O(2N) per fixture
// ---------------------------------------------------------------------------

export function computePIEFromRecords(
  fixture: Fixture,
  homeElo: number,
  awayElo: number,
  wcResults: WcActualResult[],
  allFixtures: Fixture[],
  records: PIETrackRecords,
): PIEResult {
  if (!fixture || homeElo <= 0 || awayElo <= 0) return degradedResult(fixture?.id ?? '');

  const { correct, exact, total, upset } = records;

  // Cache form bonuses for this fixture's teams
  const formCache = new Map<string, number>();
  const cachedForm = (teamId: string) => {
    if (!formCache.has(teamId)) formCache.set(teamId, wcFormBonus(teamId, allFixtures, wcResults));
    return formCache.get(teamId)!;
  };
  const prior = eloBasedPrior(
    homeElo + cachedForm(fixture.home_team_id),
    awayElo + cachedForm(fixture.away_team_id),
  );
  const fixHash = fnv1aInt(fixture.id);
  const pH = prior.home, pD = prior.draw, pA = prior.away;
  // Neutral venue: resolve which slot holds the Elo-favored team once per fixture
  const favIsHome = pH >= pA;

  // Composite-score histogram: bins ×2 so 0.5 step is integer-safe (max ~360)
  const HIST_MAX = 400;
  const hist = new Int32Array(HIST_MAX + 1);

  let crowdH = 0, crowdD = 0, crowdA = 0;

  // Archetype totals for accuracy breakdown
  const arcCorr  = new Float64Array(5);
  const arcTotal = new Float64Array(5);

  // Adaptive K: grows with tournament progress (1.25 matches per player, min 25)
  const K = Math.max(25, Math.floor(wcResults.length * 1.25));
  // Top-K tracking (descending composite)
  const topIdx   = new Int32Array(K).fill(-1);
  const topComp  = new Float64Array(K).fill(-Infinity);
  let topMin = -Infinity, topMinPos = 0, topFilled = 0;

  // === First O(N) pass: picks + crowd + histogram + top-K ===
  for (let i = 0; i < N; i++) {
    const comp = exact[i] * 3 + correct[i] + upset[i] * 1.5;

    // Histogram bucket
    const bin = comp * 2 > HIST_MAX ? HIST_MAX : (comp * 2 + 0.5) | 0;
    hist[bin]++;

    // Top-K update
    if (topFilled < K) {
      topIdx[topFilled] = i;
      topComp[topFilled] = comp;
      topFilled++;
      if (topFilled === K) {
        topMin = Infinity;
        for (let k = 0; k < K; k++) {
          if (topComp[k] < topMin) { topMin = topComp[k]; topMinPos = k; }
        }
      }
    } else if (comp > topMin) {
      topIdx[topMinPos] = i;
      topComp[topMinPos] = comp;
      topMin = Infinity;
      for (let k = 0; k < K; k++) {
        if (topComp[k] < topMin) { topMin = topComp[k]; topMinPos = k; }
      }
    }

    // Player pick — FAV_SKEW applied toward the Elo-stronger team
    const fs = FAV_SKEW[i], ds = DRAW_SKEW[i], nl = NOISE_LEVEL[i];
    const hs = favIsHome ? fs : -fs;
    let h = pH + hs; if (h < 0.02) h = 0.02;
    let d = pD + ds; if (d < 0.02) d = 0.02;
    let a = pA - hs - ds; if (a < 0.02) a = 0.02;
    const inv = 1 / (h + d + a);
    h *= inv; d *= inv;
    const nlc = 1 - nl, u = 0.33333333;
    h = h * nlc + u * nl;
    d = d * nlc + u * nl;

    const rng1 = fastRng(i, fixHash, 0);
    const p: number = rng1 < h ? 0 : rng1 < h + d ? 1 : 2;
    _picks[i] = p;
    if (p === 0) crowdH++;
    else if (p === 1) crowdD++;
    else crowdA++;

    // Archetype stats
    const arc = ARCHETYPE[i];
    arcCorr[arc]  += correct[i];
    arcTotal[arc] += total[i];
  }

  // Sort top-K descending by composite (insertion sort, K=50 — ~1 250 ops, negligible)
  for (let j = 1; j < K; j++) {
    const ci = topComp[j], ii = topIdx[j];
    let k = j - 1;
    while (k >= 0 && topComp[k] < ci) {
      topComp[k + 1] = topComp[k]; topIdx[k + 1] = topIdx[k]; k--;
    }
    topComp[k + 1] = ci; topIdx[k + 1] = ii;
  }

  const n = N;
  const pCH = crowdH / n, pCD = crowdD / n, pCA = crowdA / n;

  // === Weighted consensus from top-K ===
  // Probabilities: weighted average of per-player models → reliable direction signal.
  // Score: single deterministic sample from the best agreeing player's archetype pool.
  // Using one player's sample (not pool average) gives variety across fixtures — the same
  // player predicts 1-0 for one match, 2-1 for another, 3-0 for another, because
  // fastRng is seeded by fixture ID as well as player index.
  let sumK = 0, cKH = 0, cKD = 0, cKA = 0;
  for (let k = 0; k < K && topIdx[k] !== -1; k++) {
    const i = topIdx[k];
    const w = Math.max(topComp[k], 0.1);
    sumK += w;

    // Recompute this player's model probabilities for the current fixture
    const fs = FAV_SKEW[i], ds = DRAW_SKEW[i], nl = NOISE_LEVEL[i];
    const hs = favIsHome ? fs : -fs;
    let kh = pH + hs; if (kh < 0.02) kh = 0.02;
    let kd = pD + ds; if (kd < 0.02) kd = 0.02;
    let ka = pA - hs - ds; if (ka < 0.02) ka = 0.02;
    const kinv = 1 / (kh + kd + ka);
    kh *= kinv; kd *= kinv; ka = 1 - kh - kd;
    const knlc = 1 - nl, uu = 0.33333333;
    kh = kh * knlc + uu * nl;
    kd = kd * knlc + uu * nl;
    ka = 1 - kh - kd;

    cKH += w * kh; cKD += w * kd; cKA += w * ka;
  }
  const invK = sumK > 0 ? 1 / sumK : 1;
  const pKH = cKH * invK, pKD = cKD * invK, pKA = cKA * invK;

  const consensus_pick: 'Home' | 'Draw' | 'Away' =
    pKH >= pKD && pKH >= pKA ? 'Home' : pKA >= pKH && pKA >= pKD ? 'Away' : 'Draw';

  // Poisson + Dixon-Coles score prediction.
  // Convert Elo win probabilities to per-team expected goals (lambdas), then find the
  // most likely exact score consistent with the consensus direction.
  // Formula: λ_home = base + strength_diff_factor (clamped to [0.35, 3.5]).
  // Dixon-Coles correction adjusts the probability of low-score outcomes (0-0, 1-0, 0-1,
  // 1-1) which are more common in football than pure Poisson predicts.
  const consensusPickCode = consensus_pick === 'Home' ? 0 : consensus_pick === 'Draw' ? 1 : 2;
  const homeForm = cachedForm(fixture.home_team_id);
  const awayForm = cachedForm(fixture.away_team_id);
  const formAdj = (homeForm - awayForm) / 2500;
  const pDiff = pH - pA;
  // Base lambdas — asymmetric scaling so λa drops slowly with pDiff.
  // This keeps λa > 1 for moderate favorites, letting 2-1 beat 2-0 when
  // the losing team is expected to score (historically 2-1 17.8% > 2-0 14.1%).
  // λh grows faster than λa shrinks → goal gap widens without killing loser goals.
  // Total at equal teams: 2.2 base → ~2.4 after player-noise boost (near WC avg 2.5).
  // λa = 1 crossover at pDiff ≈ 0.29 → moderate favs get 2-1, strong favs get 2-0.
  const base_λh = Math.max(0.35, Math.min(4.0, 1.1 + pDiff * 1.4 + formAdj));
  const base_λa = Math.max(0.35, Math.min(4.0, 1.1 - pDiff * 0.35 - formAdj));
  let sumLH = 0, sumLA = 0, sumLW = 0;
  for (let k = 0; k < K && topIdx[k] !== -1; k++) {
    const i = topIdx[k];
    const w = Math.max(topComp[k], 0.1);
    const fs = FAV_SKEW[i], ds = DRAW_SKEW[i], nl = NOISE_LEVEL[i];
    const hs = favIsHome ? fs : -fs;
    const adj_λh = Math.max(0.35, base_λh * (1 + hs * 1.0 - ds * 0.5) * (1 + nl * 0.30));
    const adj_λa = Math.max(0.35, base_λa * (1 - hs * 1.0 + ds * 0.5) * (1 + nl * 0.30));
    sumLH += w * adj_λh;
    sumLA += w * adj_λa;
    sumLW += w;
  }
  const invLW = sumLW > 0 ? 1 / sumLW : 1;
  const consensusScore = poissonConstrainedMode(
    Math.max(0.35, sumLH * invLW),
    Math.max(0.35, sumLA * invLW),
    consensus_pick,
  );

  // === Find elite threshold via histogram (top 10%) ===
  const eliteTarget = Math.max(10, Math.floor(n * 0.10));
  let accumulated = 0;
  let eliteThresholdBin = 0;
  for (let b = HIST_MAX; b >= 0; b--) {
    accumulated += hist[b];
    if (accumulated >= eliteTarget) { eliteThresholdBin = b; break; }
  }
  const eliteThreshold = eliteThresholdBin / 2;

  // === Second O(N) pass: elite picks ===
  let eliteH = 0, eliteD = 0, eliteA = 0, eliteN = 0;
  for (let i = 0; i < N; i++) {
    if (exact[i] * 3 + correct[i] + upset[i] * 1.5 < eliteThreshold) continue;
    const p = _picks[i];
    if (p === 0) eliteH++;
    else if (p === 1) eliteD++;
    else eliteA++;
    eliteN++;
  }
  const eN = eliteN || 1;
  const pEH = eliteH / eN, pED = eliteD / eN, pEA = eliteA / eN;

  // === Build leaderboard (top 5 with score samples) ===
  const leaderboard: PIELeaderEntry[] = [];
  for (let k = 0; k < Math.min(K, 5) && topIdx[k] !== -1; k++) {
    const i = topIdx[k];
    const pickCode = _picks[i];
    const pick: 'Home' | 'Draw' | 'Away' =
      pickCode === 0 ? 'Home' : pickCode === 1 ? 'Draw' : 'Away';
    const arc = ARCHETYPE[i];
    const sPool = pickCode === 0 ? ARC_HOME_POOLS[arc] : pickCode === 2 ? ARC_AWAY_POOLS[arc] : ARC_DRAW_POOLS[arc];
    const s = wSamplePool(sPool, fastRng(i, fixHash, 1));
    leaderboard.push({
      id: `pie-${i}`,
      rank: k + 1,
      archetype: ARCHETYPE_IDS[arc],
      correct: correct[i],
      exactCorrect: exact[i],
      total: total[i],
      upsetCorrect: upset[i],
      pick,
      pickScore: { home: s.home, away: s.away },
    });
  }

  if (leaderboard.length === 0) return degradedResult(fixture.id);

  const leader = leaderboard[0];

  // leader_support: fraction of the full top-K that agree with the consensus pick
  let supportCount = 0, validTop = 0;
  for (let k = 0; k < K && topIdx[k] !== -1; k++) {
    validTop++;
    if (_picks[topIdx[k]] === consensusPickCode) supportCount++;
  }
  const leader_support = validTop > 0 ? supportCount / validTop : 0;

  // Contrarian signal
  const crowdModal: 'Home' | 'Draw' | 'Away' =
    pCH >= pCD && pCH >= pCA ? 'Home' : pCA >= pCH && pCA >= pCD ? 'Away' : 'Draw';
  const contrarian_signal =
    leader.pick !== crowdModal ? 1 - Math.max(pCH, pCD, pCA) : 0;

  const elite_pick: 'Home' | 'Draw' | 'Away' =
    pEH >= pED && pEH >= pEA ? 'Home' : pEA >= pEH && pEA >= pED ? 'Away' : 'Draw';

  // Archetype avg accuracy
  const archetype_avg_reps = {} as Record<ArchetypeId, number>;
  for (let a = 0; a < 5; a++) {
    archetype_avg_reps[ARCHETYPE_IDS[a]] = arcTotal[a] > 0 ? arcCorr[a] / arcTotal[a] : 0;
  }

  const confidence = Math.max(pKH, pKD, pKA);

  // dominant_archetype: most common archetype among top-10
  const arcCount = new Int32Array(5);
  for (let k = 0; k < 10 && topIdx[k] !== -1; k++) arcCount[ARCHETYPE[topIdx[k]]]++;
  let domArc = 0;
  for (let a = 1; a < 5; a++) if (arcCount[a] > arcCount[domArc]) domArc = a;

  return {
    fixture_id: fixture.id,
    most_probable_pick: consensus_pick,
    mostLikelyScore: consensusScore,
    leader,
    leader_support,
    pick_probabilities: { home: pKH, draw: pKD, away: pKA },
    elite_probabilities: { home: pEH, draw: pED, away: pEA },
    elite_pick,
    contrarian_signal,
    dominant_archetype: ARCHETYPE_IDS[domArc],
    archetype_avg_reps,
    leaderboard,
    confidence,
    sample_size: n,
    degraded: false,
    consensus_k: K,
  };
}

// ---------------------------------------------------------------------------
// degradedResult helper
// ---------------------------------------------------------------------------

function degradedResult(fixture_id: string): PIEResult {
  const u = 1 / 3;
  const p = { home: u, draw: u, away: u };
  return {
    fixture_id,
    most_probable_pick: 'Home',
    mostLikelyScore: null,
    leader: null,
    leader_support: 0,
    pick_probabilities: p,
    elite_probabilities: p,
    elite_pick: 'Home',
    contrarian_signal: 0,
    dominant_archetype: null,
    archetype_avg_reps: { FAVORITO: 0, SORPRESA: 0, EMPATE: 0, EQUILIBRADO: 0, CAOTICO: 0 },
    leaderboard: [],
    confidence: u,
    sample_size: 0,
    degraded: true,
    consensus_k: 25,
  };
}

// ---------------------------------------------------------------------------
// PIEInput / computePIEScore — backward-compat wrapper
// ---------------------------------------------------------------------------

export interface PIEInput {
  fixture: Fixture;
  homeElo: number;
  awayElo: number;
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  eloByFixture?: Map<string, { home: number; away: number }>;
}

export function computePIEScore(input: PIEInput): PIEResult {
  const { fixture, homeElo, awayElo, allFixtures, wcResults, eloByFixture } = input;
  const eloMap = new Map<string, { home: number; away: number }>(
    wcResults.map(r => [r.fixture_id, eloByFixture?.get(r.fixture_id) ?? { home: 0, away: 0 }])
  );
  const records = buildPIETrackRecords(allFixtures, wcResults, eloMap);
  return computePIEFromRecords(fixture, homeElo, awayElo, wcResults, allFixtures, records);
}
