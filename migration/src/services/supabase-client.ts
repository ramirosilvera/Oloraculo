// =============================================================================
// Oloráculo — Supabase client + typed data access layer
// Replaces: OloraculoDbContext.cs + all EF Core queries
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import type {
  Team,
  Group,
  Fixture,
  MatchResult,
  Rating,
  FixtureContext,
  AvailabilityClaim,
  PredictionSnapshot,
  PredictionEvaluation,
} from '../types/domain';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---------------------------------------------------------------------------
// Read-only data loaders (replaces OnInitializedAsync DB queries)
// ---------------------------------------------------------------------------

export async function loadAllTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from('teams').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function loadAllGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from('groups').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function loadAllFixtures(): Promise<Fixture[]> {
  const { data, error } = await supabase
    .from('fixtures')
    .select('*')
    .order('group_name')
    .order('id');
  if (error) throw error;
  return data;
}

export async function loadAllResults(): Promise<MatchResult[]> {
  const { data, error } = await supabase
    .from('match_results')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadAllRatings(): Promise<Rating[]> {
  const { data, error } = await supabase.from('ratings').select('*').order('as_of', { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadAllFixtureContexts(): Promise<FixtureContext[]> {
  const { data, error } = await supabase.from('fixture_contexts').select('*');
  if (error) throw error;
  return data;
}

export async function loadAvailabilityClaimsForFixture(
  homeTeamId: string,
  awayTeamId: string,
): Promise<AvailabilityClaim[]> {
  const { data, error } = await supabase
    .from('availability_claims')
    .select('*')
    .in('team_id', [homeTeamId, awayTeamId])
    .neq('status', 'NotRelevant');
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Snapshot operations (replaces SnapshotService.cs)
// ---------------------------------------------------------------------------

export async function saveMatchSnapshot(
  fixtureId: string,
  prediction: unknown,
  meta: { modelName: string; homeWin: number; draw: number; awayWin: number; explanation: string },
): Promise<PredictionSnapshot> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .insert({
      kind: 'match',
      fixture_id: fixtureId,
      model_name: meta.modelName,
      home_win: meta.homeWin,
      draw: meta.draw,
      away_win: meta.awayWin,
      explanation: meta.explanation,
      payload: prediction,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveTournamentSnapshot(
  projection: unknown,
  meta: { modelName: string; inputSummaryHash: string; batchId?: number },
): Promise<PredictionSnapshot> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .insert({
      kind: 'tournament',
      model_name: meta.modelName,
      input_summary_hash: meta.inputSummaryHash,
      batch_id: meta.batchId,
      payload: projection,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function loadMatchSnapshots(fixtureId: string): Promise<PredictionSnapshot[]> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .select('*')
    .eq('kind', 'match')
    .eq('fixture_id', fixtureId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadTournamentSnapshots(): Promise<PredictionSnapshot[]> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .select('*')
    .eq('kind', 'tournament')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Evaluation operations (replaces EvaluationService.cs)
// ---------------------------------------------------------------------------

export async function saveEvaluation(
  evaluation: Omit<PredictionEvaluation, 'id' | 'predicted_at'>,
): Promise<void> {
  const { error } = await supabase.from('prediction_evaluations').insert(evaluation);
  if (error) throw error;
}

export async function loadEvaluations(): Promise<PredictionEvaluation[]> {
  const { data, error } = await supabase
    .from('prediction_evaluations')
    .select('*')
    .order('predicted_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Stats for Home page (replaces Db.Teams.CountAsync() etc.)
// ---------------------------------------------------------------------------

export async function loadDashboardStats(): Promise<{
  teams: number;
  fixtures: number;
  results: number;
}> {
  const [teamsResp, fixturesResp, resultsResp] = await Promise.all([
    supabase.from('teams').select('id', { count: 'exact', head: true }),
    supabase.from('fixtures').select('id', { count: 'exact', head: true }),
    supabase.from('match_results').select('id', { count: 'exact', head: true }),
  ]);

  return {
    teams:    teamsResp.count   ?? 0,
    fixtures: fixturesResp.count ?? 0,
    results:  resultsResp.count  ?? 0,
  };
}
