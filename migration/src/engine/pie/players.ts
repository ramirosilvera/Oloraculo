// =============================================================================
// PIE — 1 000 000 deterministic virtual players (typed arrays, LCG)
// Player data lives in flat typed arrays — ~13 MB vs ~100 MB for objects.
// Initialization runs once at module load (~30 ms) via an IIFE.
// =============================================================================

import type { ArchetypeId } from '../../types/pie';

export const N = 100_000;

export const HOME_SKEW   = new Float32Array(N); // 4 MB
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
    const hs = -0.15 + next() * 0.30;  // lerp(-0.15,  0.15)
    const ds = -0.08 + next() * 0.20;  // lerp(-0.08,  0.12)
    const nl =  0.05 + next() * 0.45;  // lerp( 0.05,  0.50)
    HOME_SKEW[i]   = hs;
    DRAW_SKEW[i]   = ds;
    NOISE_LEVEL[i] = nl;
    ARCHETYPE[i] =
      nl > 0.38  ? 4 :  // CAOTICO
      hs > 0.08  ? 0 :  // FAVORITO
      hs < -0.08 ? 1 :  // SORPRESA
      ds > 0.08  ? 2 :  // EMPATE
                   3;   // EQUILIBRADO
  }
})();
