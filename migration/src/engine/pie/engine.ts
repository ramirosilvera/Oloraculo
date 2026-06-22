// =============================================================================
// PIE — Prode Intelligence Engine
//
// 500 virtual players each with a personality profile pick every match
// deterministically (seeded by player.id + fixture_id).
// Reputation (Bayesian accuracy estimate) weights each player's vote.
// The engine outputs: crowd consensus, elite consensus (top 10% by rep),
// dominant archetype, and a contrarian signal when elites diverge from crowd.
// =============================================================================

import type { PIEPlayer, PIEPlayerPick, PIEResult, ArchetypeId } from '../../types/pie';
import { PIE_PLAYERS } from './players';
import type { Fixture, WcActualResult } from '../../types/domain';

// ---------------------------------------------------------------------------
// Score pools — archetype-specific distributions
// Each archetype expresses a different "vision" of how goals are scored.
// ---------------------------------------------------------------------------

type ScoreEntry = { home: number; away: number; w: number };

// EQUILIBRADO — historical WC 2006-2022 baseline frequencies
const POOL_HOME_EQ: ScoreEntry[] = [
  { home: 1, away: 0, w: 34 },
  { home: 2, away: 0, w: 22 },
  { home: 2, away: 1, w: 20 },
  { home: 3, away: 0, w:  8 },
  { home: 3, away: 1, w:  7 },
  { home: 4, away: 0, w:  3 },
  { home: 3, away: 2, w:  4 },
  { home: 4, away: 1, w:  2 },
];
const POOL_DRAW_EQ: ScoreEntry[] = [
  { home: 1, away: 1, w: 55 },
  { home: 0, away: 0, w: 35 },
  { home: 2, away: 2, w:  8 },
  { home: 3, away: 3, w:  2 },
];
const POOL_AWAY_EQ: ScoreEntry[] = [
  { home: 0, away: 1, w: 34 },
  { home: 0, away: 2, w: 22 },
  { home: 1, away: 2, w: 20 },
  { home: 0, away: 3, w:  8 },
  { home: 1, away: 3, w:  7 },
  { home: 0, away: 4, w:  3 },
  { home: 2, away: 3, w:  4 },
  { home: 1, away: 4, w:  2 },
];

// FAVORITO — expects dominant wins, heavier on 2-0, 3-0, 3-1
const POOL_HOME_FAV: ScoreEntry[] = [
  { home: 1, away: 0, w: 18 },
  { home: 2, away: 0, w: 32 },
  { home: 2, away: 1, w: 15 },
  { home: 3, away: 0, w: 18 },
  { home: 3, away: 1, w: 12 },
  { home: 4, away: 0, w:  3 },
  { home: 4, away: 1, w:  2 },
];
const POOL_DRAW_FAV: ScoreEntry[] = [
  { home: 1, away: 1, w: 70 },
  { home: 0, away: 0, w: 20 },
  { home: 2, away: 2, w: 10 },
];
const POOL_AWAY_FAV: ScoreEntry[] = [
  { home: 0, away: 1, w: 18 },
  { home: 0, away: 2, w: 32 },
  { home: 1, away: 2, w: 15 },
  { home: 0, away: 3, w: 18 },
  { home: 1, away: 3, w: 12 },
  { home: 0, away: 4, w:  3 },
  { home: 1, away: 4, w:  2 },
];

// SORPRESA — narrow margins, unexpected scores, tight games
const POOL_HOME_SOR: ScoreEntry[] = [
  { home: 1, away: 0, w: 50 },
  { home: 2, away: 1, w: 30 },
  { home: 3, away: 2, w: 12 },
  { home: 2, away: 0, w:  8 },
];
const POOL_DRAW_SOR: ScoreEntry[] = [
  { home: 0, away: 0, w: 50 },
  { home: 1, away: 1, w: 35 },
  { home: 2, away: 2, w: 15 },
];
const POOL_AWAY_SOR: ScoreEntry[] = [
  { home: 0, away: 1, w: 50 },
  { home: 1, away: 2, w: 30 },
  { home: 2, away: 3, w: 12 },
  { home: 0, away: 2, w:  8 },
];

