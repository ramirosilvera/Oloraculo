// =============================================================================
// Oloráculo — PIE (Prode Intelligence Engine) types
// =============================================================================

export type ArchetypeId = 'FAVORITO' | 'SORPRESA' | 'EMPATE' | 'EQUILIBRADO' | 'CAOTICO';

export interface PIEPlayer {
  id: string;
  homeSkew: number;    // -0.15 to +0.15
  drawSkew: number;    // -0.08 to +0.12
  noiseLevel: number;  // 0.05 to 0.50
  archetype: ArchetypeId;
}

export interface PIEPlayerPick {
  playerId: string;
  pick: 'Home' | 'Draw' | 'Away';
  score: { home: number; away: number };
  reputation: number;
}

export interface PIEResult {
  fixture_id: string;
  // Weighted crowd consensus (all 500 players, weighted by reputation)
  pick_probabilities: { home: number; draw: number; away: number };
  // Elite consensus (top 10% by reputation)
  elite_probabilities: { home: number; draw: number; away: number };
  most_probable_pick: 'Home' | 'Draw' | 'Away';
  elite_pick: 'Home' | 'Draw' | 'Away';
  dominant_archetype: ArchetypeId | null;
  archetype_avg_reps: Record<ArchetypeId, number>;
  // How much elite diverges from crowd: 0=aligned, 1=full opposite
  contrarian_signal: number;
  // Normalized max probability of most_probable_pick (crowd)
  confidence: number;
  sample_size: number;
  mostLikelyScore: { home: number; away: number } | null;
  degraded: boolean;
}
