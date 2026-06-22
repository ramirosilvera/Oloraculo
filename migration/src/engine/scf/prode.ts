// =============================================================================
// Corazón Futbolero — Prode engine
// Six virtual players each with a personality that biases the CF outcome probs
// before making a deterministic pick (seeded by player.id + fixture_id).
// The leaderboard tracks who's been right most across played matches —
// that player's current pick is highlighted as the "best call".
// =============================================================================

import type { ProdePlayer, ProdePlayerPick, ProdeStanding } from '../../types/scf';

// ---------------------------------------------------------------------------
// Score pools — same historical WC frequencies as engine.ts
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

function prodeRng(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
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

function pickScore(
  pick: 'Home' | 'Draw' | 'Away',
  rng: number,
): { home: number; away: number } {
  const pool = pick === 'Home' ? HOME_WIN_POOL
             : pick === 'Away' ? AWAY_WIN_POOL
             : DRAW_POOL;
  const s = wSample(pool, rng);
  return { home: s.home, away: s.away };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const PRODE_PLAYERS: ProdePlayer[] = [
  {
    id: 'goleador',
    name: 'El Goleador',
    emoji: '⚽',
    description: 'Siempre va con el favorito',
    biasHome: +0.12, biasDraw: -0.06, biasAway: -0.06,
    noiseLevel: 0.14,
  },
  {
    id: 'aguas',
    name: 'El Aguafiestas',
    emoji: '💥',
    description: 'Siempre busca la sorpresa',
    biasHome: -0.10, biasDraw: +0.04, biasAway: +0.06,
    noiseLevel: 0.22,
  },
  {
    id: 'empatero',
    name: 'El Empatero',
    emoji: '🤝',
    description: 'El empate siempre llega',
    biasHome: -0.07, biasDraw: +0.15, biasAway: -0.07,
    noiseLevel: 0.15,
  },
  {
    id: 'analitico',
    name: 'El Analítico',
    emoji: '📊',
    description: 'Frío, casi sin sesgo propio',
    biasHome: 0, biasDraw: 0, biasAway: 0,
    noiseLevel: 0.08,
  },
  {
    id: 'romantico',
    name: 'El Romántico',
    emoji: '❤️',
    description: 'El corazón siempre manda',
    biasHome: +0.06, biasDraw: -0.03, biasAway: -0.03,
    noiseLevel: 0.28,
  },
  {
    id: 'loco',
    name: 'El Loco',
    emoji: '🎲',
    description: 'Caos puro, imposible de predecir',
    biasHome: 0, biasDraw: 0, biasAway: 0,
    noiseLevel: 0.45,
  },
];

// ---------------------------------------------------------------------------
// Pick computation
// ---------------------------------------------------------------------------

export function computePlayerPick(
  player: ProdePlayer,
  outcome: { homeWin: number; draw: number; awayWin: number },
  fixtureId: string,
): ProdePlayerPick {
  const rng1 = prodeRng(`${player.id}::pick::${fixtureId}`);
  const rng2 = prodeRng(`${player.id}::score::${fixtureId}`);

  // 1. Apply personality bias then re-normalize
  let h = Math.max(0.02, outcome.homeWin + player.biasHome);
  let d = Math.max(0.02, outcome.draw    + player.biasDraw);
  let a = Math.max(0.02, outcome.awayWin + player.biasAway);
  const tot = h + d + a;
  h /= tot; d /= tot; a /= tot;

  // 2. Blend toward uniform (simulates gut-feel intuition noise)
  const u = 1 / 3;
  h = h * (1 - player.noiseLevel) + u * player.noiseLevel;
  d = d * (1 - player.noiseLevel) + u * player.noiseLevel;
  a = a * (1 - player.noiseLevel) + u * player.noiseLevel;

  // 3. Deterministic pick via seeded threshold
  const pick: 'Home' | 'Draw' | 'Away' =
    rng1 < h ? 'Home' : rng1 < h + d ? 'Draw' : 'Away';

  return { playerId: player.id, pick, score: pickScore(pick, rng2) };
}

// ---------------------------------------------------------------------------
// Standings — how many picks each player got right across played matches
// ---------------------------------------------------------------------------

export function computeProdeStandings(
  playedData: Array<{
    fixtureId: string;
    outcome: { homeWin: number; draw: number; awayWin: number };
    actual: 'Home' | 'Draw' | 'Away';
  }>,
): ProdeStanding[] {
  const counts = new Map(PRODE_PLAYERS.map(p => [p.id, { correct: 0, total: 0 }]));

  for (const { fixtureId, outcome, actual } of playedData) {
    for (const player of PRODE_PLAYERS) {
      const { pick } = computePlayerPick(player, outcome, fixtureId);
      const c = counts.get(player.id)!;
      c.total++;
      if (pick === actual) c.correct++;
    }
  }

  return [...PRODE_PLAYERS]
    .sort((a, b) => {
      const ca = counts.get(a.id)!;
      const cb = counts.get(b.id)!;
      if (cb.correct !== ca.correct) return cb.correct - ca.correct;
      // Tiebreak by accuracy rate
      const ra = ca.total > 0 ? ca.correct / ca.total : 0;
      const rb = cb.total > 0 ? cb.correct / cb.total : 0;
      return rb - ra;
    })
    .map(player => ({ player, ...counts.get(player.id)! }));
}
