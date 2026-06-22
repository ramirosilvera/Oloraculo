// =============================================================================
// PIE — Prode Intelligence Engine (competition model, 10 000 players)
//
// 10 000 virtual players compete across played WC matches.
// Ranking: composite score = exactCorrect×3 + correct×1 + upsetCorrect×0.5
// The LEADER (highest composite) makes the prediction for the next fixture.
//
// Performance: uses integer hash (not string FNV) inside the per-player loop
// to keep 10 000×N_matches iterations fast in the browser (~50 ms).
// =============================================================================

import type { PIEPlayer, PIELeaderEntry, PIEResult, ArchetypeId } from '../../types/pie';
import { PIE_PLAYERS } from './players';
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
  { home: 2, away: 0, w: 32 }, { home: 3, away: 0, w: 20 },
  { home: 3, away: 1, w: 18 }, { home: 1, away: 0, w: 16 },
  { home: 2, away: 1, w: 10 }, { home: 4, away: 0, w:  4 },
];
const POOL_DRAW_FAV: ScoreEntry[] = [
  { home: 1, away: 1, w: 70 }, { home: 0, away: 0, w: 20 }, { home: 2, away: 2, w: 10 },
];
const POOL_AWAY_FAV: ScoreEntry[] = [
  { home: 0, away: 2, w: 32 }, { home: 0, away: 3, w: 20 },
  { home: 1, away: 3, w: 18 }, { home: 0, away: 1, w: 16 },
  { home: 1, away: 2, w: 10 }, { home: 0, away: 4, w:  4 },
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

// Precomputed pool totals for fast wSample
type PoolWithTotal = { entries: ScoreEntry[]; total: number };
function buildPool(entries: ScoreEntry[]): PoolWithTotal {
  return { entries, total: entries.reduce((s, e) => s + e.w, 0) };
}

const SCORE_POOLS: Record<ArchetypeId, { home: PoolWithTotal; draw: PoolWithTotal; away: PoolWithTotal }> = {
  FAVORITO:    { home: buildPool(POOL_HOME_FAV), draw: buildPool(POOL_DRAW_FAV), away: buildPool(POOL_AWAY_FAV) },
  SORPRESA:    { home: buildPool(POOL_HOME_SOR), draw: buildPool(POOL_DRAW_SOR), away: buildPool(POOL_AWAY_SOR) },
  EMPATE:      { home: buildPool(POOL_HOME_EMP), draw: buildPool(POOL_DRAW_EMP), away: buildPool(POOL_AWAY_EMP) },
  EQUILIBRADO: { home: buildPool(POOL_HOME_EQ),  draw: buildPool(POOL_DRAW_EQ),  away: buildPool(POOL_AWAY_EQ)  },
  CAOTICO:     { home: buildPool(POOL_HOME_CAO), draw: buildPool(POOL_DRAW_CAO), away: buildPool(POOL_AWAY_CAO) },
};

// ---------------------------------------------------------------------------
// Fast integer RNG — avoids string FNV in the inner player loop
//
// Strategy: hash the fixture ID once (string FNV, outside player loop),
// then combine with player index and salt using pure integer arithmetic.
// ~50× faster than string FNV per-player.
// ---------------------------------------------------------------------------

function fnv1aInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// salt: 0 = pick RNG, 1 = score RNG
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
// WC 2026 form bonus
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

function eloBasedPrior(homeElo: number, awayElo: number): { home: number; draw: number; away: number } {
  const diff = homeElo - awayElo;
  const homeWinRaw = 1 / (1 + Math.pow(10, -diff / 400));
  const drawBase = 0.26 - 0.15 * Math.abs(diff / 400);
  const draw = Math.max(0.10, Math.min(0.35, drawBase));
  const rem = 1 - draw;
  return { home: homeWinRaw * rem, draw, away: (1 - homeWinRaw) * rem };
}

// ---------------------------------------------------------------------------
// Player pick + score — fast integer hash, archetype-specific score pool
// ---------------------------------------------------------------------------

function computePlayerPick(
  player: PIEPlayer,
  prior: { home: number; draw: number; away: number },
  fixHash: number,  // precomputed fnv1aInt(fixtureId)
): { pick: 'Home' | 'Draw' | 'Away'; pickScore: { home: number; away: number } } {
  const rng1 = fastRng(player.index, fixHash, 0);
  const rng2 = fastRng(player.index, fixHash, 1);

  let h = Math.max(0.02, prior.home + player.homeSkew);
  let d = Math.max(0.02, prior.draw + player.drawSkew);
  let a = Math.max(0.02, prior.away - player.homeSkew - player.drawSkew);
  const tot = h + d + a;
  h /= tot; d /= tot; a /= tot;

  const u = 1 / 3;
  h = h * (1 - player.noiseLevel) + u * player.noiseLevel;
  d = d * (1 - player.noiseLevel) + u * player.noiseLevel;
  a = a * (1 - player.noiseLevel) + u * player.noiseLevel;

  const pick: 'Home' | 'Draw' | 'Away' =
    rng1 < h ? 'Home' : rng1 < h + d ? 'Draw' : 'Away';

  const pools = SCORE_POOLS[player.archetype];
  const sPool = pick === 'Home' ? pools.home : pick === 'Away' ? pools.away : pools.draw;
  const s = wSamplePool(sPool, rng2);

  return { pick, pickScore: { home: s.home, away: s.away } };
}

// ---------------------------------------------------------------------------
// Track records — composite score = exactCorrect×3 + correct×1 + upsetCorrect×0.5
// ---------------------------------------------------------------------------

interface TrackRecord {
  correct: number;
  exactCorrect: number;
  total: number;
  upsetCorrect: number;
}

function compositeScore(r: TrackRecord): number {
  return r.exactCorrect * 3 + r.correct + r.upsetCorrect * 0.5;
}

function buildTrackRecords(
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
  homeEloFn: (fixtureId: string) => number,
  awayEloFn: (fixtureId: string) => number,
): Map<string, TrackRecord> {
  const records = new Map<string, TrackRecord>(
    PIE_PLAYERS.map(p => [p.id, { correct: 0, exactCorrect: 0, total: 0, upsetCorrect: 0 }])
  );

  const fixtureById = new Map(allFixtures.map(f => [f.id, f]));

  for (const r of wcResults) {
    const fixture = fixtureById.get(r.fixture_id);
    if (!fixture) continue;

    const hElo = homeEloFn(r.fixture_id);
    const aElo = awayEloFn(r.fixture_id);
    if (hElo === 0 || aElo === 0) continue;

    const homeBns = wcFormBonus(fixture.home_team_id, allFixtures, wcResults);
    const awayBns = wcFormBonus(fixture.away_team_id, allFixtures, wcResults);
    const prior = eloBasedPrior(hElo + homeBns, aElo + awayBns);

    const actual: 'Home' | 'Draw' | 'Away' =
      r.home_goals > r.away_goals ? 'Home'
      : r.home_goals === r.away_goals ? 'Draw'
      : 'Away';

    const isUpset =
      (actual === 'Away' && prior.home > prior.away + 0.10) ||
      (actual === 'Home' && prior.away > prior.home + 0.10);

    // Precompute fixture hash once (outside player loop — key performance optimization)
    const fixHash = fnv1aInt(r.fixture_id);

    for (const player of PIE_PLAYERS) {
      const { pick, pickScore } = computePlayerPick(player, prior, fixHash);
      const rec = records.get(player.id)!;
      rec.total++;
      if (pick === actual) {
        rec.correct++;
        if (isUpset) rec.upsetCorrect++;
      }
      if (pickScore.home === r.home_goals && pickScore.away === r.away_goals) {
        rec.exactCorrect++;
      }
    }
  }

  return records;
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
  eloByFixture?: Map<string, { home: number; away: number }>;
}

export function computePIEScore(input: PIEInput): PIEResult {
  const { fixture, homeElo, awayElo, allFixtures, wcResults, eloByFixture } = input;

  if (!fixture || homeElo <= 0 || awayElo <= 0) {
    return degradedResult(fixture?.id ?? '');
  }

  const homeBns = wcFormBonus(fixture.home_team_id, allFixtures, wcResults);
  const awayBns = wcFormBonus(fixture.away_team_id, allFixtures, wcResults);
  const prior = eloBasedPrior(homeElo + homeBns, awayElo + awayBns);

  const hEloFn = (fid: string) => eloByFixture?.get(fid)?.home ?? 0;
  const aEloFn = (fid: string) => eloByFixture?.get(fid)?.away ?? 0;
  const records = buildTrackRecords(allFixtures, wcResults, hEloFn, aEloFn);

  // Precompute fixture hash for the target fixture
  const fixHash = fnv1aInt(fixture.id);

  type PlayerState = {
    player: PIEPlayer;
    pick: 'Home' | 'Draw' | 'Away';
    pickScore: { home: number; away: number };
    correct: number;
    exactCorrect: number;
    total: number;
    upsetCorrect: number;
    composite: number;
  };

  const states: PlayerState[] = PIE_PLAYERS.map(player => {
    const { pick, pickScore } = computePlayerPick(player, prior, fixHash);
    const rec = records.get(player.id)!;
    return {
      player,
      pick,
      pickScore,
      correct: rec.correct,
      exactCorrect: rec.exactCorrect,
      total: rec.total,
      upsetCorrect: rec.upsetCorrect,
      composite: compositeScore(rec),
    };
  });

  // Rank by composite score (exactCorrect×3 + correct + upsetCorrect×0.5)
  const ranked = [...states].sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return a.player.id.localeCompare(b.player.id);  // stable tiebreak
  });

  const leaderState = ranked[0];

  const leaderboard: PIELeaderEntry[] = ranked.slice(0, 5).map((s, i) => ({
    id: s.player.id,
    rank: i + 1,
    archetype: s.player.archetype,
    correct: s.correct,
    exactCorrect: s.exactCorrect,
    total: s.total,
    upsetCorrect: s.upsetCorrect,
    pick: s.pick,
    pickScore: s.pickScore,
  }));

  const leader: PIELeaderEntry = { ...leaderboard[0] };

  // Crowd consensus (equal-weighted)
  let crowdHome = 0, crowdDraw = 0, crowdAway = 0;
  for (const s of states) {
    if      (s.pick === 'Home') crowdHome++;
    else if (s.pick === 'Draw') crowdDraw++;
    else                        crowdAway++;
  }
  const n = states.length;
  crowdHome /= n; crowdDraw /= n; crowdAway /= n;

  // Elite consensus (top 10% by composite)
  const eliteCount = Math.max(10, Math.floor(n * 0.10));
  const elite = ranked.slice(0, eliteCount);
  let eliteHome = 0, eliteDraw = 0, eliteAway = 0;
  for (const s of elite) {
    if      (s.pick === 'Home') eliteHome++;
    else if (s.pick === 'Draw') eliteDraw++;
    else                        eliteAway++;
  }
  eliteHome /= eliteCount; eliteDraw /= eliteCount; eliteAway /= eliteCount;

  const elite_pick: 'Home' | 'Draw' | 'Away' =
    eliteHome >= eliteDraw && eliteHome >= eliteAway ? 'Home'
    : eliteAway >= eliteHome && eliteAway >= eliteDraw ? 'Away' : 'Draw';

  const top10 = ranked.slice(0, 10);
  const leader_support = top10.filter(s => s.pick === leader.pick).length / top10.length;

  const crowdModal: 'Home' | 'Draw' | 'Away' =
    crowdHome >= crowdDraw && crowdHome >= crowdAway ? 'Home'
    : crowdAway >= crowdHome && crowdAway >= crowdDraw ? 'Away' : 'Draw';
  const contrarian_signal = leader.pick !== crowdModal
    ? 1 - Math.max(crowdHome, crowdDraw, crowdAway)
    : 0;

  // Archetype accuracy breakdown
  const archetypeStats: Record<ArchetypeId, { correct: number; total: number }> = {
    FAVORITO: { correct: 0, total: 0 }, SORPRESA:    { correct: 0, total: 0 },
    EMPATE:   { correct: 0, total: 0 }, EQUILIBRADO: { correct: 0, total: 0 },
    CAOTICO:  { correct: 0, total: 0 },
  };
  for (const s of states) {
    archetypeStats[s.player.archetype].correct += s.correct;
    archetypeStats[s.player.archetype].total   += s.total;
  }
  const archetype_avg_reps: Record<ArchetypeId, number> = {} as Record<ArchetypeId, number>;
  for (const arc of Object.keys(archetypeStats) as ArchetypeId[]) {
    const { correct, total } = archetypeStats[arc];
    archetype_avg_reps[arc] = total > 0 ? correct / total : 0;
  }

  const confidence = leader.total > 0
    ? leader.correct / leader.total
    : Math.max(crowdHome, crowdDraw, crowdAway);

  return {
    fixture_id: fixture.id,
    most_probable_pick: leader.pick,
    mostLikelyScore: leader.pickScore,
    leader,
    leader_support,
    pick_probabilities: { home: crowdHome, draw: crowdDraw, away: crowdAway },
    elite_probabilities: { home: eliteHome, draw: eliteDraw, away: eliteAway },
    elite_pick,
    contrarian_signal,
    dominant_archetype: leaderState.player.archetype,
    archetype_avg_reps,
    leaderboard,
    confidence,
    sample_size: n,
    degraded: false,
  };
}

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
  };
}
