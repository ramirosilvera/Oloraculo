-- =============================================================================
-- Oloráculo — Supabase PostgreSQL Schema
-- Migrated from: EF Core + SQLite (OloraculoDbContext)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- teams
-- Source: OloraculoDbContext.Teams (Teams.cs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id   TEXT PRIMARY KEY,           -- TeamNameNormalizer.ToId() result
  name TEXT NOT NULL,              -- CanonicalName (display)
  source TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- groups
-- Source: OloraculoDbContext.Groups (Group.cs)
-- team_ids stored as JSONB array e.g. ["argentina","brazil"]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  team_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source   TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- fixtures
-- Source: OloraculoDbContext.Fixtures (Fixture.cs)
-- id format: "grp:{Group}:{home_team_id}:{away_team_id}"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixtures (
  id             TEXT PRIMARY KEY,
  group_name     TEXT NOT NULL,
  home_team_id   TEXT NOT NULL REFERENCES teams(id),
  away_team_id   TEXT NOT NULL REFERENCES teams(id),
  neutral_venue  BOOLEAN NOT NULL DEFAULT TRUE,
  kickoff_utc    TIMESTAMPTZ,
  venue          TEXT,
  city           TEXT,
  status         TEXT,
  is_played      BOOLEAN NOT NULL DEFAULT FALSE,
  home_goals     INTEGER,
  away_goals     INTEGER,
  source         TEXT NOT NULL DEFAULT 'derived'
);

CREATE INDEX IF NOT EXISTS idx_fixtures_group ON fixtures(group_name);
CREATE INDEX IF NOT EXISTS idx_fixtures_teams ON fixtures(home_team_id, away_team_id);

-- ---------------------------------------------------------------------------
-- match_results
-- Source: OloraculoDbContext.Results (MatchResult.cs)
-- Historical match results used for GoalModel and RecentFormModel training
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_results (
  id            TEXT PRIMARY KEY,  -- SHA-256 of (home+away+date+tournament+score)
  home_team_id  TEXT NOT NULL,
  away_team_id  TEXT NOT NULL,
  home_goals    INTEGER NOT NULL,
  away_goals    INTEGER NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  tournament    TEXT NOT NULL DEFAULT '',
  neutral       BOOLEAN NOT NULL DEFAULT FALSE,
  source        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_results_home ON match_results(home_team_id);
CREATE INDEX IF NOT EXISTS idx_results_away ON match_results(away_team_id);
CREATE INDEX IF NOT EXISTS idx_results_date ON match_results(date DESC);

-- ---------------------------------------------------------------------------
-- ratings
-- Source: OloraculoDbContext.Ratings (Rating.cs)
-- type: 'Elo' | 'Fifa'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ratings (
  id        SERIAL PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id),
  type      TEXT NOT NULL CHECK (type IN ('Elo', 'Fifa')),
  value     DOUBLE PRECISION NOT NULL,
  as_of     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ratings_team_type ON ratings(team_id, type);
CREATE INDEX IF NOT EXISTS idx_ratings_as_of ON ratings(as_of DESC);

-- ---------------------------------------------------------------------------
-- fixture_contexts
-- Source: OloraculoDbContext.FixtureContexts (FixtureContext.cs)
-- Player availability impact per fixture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixture_contexts (
  fixture_id                       TEXT PRIMARY KEY REFERENCES fixtures(id),
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
-- api_mappings
-- Source: OloraculoDbContext.ApiMappings (ApiMapping.cs)
-- Maps local fixture IDs to API-Football external IDs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_mappings (
  id                   SERIAL PRIMARY KEY,
  local_fixture_id     TEXT NOT NULL UNIQUE REFERENCES fixtures(id),
  external_fixture_id  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- availability_sources
-- Source: OloraculoDbContext.AvailabilitySources (AvailabilitySource.cs)
-- Tracks fetched news URLs for injury/availability analysis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_sources (
  id             SERIAL PRIMARY KEY,
  url            TEXT NOT NULL UNIQUE,
  title          TEXT,
  publisher      TEXT,
  status_code    INTEGER NOT NULL DEFAULT 0,
  text_hash      TEXT,
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error          TEXT
);

-- ---------------------------------------------------------------------------
-- availability_claims
-- Source: OloraculoDbContext.AvailabilityClaims (AvailabilityClaim.cs)
-- Individual player availability claims extracted by LLM from news
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_claims (
  id                    SERIAL PRIMARY KEY,
  player                TEXT NOT NULL,
  player_key            TEXT NOT NULL,
  team_id               TEXT NOT NULL,
  team_name             TEXT NOT NULL,
  status                TEXT NOT NULL,  -- 'ConfirmedOut' | 'Doubtful' | 'Available' | 'NotRelevant'
  reason                TEXT NOT NULL DEFAULT '',
  confidence            TEXT NOT NULL DEFAULT '',
  evidence_level        INTEGER NOT NULL DEFAULT 0,
  source_url            TEXT NOT NULL,
  publisher             TEXT,
  supporting_quote      TEXT NOT NULL DEFAULT '',
  observed_date         TIMESTAMPTZ,
  affects_prediction    BOOLEAN NOT NULL DEFAULT FALSE,
  api_football_player_id BIGINT,
  position              TEXT NOT NULL DEFAULT 'Unknown',
  position_source       TEXT NOT NULL DEFAULT 'Unknown',
  position_matched_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_team_player ON availability_claims(team_id, player_key, status, source_url);

-- ---------------------------------------------------------------------------
-- prediction_snapshots
-- Source: OloraculoDbContext.Snapshots (PredictionSnapshot.cs)
-- kind: 'match' | 'tournament'
-- payload: full JSON of MatchPredictionResult or TournamentProjection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id                  SERIAL PRIMARY KEY,
  kind                TEXT NOT NULL DEFAULT 'match',
  fixture_id          TEXT REFERENCES fixtures(id),
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

CREATE INDEX IF NOT EXISTS idx_snapshots_kind_fixture ON prediction_snapshots(kind, fixture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_kind_batch   ON prediction_snapshots(kind, batch_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- prediction_evaluations
-- Source: OloraculoDbContext.Evaluations (PredictionEvaluation.cs)
-- Accuracy evaluation: predicted probabilities vs actual outcomes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_evaluations (
  id                      SERIAL PRIMARY KEY,
  model_name              TEXT NOT NULL,
  fixture_id              TEXT NOT NULL REFERENCES fixtures(id),
  home_team_id            TEXT NOT NULL,
  away_team_id            TEXT NOT NULL,
  home_goals              INTEGER NOT NULL,
  away_goals              INTEGER NOT NULL,
  home_win                DOUBLE PRECISION NOT NULL,
  draw                    DOUBLE PRECISION NOT NULL,
  away_win                DOUBLE PRECISION NOT NULL,
  actual                  TEXT NOT NULL,  -- 'Home' | 'Draw' | 'Away'
  brier_score             DOUBLE PRECISION NOT NULL,
  ranked_probability_score DOUBLE PRECISION NOT NULL,
  log_loss                DOUBLE PRECISION NOT NULL,
  top_pick_correct        BOOLEAN NOT NULL,
  predicted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evals_model ON prediction_evaluations(model_name);
CREATE INDEX IF NOT EXISTS idx_evals_fixture ON prediction_evaluations(fixture_id);

-- =============================================================================
-- Row Level Security
-- All tables are read-publicly, write via service-role key only
-- =============================================================================
ALTER TABLE teams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixtures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_contexts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_mappings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_claims   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_evaluations ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables (frontend can query them)
CREATE POLICY "public_read_teams"                 ON teams                  FOR SELECT USING (true);
CREATE POLICY "public_read_groups"                ON groups                 FOR SELECT USING (true);
CREATE POLICY "public_read_fixtures"              ON fixtures               FOR SELECT USING (true);
CREATE POLICY "public_read_match_results"         ON match_results          FOR SELECT USING (true);
CREATE POLICY "public_read_ratings"               ON ratings                FOR SELECT USING (true);
CREATE POLICY "public_read_fixture_contexts"      ON fixture_contexts       FOR SELECT USING (true);
CREATE POLICY "public_read_api_mappings"          ON api_mappings           FOR SELECT USING (true);
CREATE POLICY "public_read_availability_sources"  ON availability_sources   FOR SELECT USING (true);
CREATE POLICY "public_read_availability_claims"   ON availability_claims    FOR SELECT USING (true);
CREATE POLICY "public_read_prediction_snapshots"  ON prediction_snapshots   FOR SELECT USING (true);
CREATE POLICY "public_read_prediction_evaluations" ON prediction_evaluations FOR SELECT USING (true);

-- Writes require service-role key (Cloudflare Workers use this)
-- anon key = read-only, service key = read+write
CREATE POLICY "service_write_fixtures"             ON fixtures              FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_fixture_contexts"     ON fixture_contexts      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_api_mappings"         ON api_mappings          FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_availability_sources" ON availability_sources  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_availability_claims"  ON availability_claims   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_prediction_snapshots" ON prediction_snapshots  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_prediction_evaluations" ON prediction_evaluations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_ratings"              ON ratings               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_teams"                ON teams                 FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_groups"               ON groups                FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_match_results"        ON match_results         FOR ALL USING (auth.role() = 'service_role');