// EMPATE — expects draws, close scores
const POOL_HOME_EMP: ScoreEntry[] = [
  { home: 1, away: 0, w: 40 },
  { home: 2, away: 1, w: 35 },
  { home: 3, away: 2, w: 15 },
  { home: 2, away: 0, w: 10 },
];
const POOL_DRAW_EMP: ScoreEntry[] = [
  { home: 0, away: 0, w: 48 },
  { home: 1, away: 1, w: 36 },
  { home: 2, away: 2, w: 13 },
  { home: 3, away: 3, w:  3 },
];
const POOL_AWAY_EMP: ScoreEntry[] = [
  { home: 0, away: 1, w: 40 },
  { home: 1, away: 2, w: 35 },
  { home: 2, away: 3, w: 15 },
  { home: 0, away: 2, w: 10 },
];

// CAOTICO — flat distribution, high variance, exotic scores included
const POOL_HOME_CAO: ScoreEntry[] = [
  { home: 1, away: 0, w: 14 },
  { home: 2, away: 0, w: 12 },
  { home: 2, away: 1, w: 12 },
  { home: 3, away: 0, w: 10 },
  { home: 3, away: 1, w: 10 },
  { home: 3, away: 2, w: 10 },
  { home: 4, away: 0, w:  8 },
  { home: 4, away: 1, w:  8 },
  { home: 4, away: 2, w:  6 },
  { home: 5, away: 1, w:  5 },
  { home: 5, away: 2, w:  3 },
  { home: 6, away: 1, w:  2 },
];
const POOL_DRAW_CAO: ScoreEntry[] = [
  { home: 0, away: 0, w: 28 },
  { home: 1, away: 1, w: 30 },
  { home: 2, away: 2, w: 22 },
  { home: 3, away: 3, w: 12 },
  { home: 4, away: 4, w:  8 },
];
const POOL_AWAY_CAO: ScoreEntry[] = [
  { home: 0, away: 1, w: 14 },
  { home: 0, away: 2, w: 12 },
  { home: 1, away: 2, w: 12 },
  { home: 0, away: 3, w: 10 },
  { home: 1, away: 3, w: 10 },
  { home: 2, away: 3, w: 10 },
  { home: 0, away: 4, w:  8 },
  { home: 1, away: 4, w:  8 },
  { home: 2, away: 4, w:  6 },
  { home: 1, away: 5, w:  5 },
  { home: 2, away: 5, w:  3 },
  { home: 1, away: 6, w:  2 },
];

const SCORE_POOLS: Record<ArchetypeId, { home: ScoreEntry[]; draw: ScoreEntry[]; away: ScoreEntry[] }> = {
  FAVORITO:    { home: POOL_HOME_FAV, draw: POOL_DRAW_FAV, away: POOL_AWAY_FAV },
  SORPRESA:    { home: POOL_HOME_SOR, draw: POOL_DRAW_SOR, away: POOL_AWAY_SOR },
  EMPATE:      { home: POOL_HOME_EMP, draw: POOL_DRAW_EMP, away: POOL_AWAY_EMP },
  EQUILIBRADO: { home: POOL_HOME_EQ,  draw: POOL_DRAW_EQ,  away: POOL_AWAY_EQ  },
  CAOTICO:     { home: POOL_HOME_CAO, draw: POOL_DRAW_CAO, away: POOL_AWAY_CAO },
};

// ---------------------------------------------------------------------------
// Deterministic RNG — FNV-1a hash on string seed
// ---------------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h  = (h * 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function wSample<T extends { w: number }>(pool: T[], rng: number): T {
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = rng * total;
  for (const item of pool) {
    r -= item.w;
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// WC 2026 form bonus — adjusts static Elo with in-tournament results
// +25 per win, +5 per draw, -15 per loss in WC 2026
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
    if      (gf > ga) bonus += 25;
    else if (gf === ga) bonus += 5;
    else    bonus -= 15;
  }
  return bonus;
}

// ---------------------------------------------------------------------------
// Elo-based prior (with optional WC form adjustment)
// ---------------------------------------------------------------------------

