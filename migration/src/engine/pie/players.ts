// =============================================================================
// PIE — 10 000 deterministic virtual players generated via LCG
// Player parameters are stable across builds (same seed → same players)
// =============================================================================

import type { PIEPlayer, ArchetypeId } from '../../types/pie';

// Linear Congruential Generator (Knuth's constants)
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

function lerp(t: number, lo: number, hi: number) {
  return lo + t * (hi - lo);
}

function classifyArchetype(homeSkew: number, drawSkew: number, noiseLevel: number): ArchetypeId {
  if (noiseLevel > 0.38) return 'CAOTICO';
  if (homeSkew > 0.08)   return 'FAVORITO';
  if (homeSkew < -0.08)  return 'SORPRESA';
  if (drawSkew > 0.08)   return 'EMPATE';
  return 'EQUILIBRADO';
}

function generatePlayers(): PIEPlayer[] {
  const rng = makeLCG(0xDEADBEEF);
  const players: PIEPlayer[] = [];

  for (let i = 0; i < 10_000; i++) {
    const homeSkew   = lerp(rng(), -0.15,  0.15);
    const drawSkew   = lerp(rng(), -0.08,  0.12);
    const noiseLevel = lerp(rng(),  0.05,  0.50);
    players.push({
      id: `pie-${i}`,
      index: i,
      homeSkew,
      drawSkew,
      noiseLevel,
      archetype: classifyArchetype(homeSkew, drawSkew, noiseLevel),
    });
  }

  return players;
}

export const PIE_PLAYERS: PIEPlayer[] = generatePlayers();
