// =============================================================================
// Oloráculo — TypeScript domain types
// =============================================================================

// ---------------------------------------------------------------------------
// Core entities — match static JSON files in public/data/
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  group?: string;
  source?: string;
}

export interface Group {
  id?: number;
  name: string;
  team_ids: string[];
  source?: string;
}

export interface Fixture {
  id: string;
  group_name: string;
  home_team_id: string;
  away_team_id: string;
  neutral_venue: boolean;
  kickoff_utc?: string | null;
  venue?: string | null;
  city?: string | null;
  status?: string | null;
  is_played: boolean;
  home_goals?: number | null;
  away_goals?: number | null;
  source?: string;
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
  source?: string;
}

export type RatingType = 'elo' | 'fifa';

export interface Rating {
  id?: number;
  team_id: string;
  type: RatingType;
  value: number;
  as_of: string;
  source?: string;
}

// ---------------------------------------------------------------------------
// Mutable entities — stored in Supabase
// ---------------------------------------------------------------------------

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

export interface WcActualResult {
  id: number;
  fixture_id: string;
  home_goals: number;
  away_goals: number;
  played_at: string;
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
// Daily scoring pattern detection
// ---------------------------------------------------------------------------

export type DailyPatternType = 'blowout' | 'decisive' | 'draw_heavy' | 'low_scoring' | 'contested';

export interface DailyStats {
  date: string;
  matchCount: number;
  avgGoals: number;
  avgMargin: number;
  drawRate: number;
  patternType: DailyPatternType;
}

export interface DailyPatternSignal {
  currentStreak: DailyPatternType;
  streakDays: number;
  isConfirmed: boolean;
  goalModifier: number;
  pushModifier: number;
  recentDays: DailyStats[];
}

// ---------------------------------------------------------------------------
// Prediction engine types
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

export interface ScorelineDistribution {
  maxGoals: number;
  matrix: number[][];
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

export interface TournamentFormStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  momentumScore: number;  // normalized -1..+1
  upsetBonus: number;     // cumulative upset-win extra score
}

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
  homeTournamentForm: TournamentFormStats | null;
  awayTournamentForm: TournamentFormStats | null;
  tournamentGoalInflation: number | null;
  dailyPatternSignal: DailyPatternSignal | null;
}

// ---------------------------------------------------------------------------
// Simulation / Tournament types
// ---------------------------------------------------------------------------

/** One knockout round's "most likely" narrative — generated by runSimulation. */
export interface JourneyRound {
  mostLikelyOpponentId: string;
  /** Raw count: # of sims where this opponent was faced */
  facedCount: number;
  /** Raw count: # of those sims where the team won */
  winsVsMostLikely: number;
  /** Raw count: # of sims where the team reached this round */
  totalReached: number;
  /** Raw count: total wins across ALL opponents in this round */
  wins: number;
}

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
  // Journey fields — absent in snapshots created before this version
  avgGroupGoalsFor?: number;
  avgGroupGoalsAgainst?: number;
  /** Fraction finishing 1st / 2nd / 3rd / 4th in the group */
  groupPositions?: [number, number, number, number];
  r32Journey?: JourneyRound;  // Dieciséisavos de final
  r16Journey?: JourneyRound;  // Octavos de final
  qfJourney?: JourneyRound;   // Cuartos de final
  sfJourney?: JourneyRound;   // Semifinal
  finJourney?: JourneyRound;  // Final
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
