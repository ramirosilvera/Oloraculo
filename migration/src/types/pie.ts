// =============================================================================
// Oloráculo — PIE types
// =============================================================================

export type ArchetypeId = 'FAVORITO' | 'SORPRESA' | 'EMPATE' | 'EQUILIBRADO' | 'CAOTICO';

export interface PIELeaderEntry {
  id: string;
  rank: number;
  archetype: ArchetypeId;
  correct: number;
  exactCorrect: number;
  total: number;
  upsetCorrect: number;
  pick: 'Home' | 'Draw' | 'Away';
  pickScore: { home: number; away: number };
}

export interface PIEResult {
  fixture_id: string;
  most_probable_pick: 'Home' | 'Draw' | 'Away';
  mostLikelyScore: { home: number; away: number } | null;
  leader: PIELeaderEntry | null;
  leader_support: number;
  pick_probabilities: { home: number; draw: number; away: number };
  elite_probabilities: { home: number; draw: number; away: number };
  elite_pick: 'Home' | 'Draw' | 'Away';
  contrarian_signal: number;
  dominant_archetype: ArchetypeId | null;
  archetype_avg_reps: Record<ArchetypeId, number>;
  leaderboard: PIELeaderEntry[];
  confidence: number;
  sample_size: number;
  degraded: boolean;
}

// Track records for 1M players (typed arrays, exported for hook memoization)
export interface PIETrackRecords {
  correct:  Int32Array;    // correct winner picks per player
  exact:    Float32Array;  // expected exact score credit per player (soft counting — pool probability, not a sample)
  total:    Int32Array;    // total matches played
  upset:    Int32Array;    // upset picks correct per player
}
