// Supabase client — only mutable tables that need persistence.
// Static data (teams, groups, fixtures, ratings, historical results)
// comes from JSON files via static-data.ts, not from here.

import { createClient } from '@supabase/supabase-js';
import type {
  FixtureContext,
  PredictionSnapshot,
  PredictionEvaluation,
  WcActualResult,
} from '../types/domain';

const SUPABASE_URL  = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://placeholder.supabase.co';
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'placeholder-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---------------------------------------------------------------------------
// FixtureContexts — user-input injury / context notes per fixture
// ---------------------------------------------------------------------------

export async function loadAllFixtureContexts(): Promise<FixtureContext[]> {
  const { data, error } = await supabase.from('fixture_contexts').select('*');
  if (error) throw error;
  return data ?? [];
}

export async function upsertFixtureContext(
  ctx: Omit<FixtureContext, 'updated_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('fixture_contexts')
    .upsert({ ...ctx, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// PredictionSnapshots — saved match / tournament predictions
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
  meta: { modelName: string; inputSummaryHash: string },
): Promise<PredictionSnapshot> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .insert({
      kind: 'tournament',
      model_name: meta.modelName,
      input_summary_hash: meta.inputSummaryHash,
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
  return data ?? [];
}

export async function loadTournamentSnapshots(): Promise<PredictionSnapshot[]> {
  const { data, error } = await supabase
    .from('prediction_snapshots')
    .select('*')
    .eq('kind', 'tournament')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// WC Actual Results — real match scores (entered by user during tournament)
// ---------------------------------------------------------------------------

export async function loadWcActualResults(): Promise<WcActualResult[]> {
  const { data, error } = await supabase
    .from('wc_actual_results')
    .select('*')
    .order('played_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveWcActualResult(
  result: Omit<WcActualResult, 'id' | 'played_at'>,
): Promise<WcActualResult> {
  const { data, error } = await supabase
    .from('wc_actual_results')
    .upsert({ ...result, played_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// PredictionEvaluations — accuracy metrics (computed after real results)
// ---------------------------------------------------------------------------

export async function saveEvaluation(
  evaluation: Omit<PredictionEvaluation, 'id' | 'predicted_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('prediction_evaluations')
    .insert({ ...evaluation, predicted_at: new Date().toISOString() });
  if (error) throw error;
}

export async function loadEvaluations(): Promise<PredictionEvaluation[]> {
  const { data, error } = await supabase
    .from('prediction_evaluations')
    .select('*')
    .order('predicted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
