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

// One entry in the competition leaderboard
export interface PIELeaderEntry {
  id: string;            // e.g. "pie-247"
  rank: number;          // 1-based
  archetype: ArchetypeId;
  correct: number;       // correct winner picks so far
  total: number;         // total matches played so far
  upsetCorrect: number;  // correct upset picks (harder, tiebreak)
  pick: 'Home' | 'Draw' | 'Away';
  pickScore: { home: number; away: number };
}

export interface PIEResult {
  fixture_id: string;
  // ── Primary prediction: the competition leader's pick ──────────────────
  most_probable_pick: 'Home' | 'Draw' | 'Away';
  mostLikelyScore: { home: number; away: number } | null;
  leader: PIELeaderEntry | null;
  // % of the top 10 that agree with the leader (0-1)
  leader_support: number;
  // ── Crowd distribution (equal-weighted, for probability bars) ──────────
  pick_probabilities: { home: number; draw: number; away: number };
  // ── Elite consensus (top 10% by correct picks) ─────────────────────────
  elite_probabilities: { home: number; draw: number; away: number };
  elite_pick: 'Home' | 'Draw' | 'Away';
  // 1 = leader's pick is completely opposite to crowd modal
  contrarian_signal: number;
  // Archetype of the current leader
  dominant_archetype: ArchetypeId | null;
  // Average accuracy rate per archetype (for breakdown chart)
  archetype_avg_reps: Record<ArchetypeId, number>;
  // Top 5 for leaderboard display in the card
  leaderboard: PIELeaderEntry[];
  confidence: number;
  sample_size: number;
  degraded: boolean;
}