function eloBasedPrior(homeElo: number, awayElo: number): { home: number; draw: number; away: number } {
  const diff = homeElo - awayElo;
  const homeWinRaw = 1 / (1 + Math.pow(10, -diff / 400));
  const drawBase = 0.26 - 0.15 * Math.abs(diff / 400);
  const draw = Math.max(0.10, Math.min(0.35, drawBase));
  const rem = 1 - draw;
  return { home: homeWinRaw * rem, draw, away: (1 - homeWinRaw) * rem };
}

// ---------------------------------------------------------------------------
// Player pick — deterministic for given player + fixture
// Uses EQUILIBRADO pools internally (variety comes from archetype-aware final score)
// ---------------------------------------------------------------------------

function computePlayerPick(
  player: PIEPlayer,
  prior: { home: number; draw: number; away: number },
  fixtureId: string,
): PIEPlayerPick {
  const rng1 = fnv1a(`${player.id}::pick::${fixtureId}`);

  let h = Math.max(0.02, prior.home + player.homeSkew);
  let d = Math.max(0.02, prior.draw + player.drawSkew);
  let a = Math.max(0.02, prior.away - player.homeSkew - player.drawSkew);
  const tot = h + d + a;
  h /= tot; d /= tot; a /= tot;

  // Blend toward uniform (noise / gut feel)
  const u = 1 / 3;
  h = h * (1 - player.noiseLevel) + u * player.noiseLevel;
  d = d * (1 - player.noiseLevel) + u * player.noiseLevel;
  a = a * (1 - player.noiseLevel) + u * player.noiseLevel;

  const pick: 'Home' | 'Draw' | 'Away' =
    rng1 < h ? 'Home' : rng1 < h + d ? 'Draw' : 'Away';

  // Score for reputation comparison (uses player-specific seed, EQUILIBRADO pool)
  const rng2 = fnv1a(`${player.id}::score::${fixtureId}`);
  const sPool = SCORE_POOLS.EQUILIBRADO;
  const pool = pick === 'Home' ? sPool.home : pick === 'Away' ? sPool.away : sPool.draw;
  const s = wSample(pool, rng2);

  return { playerId: player.id, pick, score: { home: s.home, away: s.away }, reputation: 0 };
}

// ---------------------------------------------------------------------------
// Final score pick — single seeded draw from archetype-aware pool
// NOT aggregated across 500 players: each fixture + archetype combo gets
// exactly one draw from the pool → real variety across matches
// ---------------------------------------------------------------------------

function pickFinalScore(
  pick: 'Home' | 'Draw' | 'Away',
  dominantArchetype: ArchetypeId,
  fixtureId: string,
  contrarianSignal: number,
): { home: number; away: number } {
  // If elites strongly disagree with crowd, lean toward a surprising score
  const archetype: ArchetypeId = contrarianSignal > 0.20 ? 'SORPRESA' : dominantArchetype;
  const pools = SCORE_POOLS[archetype];
  const pool = pick === 'Home' ? pools.home : pick === 'Away' ? pools.away : pools.draw;
  const rng = fnv1a(`pie::finalscore::${archetype}::${pick}::${fixtureId}`);
  return wSample(pool, rng);
}

// ---------------------------------------------------------------------------
// Reputation — Bayesian shrinkage + upset premium
// ---------------------------------------------------------------------------

function computeReputation(correct: number, total: number, upsetCorrect: number): number {
  if (total === 0) return 1 / 3;
  const posterior = (correct + 1) / (total + 3);   // shrinkage toward 0.33 baseline
  const upsetPremium = Math.min(0.12, upsetCorrect * 0.03);
  return Math.min(0.85, posterior + upsetPremium);
}

// ---------------------------------------------------------------------------
// Build reputation table from played WC results
// ---------------------------------------------------------------------------

interface ReputationEntry {
  correct: number;
  total: number;
  upsetCorrect: number;
}

