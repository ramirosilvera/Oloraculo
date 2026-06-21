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
    .upsert(
      { ...result, played_at: new Date().toISOString() },
      { onConflict: 'fixture_id' },
    )
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

/** Bulk insert evaluation rows (used by the recompute / refresh flow). */
export async function saveEvaluations(
  evaluations: Omit<PredictionEvaluation, 'id' | 'predicted_at'>[],
): Promise<void> {
  if (evaluations.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('prediction_evaluations')
    .insert(evaluations.map(e => ({ ...e, predicted_at: now })));
  if (error) throw error;
}

/** Delete all evaluation rows for the given fixtures (recompute clears stale rows first). */
export async function deleteEvaluationsForFixtures(fixtureIds: string[]): Promise<void> {
  if (fixtureIds.length === 0) return;
  const { error } = await supabase
    .from('prediction_evaluations')
    .delete()
    .in('fixture_id', fixtureIds);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// App Events — generic signals (e.g. KNOCKOUT_ACTIVATION_REQUESTED)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Match Goals — goal scorer data populated by the update-goal-scorers Edge Fn
// ---------------------------------------------------------------------------

export interface MatchGoal {
  id:          number;
  fixture_id:  string;
  team_id:     string;
  player_name: string;
  minute:      number | null;
  goal_type:   'normal' | 'penalty' | 'own_goal';
}

export async function loadAllMatchGoals(): Promise<MatchGoal[]> {
  const { data, error } = await supabase
    .from('match_goals')
    .select('*')
    .order('fixture_id')
    .order('minute', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Gemini Analysis — calls the gemini-analysis Edge Function with condensed
// snapshot data and returns a markdown string.
// ---------------------------------------------------------------------------
export interface GeminiCondensedSnapshot {
  fecha:        string;
  simulaciones: number;
  top15: {
    equipo:    string;
    grupo:     string;
    clasifica: number;
    semis:     number;
    final:     number;
    campeon:   number;
  }[];
}

export async function callGeminiAnalysis(
  snapshots: GeminiCondensedSnapshot[],
): Promise<string> {
  const res = await fetch('/api/gemini-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshots }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { analysis?: string };
  if (typeof data.analysis !== 'string') throw new Error('empty-response');
  return data.analysis;
}

export async function writeAppEvent(eventType: string, payload: unknown = {}): Promise<void> {
  const { error } = await supabase
    .from('app_events')
    .insert({ event_type: eventType, payload });
  if (error) throw error;
}

export async function checkPendingAppEvent(
  eventType: string,
): Promise<{ id: number; payload: unknown; created_at: string } | null> {
  const { data, error } = await supabase
    .from('app_events')
    .select('id, payload, created_at')
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as { id: number; payload: unknown; created_at: string } | null;
}
