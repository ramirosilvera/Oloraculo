// =============================================================================
// Oloráculo — PIE (Prode Intelligence Engine) types
// =============================================================================

export type ArchetypeId = 'FAVORITO' | 'SORPRESA' | 'EMPATE' | 'EQUILIBRADO' | 'CAOTICO';

export interface PIEPlayer {
  id: string;
  index: number;       // 0-9999 — used for fast integer hashing
  homeSkew: number;    // -0.15 to +0.15
  drawSkew: number;    // -0.08 to +0.12
  noiseLevel: number;  // 0.05 to 0.50
  archetype: ArchetypeId;
}

// One entry in the competition leaderboard
export interface PIELeaderEntry {
  id: string;
  rank: number;
  archetype: ArchetypeId;
  correct: number;       // correct winner picks
  exactCorrect: number;  // correct exact score picks (harder, 3× weight)
  total: number;
  upsetCorrect: number;
  pick: 'Home' | 'Draw' | 'Away';
  pickScore: { home: number; away: number };
}

export interface PIEResult {
  fixture_id: string;
  // Primary prediction: the competition leader's pick
  most_probable_pick: 'Home' | 'Draw' | 'Away';
  mostLikelyScore: { home: number; away: number } | null;
  leader: PIELeaderEntry | null;
  leader_support: number;  // % of top 10 that agree with leader (0-1)
  // Crowd distribution (equal-weighted, for probability bars)
  pick_probabilities: { home: number; draw: number; away: number };
  // Elite consensus (top 10% by composite score)
  elite_probabilities: { home: number; draw: number; away: number };
  elite_pick: 'Home' | 'Draw' | 'Away';
  contrarian_signal: number;
  dominant_archetype: ArchetypeId | null;
  archetype_avg_reps: Record<ArchetypeId, number>;
  leaderboard: PIELeaderEntry[];  // top 5
  confidence: number;
  sample_size: number;
  degraded: boolean;
}
