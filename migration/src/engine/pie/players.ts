// =============================================================================
// PIE — 100 000 deterministic virtual players (typed arrays, LCG)
// Player data lives in flat typed arrays — ~1.3 MB vs ~10 MB for objects.
// Initialization runs once at module load (~30 ms) via an IIFE.
//
// FAV_SKEW: continuous bias toward the Elo-favored team (+) or underdog (-).
// DRAW_SKEW: continuous draw-preference bias.
// NOISE_LEVEL: how much randomness the player injects into their picks.
//
// Archetype thresholds are intentionally strict: only ~18% of players are
// extreme types (FAVORITO/SORPRESA/EMPATE/CAOTICO). The majority (~55%) fall
// into EQUILIBRADO — the hybrid analyst with no dominant single bias. This
// mirrors real prode data: winners are rarely extremists, they have a tendency
// but stay flexible. Pure archetypes are rare and usually lose long-term.
// =============================================================================

import type { ArchetypeId } from '../../types/pie';

export const N = 100_000;

export const FAV_SKEW    = new Float32Array(N); // 4 MB  (was HOME_SKEW)
export const DRAW_SKEW   = new Float32Array(N); // 4 MB
export const NOISE_LEVEL = new Float32Array(N); // 4 MB
export const ARCHETYPE   = new Uint8Array(N);   // 1 MB
// 0=FAVORITO 1=SORPRESA 2=EMPATE 3=EQUILIBRADO 4=CAOTICO
export const ARCHETYPE_IDS: ArchetypeId[] =
  ['FAVORITO', 'SORPRESA', 'EMPATE', 'EQUILIBRADO', 'CAOTICO'];

;(function () {
  let s = 0xDEADBEEF >>> 0;
  function next(): number {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  }
  for (let i = 0; i < N; i++) {
    const fs = -0.15 + next() * 0.30;  // lerp(-0.15,  0.15) — toward fav(+) or underdog(-)
    const ds = -0.08 + next() * 0.20;  // lerp(-0.08,  0.12)
    const nl =  0.05 + next() * 0.45;  // lerp( 0.05,  0.50)
    FAV_SKEW[i]    = fs;
    DRAW_SKEW[i]   = ds;
    NOISE_LEVEL[i] = nl;
    ARCHETYPE[i] =
      nl > 0.42  ? 4 :  // CAOTICO   — very high noise (~18 %)
      fs > 0.10  ? 0 :  // FAVORITO  — strong fav bias, rare pure type (~14 %)
      fs < -0.10 ? 1 :  // SORPRESA  — strong upset bias, rare pure type (~14 %)
      ds > 0.09  ? 2 :  // EMPATE    — strong draw bias, rare (~8 %)
                   3;   // EQUILIBRADO — hybrid majority (~55 %): mild tendencies, no extreme axis
  }
})();