function buildReputations(
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
  homeEloFn: (fixtureId: string) => number,
  awayEloFn: (fixtureId: string) => number,
): Map<string, ReputationEntry> {
  const reps = new Map<string, ReputationEntry>(
    PIE_PLAYERS.map(p => [p.id, { correct: 0, total: 0, upsetCorrect: 0 }])
  );

  const fixtureById = new Map(allFixtures.map(f => [f.id, f]));

  for (const r of wcResults) {
    const fixture = fixtureById.get(r.fixture_id);
    if (!fixture) continue;

    const hElo = homeEloFn(r.fixture_id);
    const aElo = awayEloFn(r.fixture_id);
    if (hElo === 0 || aElo === 0) continue;

    // Apply WC form bonus to reputation-building prior too
    const homeBns = wcFormBonus(fixture.home_team_id, allFixtures, wcResults);
    const awayBns = wcFormBonus(fixture.away_team_id, allFixtures, wcResults);
    const prior = eloBasedPrior(hElo + homeBns, aElo + awayBns);

    const actual: 'Home' | 'Draw' | 'Away' =
      r.home_goals > r.away_goals ? 'Home'
      : r.home_goals === r.away_goals ? 'Draw'
      : 'Away';

    // Is this an upset? The underdog won.
    const isUpset =
      (actual === 'Away' && prior.home > prior.away + 0.10) ||
      (actual === 'Home' && prior.away > prior.home + 0.10);

    for (const player of PIE_PLAYERS) {
      const { pick } = computePlayerPick(player, prior, r.fixture_id);
      const entry = reps.get(player.id)!;
      entry.total++;
      if (pick === actual) {
        entry.correct++;
        if (isUpset) entry.upsetCorrect++;
      }
    }
  }

  return reps;
}

// ---------------------------------------------------------------------------
// Main PIE computation
// ---------------------------------------------------------------------------

export interface PIEInput {
  fixture: Fixture;
  homeElo: number;
  awayElo: number;
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  // Optional per-fixture Elo lookup (for reputation building)
  eloByFixture?: Map<string, { home: number; away: number }>;
}

