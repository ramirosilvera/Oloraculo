// =============================================================================
// SCF — Supabase service
// Loads heuristics from scf_heuristics table; saves predictions to
// scf_match_predictions (upsert by fixture_id).
// Falls back to static heuristics when Supabase is unreachable.
// =============================================================================

import { supabase } from './supabase-client';
import type { SCFHeuristic, SCFResult } from '../types/scf';
import { STATIC_HEURISTICS } from '../engine/scf/engine';

export async function loadSCFHeuristics(): Promise<SCFHeuristic[]> {
  try {
    const { data, error } = await supabase
      .from('scf_heuristics')
      .select('id, name, description, category, subcategory, frequency, accuracy, sample_size, confidence, classification, roi_hypothetical, is_bias, bias_notes')
      .order('category')
      .order('name');
    if (error || !data || data.length === 0) return STATIC_HEURISTICS;
    return data as SCFHeuristic[];
  } catch {
    return STATIC_HEURISTICS;
  }
}

export async function saveSCFPrediction(result: SCFResult): Promise<void> {
  try {
    const { error } = await supabase.from('scf_match_predictions').upsert(
      {
        fixture_id:               result.fixture_id,
        home_team_id:             result.home_team_id,
        away_team_id:             result.away_team_id,
        scf_score:                result.scf_score,
        historical_weight:        result.historical_weight,
        squad_weight:             result.squad_weight,
        momentum_weight:          result.momentum_weight,
        psychology_weight:        result.psychology_weight,
        collective_belief_weight: result.collective_belief_weight,
        top_heuristic_ids:        result.top_heuristics.map(h => h.id),
        confidence:               result.confidence,
        bias_count:               result.bias_count,
        raw_breakdown:            result.category_breakdown,
        updated_at:               new Date().toISOString(),
      },
      { onConflict: 'fixture_id' },
    );
    if (error) console.warn('[SCF] save prediction error:', error.message);
  } catch (e) {
    console.warn('[SCF] save prediction failed:', e);
  }
}
