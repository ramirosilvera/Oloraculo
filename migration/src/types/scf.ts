// =============================================================================
// Oloráculo — SCF (Sentido Común Futbolero) types
// =============================================================================

export type SCFCategory = 'HISTORIA' | 'FORMA' | 'PLANTEL' | 'TORNEO' | 'LOCALIA' | 'PSICOLOGIA';
export type SCFClassification = 'A' | 'B' | 'C' | 'D' | 'E';
export type SCFConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface SCFHeuristic {
  id: string;
  name: string;
  description: string;
  category: SCFCategory;
  subcategory: string | null;
  frequency: number;        // 0-1, how often it gets cited
  accuracy: number;         // 0-1, historical accuracy
  sample_size: number;
  confidence: SCFConfidence;
  classification: SCFClassification;
  roi_hypothetical: number | null;
  is_bias: boolean;
  bias_notes: string | null;
}

export interface ActiveHeuristic {
  id: string;
  name: string;
  category: SCFCategory;
  direction: number;        // -1 to +1: positive = home advantage
  strength: number;         // 0-1: how strongly it fires
  weight: number;           // final weight after class + bias adjustments
  isBias: boolean;
  note: string;
}

export interface SCFCategoryBreakdown {
  category: SCFCategory;
  score: number;            // category's contribution to final score, -1 to +1
  activeCount: number;
  biasCount: number;
}

export interface SCFResult {
  fixture_id: string;
  home_team_id: string;
  away_team_id: string;
  scf_score: number;        // 0-100, home-directed (50 = neutral)
  outcome: { homeWin: number; draw: number; awayWin: number };
  // Category weight contributions (each 0-1)
  historical_weight: number;
  squad_weight: number;
  momentum_weight: number;
  psychology_weight: number;
  collective_belief_weight: number;
  // Top heuristics that fired
  top_heuristics: ActiveHeuristic[];
  category_breakdown: SCFCategoryBreakdown[];
  confidence: number;       // 0-1
  bias_count: number;
  degraded: boolean;
}

// Context passed to heuristic evaluators
export interface SCFMatchContext {
  fixture: {
    id: string;
    home_team_id: string;
    away_team_id: string;
    group_name: string;
    neutral_venue: boolean;
  };
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  homeElo: number;
  awayElo: number;
  // WC 2026 tournament form
  homeWCWins: number;
  homeWCDraws: number;
  homeWCLosses: number;
  homeWCGoalsFor: number;
  homeWCGoalsAgainst: number;
  awayWCWins: number;
  awayWCDraws: number;
  awayWCLosses: number;
  awayWCGoalsFor: number;
  awayWCGoalsAgainst: number;
  // Squad info
  homeSquadStrength: number;  // 0-1 normalized within tournament
  awaySquadStrength: number;
  isDefendingChampion: { home: boolean; away: boolean };
  isHostNation: { home: boolean; away: boolean };
  isKnockout: boolean;
  goalInflation: number;
}

export interface HeuristicSignal {
  applies: boolean;
  direction: number;   // -1 to +1
  strength: number;    // 0 to 1
  note: string;
}