export function computePIEScore(input: PIEInput): PIEResult {
  const { fixture, homeElo, awayElo, allFixtures, wcResults, eloByFixture } = input;

  if (!fixture || homeElo <= 0 || awayElo <= 0) {
    return degradedResult(fixture?.id ?? '');
  }

  // WC 2026 form-adjusted prior
  const homeBns = wcFormBonus(fixture.home_team_id, allFixtures, wcResults);
  const awayBns = wcFormBonus(fixture.away_team_id, allFixtures, wcResults);
  const prior = eloBasedPrior(homeElo + homeBns, awayElo + awayBns);

  // Elo lookup for reputation building
  const hEloFn = (fid: string) => eloByFixture?.get(fid)?.home ?? 0;
  const aEloFn = (fid: string) => eloByFixture?.get(fid)?.away ?? 0;

  const reps = buildReputations(allFixtures, wcResults, hEloFn, aEloFn);

  // Compute all 500 player picks + reputations
  type WeightedPick = { pick: 'Home' | 'Draw' | 'Away'; rep: number; archetype: ArchetypeId };
  const allPicks: WeightedPick[] = PIE_PLAYERS.map(player => {
    const { pick } = computePlayerPick(player, prior, fixture.id);
    const entry = reps.get(player.id)!;
    const rep = computeReputation(entry.correct, entry.total, entry.upsetCorrect);
    return { pick, rep, archetype: player.archetype };
  });

  // Weighted crowd consensus (softmax on rep)
  const totalRep = allPicks.reduce((s, p) => s + p.rep, 0);
  let crowdHome = 0, crowdDraw = 0, crowdAway = 0;
  for (const p of allPicks) {
    const w = p.rep / totalRep;
    if (p.pick === 'Home') crowdHome += w;
    else if (p.pick === 'Draw') crowdDraw += w;
    else crowdAway += w;
  }

  // Elite consensus — top 10% by reputation
  const sorted = [...allPicks].sort((a, b) => b.rep - a.rep);
  const eliteCount = Math.max(10, Math.floor(allPicks.length * 0.10));
  const elite = sorted.slice(0, eliteCount);
  const eliteTotalRep = elite.reduce((s, p) => s + p.rep, 0);
  let eliteHome = 0, eliteDraw = 0, eliteAway = 0;
  for (const p of elite) {
    const w = p.rep / eliteTotalRep;
    if (p.pick === 'Home') eliteHome += w;
    else if (p.pick === 'Draw') eliteDraw += w;
    else eliteAway += w;
  }

  // Picks
  const most_probable_pick = crowdHome >= crowdDraw && crowdHome >= crowdAway ? 'Home'
    : crowdAway >= crowdHome && crowdAway >= crowdDraw ? 'Away' : 'Draw';
  const elite_pick = eliteHome >= eliteDraw && eliteHome >= eliteAway ? 'Home'
    : eliteAway >= eliteHome && eliteAway >= eliteDraw ? 'Away' : 'Draw';

  // Contrarian signal — how much elite disagrees with crowd
  const crowdVec = [crowdHome, crowdDraw, crowdAway];
  const eliteVec = [eliteHome, eliteDraw, eliteAway];
  const dotProduct = crowdVec.reduce((s, c, i) => s + c * eliteVec[i], 0);
  const contrarian_signal = Math.max(0, 1 - dotProduct);

  // Archetype dominance
  const archetypeReps: Record<ArchetypeId, { repSum: number; count: number }> = {
    FAVORITO:    { repSum: 0, count: 0 },
    SORPRESA:    { repSum: 0, count: 0 },
    EMPATE:      { repSum: 0, count: 0 },
    EQUILIBRADO: { repSum: 0, count: 0 },
    CAOTICO:     { repSum: 0, count: 0 },
  };
  for (const p of allPicks) {
    archetypeReps[p.archetype].repSum += p.rep;
    archetypeReps[p.archetype].count++;
  }
  const archetype_avg_reps: Record<ArchetypeId, number> = {
    FAVORITO:    archetypeReps.FAVORITO.count    > 0 ? archetypeReps.FAVORITO.repSum    / archetypeReps.FAVORITO.count    : 0,
    SORPRESA:    archetypeReps.SORPRESA.count    > 0 ? archetypeReps.SORPRESA.repSum    / archetypeReps.SORPRESA.count    : 0,
    EMPATE:      archetypeReps.EMPATE.count      > 0 ? archetypeReps.EMPATE.repSum      / archetypeReps.EMPATE.count      : 0,
    EQUILIBRADO: archetypeReps.EQUILIBRADO.count > 0 ? archetypeReps.EQUILIBRADO.repSum / archetypeReps.EQUILIBRADO.count : 0,
    CAOTICO:     archetypeReps.CAOTICO.count     > 0 ? archetypeReps.CAOTICO.repSum     / archetypeReps.CAOTICO.count     : 0,
  };
  const archetypeKeys = Object.keys(archetype_avg_reps) as ArchetypeId[];
  const dominant_archetype = archetypeKeys.reduce((best, k) =>
    archetype_avg_reps[k] > archetype_avg_reps[best] ? k : best,
    archetypeKeys[0]
  );

  // Most likely score — single archetype-aware seeded draw (NOT a vote across 500)
  // This gives real variety: different fixtures → different FNV hash → different pool entry
  const mostLikelyScore = pickFinalScore(
    most_probable_pick,
    dominant_archetype,
    fixture.id,
    contrarian_signal,
  );

  const confidence = Math.max(crowdHome, crowdDraw, crowdAway);

  return {
    fixture_id: fixture.id,
    pick_probabilities: { home: crowdHome, draw: crowdDraw, away: crowdAway },
    elite_probabilities: { home: eliteHome, draw: eliteDraw, away: eliteAway },
    most_probable_pick,
    elite_pick,
    dominant_archetype,
    archetype_avg_reps,
    contrarian_signal,
    confidence,
    sample_size: 500,
    mostLikelyScore,
    degraded: false,
  };
}

function degradedResult(fixture_id: string): PIEResult {
  const u = 1 / 3;
  const p = { home: u, draw: u, away: u };
  return {
    fixture_id,
    pick_probabilities: p,
    elite_probabilities: p,
    most_probable_pick: 'Home',
    elite_pick: 'Home',
    dominant_archetype: null,
    archetype_avg_reps: { FAVORITO: 0, SORPRESA: 0, EMPATE: 0, EQUILIBRADO: 0, CAOTICO: 0 },
    contrarian_signal: 0,
    confidence: u,
    sample_size: 0,
    mostLikelyScore: null,
    degraded: true,
  };
}
