// =============================================================================
// Oloráculo — TypeScript domain types
// Migrated from: Oloraculo.Web/Models/*.cs
// =============================================================================

// ---------------------------------------------------------------------------
// Core entities (mirror Supabase tables)
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  source: string;
}

export interface Group {
  id: number;
  name: string;
  team_ids: string[];
  source: string;
}

export interface Fixture {
  id: string;
  group_name: string;
  home_team_id: string;
  away_team_id: string;
  neutral_venue: boolean;
  kickoff_utc: string | null;
  venue: string | null;
  city: string | null;
  status: string | null;
  is_played: boolean;
  home_goals: number | null;
  away_goals: number | null;
  source: string;
}

export interface MatchResult {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
  date: string;
  tournament: string;
  neutral: boolean;
  source: string;
}

export type RatingType = 'Elo' | 'Fifa';

export interface Rating {
  id: number;
  team_id: string;
  type: RatingType;
  value: number;
  as_of: string;
  source: string;
}

export interface FixtureContext {
  fixture_id: string;
  unavailable_home_players: number;
  unavailable_away_players: number;
  unavailable_home_attack_impact: number;
  unavailable_home_defense_impact: number;
  unavailable_away_attack_impact: number;
  unavailable_away_defense_impact: number;
  has_lineups: boolean;
  has_odds: boolean;
  has_availability_news: boolean;
  notes: string | null;
  updated_at: string;
}

export type AvailabilityStatus = 'ConfirmedOut' | 'Doubtful' | 'Available' | 'NotRelevant';

export interface AvailabilityClaim {
  id: number;
  player: string;
  player_key: string;
  team_id: string;
  team_name: string;
  status: AvailabilityStatus;
  reason: string;
  confidence: string;
  evidence_level: number;
  source_url: string;
  publisher: string | null;
  supporting_quote: string;
  observed_date: string | null;
  affects_prediction: boolean;
  api_football_player_id: number | null;
  position: string;
  position_source: string;
  position_matched_at: string | null;
  created_at: string;
}

export interface PredictionSnapshot {
  id: number;
  kind: 'match' | 'tournament';
  fixture_id: string | null;
  batch_id: number | null;
  model_name: string;
  input_summary_hash: string;
  home_win: number | null;
  draw: number | null;
  away_win: number | null;
  explanation: string;
  payload: unknown;
  created_at: string;
}

export interface PredictionEvaluation {
  id: number;
  model_name: string;
  fixture_id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
  home_win: number;
  draw: number;
  away_win: number;
  actual: 'Home' | 'Draw' | 'Away';
  brier_score: number;
  ranked_probability_score: number;
  log_loss: number;
  top_pick_correct: boolean;
  predicted_at: string;
}

// ---------------------------------------------------------------------------
// Prediction engine types
// Migrated from: Oloraculo.Web/Models/MatchPrediction.cs, OutcomeProbabilities.cs,
//                ScorelineDistribution.cs, MatchContext.cs
// ---------------------------------------------------------------------------

export interface OutcomeProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export const UNIFORM_OUTCOME: OutcomeProbabilities = {
  homeWin: 1 / 3,
  draw: 1 / 3,
  awayWin: 1 / 3,
};

/** Scoreline probability matrix [home][away] — max 9x9 (0..8 goals each side) */
export interface ScorelineDistribution {
  maxGoals: number;
  matrix: number[][];  // matrix[homeGoals][awayGoals] = probability
}

export interface SourceMetadata {
  name: string;
  kind: string;
  notes?: string;
}

export interface MatchPrediction {
  predictorName: string;
  predictorPriority: number;
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  outcome: OutcomeProbabilities;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  scoreline: ScorelineDistribution | null;
  mostLikelyScore: { home: number; away: number } | null;
  explanation: string;
  drivers: string[];
  featuresUsed: string[];
  featuresMissing: string[];
  sources: SourceMetadata[];
  degraded: boolean;
}

export interface MatchPredictionResult {
  fixture: Fixture;
  homeTeamName: string;
  awayTeamName: string;
  predictions: MatchPrediction[];
  bestPrediction: MatchPrediction;
}

/** All data needed to run the prediction engine for a fixture — loaded once from Supabase */
export interface MatchContext {
  fixture: Fixture;
  homeTeam: Team;
  awayTeam: Team;
  homeElo: Rating | null;
  awayElo: Rating | null;
  homeFifaRating: Rating | null;
  awayFifaRating: Rating | null;
  homeRecentResults: MatchResult[];
  awayRecentResults: MatchResult[];
  fixtureContext: FixtureContext | null;
}

// ---------------------------------------------------------------------------
// Simulation / Tournament types
// Migrated from: TournamentProjection.cs, TeamTournamentProbability.cs
// ---------------------------------------------------------------------------

export interface TeamTournamentProbability {
  teamId: string;
  group: string;
  winGroup: number;
  qualify: number;
  reachRoundOf16: number;
  reachQuarterFinal: number;
  reachSemiFinal: number;
  reachFinal: number;
  winTournament: number;
  expectedGroupPoints: number;
}

export interface TournamentProjection {
  simulations: number;
  modelName: string;
  inputSummaryHash: string;
  teams: TeamTournamentProbability[];
}

// ---------------------------------------------------------------------------
// Model performance / evaluation
// ---------------------------------------------------------------------------

export interface ModelPerformanceRow {
  modelName: string;
  count: number;
  topPickAccuracy: number;
  avgBrierScore: number;
  avgRps: number;
  avgLogLoss: number;
}
