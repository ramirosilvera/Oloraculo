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
// Score pools — historical WC frequencies 2006-2022
// ---------------------------------------------------------------------------

const HOME_WIN_POOL = [
  { home: 1, away: 0, w: 34 },
  { home: 2, away: 0, w: 22 },
  { home: 2, away: 1, w: 20 },
  { home: 3, away: 0, w:  8 },
  { home: 3, away: 1, w:  7 },
  { home: 4, away: 0, w:  3 },
  { home: 3, away: 2, w:  4 },
  { home: 4, away: 1, w:  2 },
];

const DRAW_POOL = [
  { home: 1, away: 1, w: 55 },
  { home: 0, away: 0, w: 35 },
  { home: 2, away: 2, w:  8 },
  { home: 3, away: 3, w:  2 },
];

const AWAY_WIN_POOL = [
  { home: 0, away: 1, w: 34 },
  { home: 0, away: 2, w: 22 },
  { home: 1, away: 2, w: 20 },
  { home: 0, away: 3, w:  8 },
  { home: 1, away: 3, w:  7 },
  { home: 0, away: 4, w:  3 },
  { home: 2, away: 3, w:  4 },
  { home: 1, away: 4, w:  2 },
];

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
// Elo-based prior
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
// ---------------------------------------------------------------------------

function computePlayerPick(
  player: PIEPlayer,
  prior: { home: number; draw: number; away: number },
  fixtureId: string,
): PIEPlayerPick {
  const rng1 = fnv1a(`${player.id}::pick::${fixtureId}`);
  const rng2 = fnv1a(`${player.id}::score::${fixtureId}`);

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

  const pool = pick === 'Home' ? HOME_WIN_POOL : pick === 'Away' ? AWAY_WIN_POOL : DRAW_POOL;
  const s = wSample(pool, rng2);

  return { playerId: player.id, pick, score: { home: s.home, away: s.away }, reputation: 0 };
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

    const prior = eloBasedPrior(hElo, aElo);
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

  const prior = eloBasedPrior(homeElo, awayElo);

  // Elo lookup for reputation building
  const hEloFn = (fid: string) => eloByFixture?.get(fid)?.home ?? 0;
  const aEloFn = (fid: string) => eloByFixture?.get(fid)?.away ?? 0;

  const reps = buildReputations(allFixtures, wcResults, hEloFn, aEloFn);

  // Compute all 500 player picks + reputations
  type WeightedPick = { pick: 'Home' | 'Draw' | 'Away'; rep: number; archetype: ArchetypeId; score: { home: number; away: number } };
  const allPicks: WeightedPick[] = PIE_PLAYERS.map(player => {
    const { pick, score } = computePlayerPick(player, prior, fixture.id);
    const entry = reps.get(player.id)!;
    const rep = computeReputation(entry.correct, entry.total, entry.upsetCorrect);
    return { pick, rep, archetype: player.archetype, score };
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

  // Most likely score — weighted vote across all 500 picks
  const scoreVotes = new Map<string, number>();
  for (const p of allPicks) {
    const key = `${p.score.home}-${p.score.away}`;
    scoreVotes.set(key, (scoreVotes.get(key) ?? 0) + p.rep);
  }
  let bestScoreKey = '';
  let bestScoreW = 0;
  for (const [k, w] of scoreVotes) {
    if (w > bestScoreW) { bestScoreW = w; bestScoreKey = k; }
  }
  const [sh, sa] = bestScoreKey.split('-').map(Number);
  const mostLikelyScore = bestScoreKey ? { home: sh, away: sa } : null;

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
