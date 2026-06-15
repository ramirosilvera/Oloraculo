-- =============================================================================
-- Oloráculo — Supabase schema (mutable tables only)
-- Static data (teams, groups, fixtures, ratings, historical results)
-- is served as JSON files from the repo — not stored here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- fixture_contexts
-- User-input injury / lineup / context notes per fixture.
-- Created/updated by the user from the Partidos page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixture_contexts (
  fixture_id                       TEXT PRIMARY KEY,
  unavailable_home_players         INTEGER NOT NULL DEFAULT 0,
  unavailable_away_players         INTEGER NOT NULL DEFAULT 0,
  unavailable_home_attack_impact   DOUBLE PRECISION NOT NULL DEFAULT 0,
  unavailable_home_defense_impact  DOUBLE PRECISION NOT NULL DEFAULT 0,
  unavailable_away_attack_impact   DOUBLE PRECISION NOT NULL DEFAULT 0,
  unavailable_away_defense_impact  DOUBLE PRECISION NOT NULL DEFAULT 0,
  has_lineups                      BOOLEAN NOT NULL DEFAULT FALSE,
  has_odds                         BOOLEAN NOT NULL DEFAULT FALSE,
  has_availability_news            BOOLEAN NOT NULL DEFAULT FALSE,
  notes                            TEXT,
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- wc_actual_results
-- Real World Cup match results entered by the user during the tournament.
-- Used to evaluate saved prediction snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wc_actual_results (
  id          SERIAL PRIMARY KEY,
  fixture_id  TEXT NOT NULL UNIQUE,
  home_goals  INTEGER NOT NULL,
  away_goals  INTEGER NOT NULL,
  played_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- prediction_snapshots
-- Saved predictions: match (single fixture) or tournament (full sim).
-- kind: 'match' | 'tournament'
-- payload: full MatchPredictionResult or TournamentProjection JSON
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id                  SERIAL PRIMARY KEY,
  kind                TEXT NOT NULL DEFAULT 'match',
  fixture_id          TEXT,
  batch_id            INTEGER,
  model_name          TEXT NOT NULL DEFAULT '',
  input_summary_hash  TEXT NOT NULL DEFAULT '',
  home_win            DOUBLE PRECISION,
  draw                DOUBLE PRECISION,
  away_win            DOUBLE PRECISION,
  explanation         TEXT NOT NULL DEFAULT '',
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_match    ON prediction_snapshots(fixture_id, created_at DESC) WHERE kind = 'match';
CREATE INDEX IF NOT EXISTS idx_snapshots_tourney  ON prediction_snapshots(created_at DESC) WHERE kind = 'tournament';

-- ---------------------------------------------------------------------------
-- prediction_evaluations
-- Brier / RPS / LogLoss accuracy metrics, computed after real results.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_evaluations (
  id                       SERIAL PRIMARY KEY,
  model_name               TEXT NOT NULL,
  fixture_id               TEXT NOT NULL,
  home_team_id             TEXT NOT NULL,
  away_team_id             TEXT NOT NULL,
  home_goals               INTEGER NOT NULL,
  away_goals               INTEGER NOT NULL,
  home_win                 DOUBLE PRECISION NOT NULL,
  draw                     DOUBLE PRECISION NOT NULL,
  away_win                 DOUBLE PRECISION NOT NULL,
  actual                   TEXT NOT NULL,  -- 'Home' | 'Draw' | 'Away'
  brier_score              DOUBLE PRECISION NOT NULL,
  ranked_probability_score DOUBLE PRECISION NOT NULL,
  log_loss                 DOUBLE PRECISION NOT NULL,
  top_pick_correct         BOOLEAN NOT NULL,
  predicted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evals_model   ON prediction_evaluations(model_name);
CREATE INDEX IF NOT EXISTS idx_evals_fixture ON prediction_evaluations(fixture_id);

-- =============================================================================
-- Row Level Security — anon can read AND write (personal tool, no auth needed)
-- =============================================================================
ALTER TABLE fixture_contexts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wc_actual_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_fixture_contexts"       ON fixture_contexts       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_wc_actual_results"      ON wc_actual_results      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_prediction_snapshots"   ON prediction_snapshots   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_prediction_evaluations" ON prediction_evaluations FOR ALL USING (true) WITH CHECK (true);
