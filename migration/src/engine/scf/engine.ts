// =============================================================================
// SCF — Sentido Común Futbolero scoring engine
// Combines heuristic signals weighted by category, classification, and bias.
//
// Category weights:  PLANTEL 25% · HISTORIA 20% · FORMA 20% · PSICOLOGIA 15%
//                    TORNEO  15% · LOCALIA   5%
//
// Classification multipliers: A=1.0 · B=0.8 · C=0.5 · D=0.2 · E=0.0
// Bias down-weight: × 0.3
// =============================================================================

import type {
  SCFHeuristic,
  SCFMatchContext,
  SCFResult,
  ActiveHeuristic,
  SCFCategoryBreakdown,
  SCFCategory,
} from '../../types/scf';
import { EVALUATORS } from './evaluators';

// ---------------------------------------------------------------------------
// Static fallback heuristic metadata (used when Supabase is unavailable)
// Must match IDs seeded in scf_heuristics table.
// ---------------------------------------------------------------------------
export const STATIC_HEURISTICS: SCFHeuristic[] = [
  // HISTORIA
  { id: 'h_defending_champ_falls',    name: 'El campeón cae temprano',             category: 'HISTORIA',   subcategory: null, frequency: 0.72, accuracy: 0.75, sample_size: 12, confidence: 'HIGH',   classification: 'A', roi_hypothetical: 0.18,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_big_dont_fail_twice',      name: 'Los grandes no fallan dos veces',      category: 'HISTORIA',   subcategory: null, frequency: 0.48, accuracy: 0.58, sample_size: 25, confidence: 'LOW',    classification: 'C', roi_hypothetical: 0.05,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_no_wc_without_scare',      name: 'Nadie sale sin sustos del Mundial',    category: 'HISTORIA',   subcategory: null, frequency: 0.85, accuracy: 0.90, sample_size: 80, confidence: 'HIGH',   classification: 'B', roi_hypothetical: 0.02,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_weight_of_jersey',         name: 'El peso de la camiseta',               category: 'HISTORIA',   subcategory: null, frequency: 0.65, accuracy: 0.52, sample_size: 40, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: -0.03, is_bias: true,  bias_notes: 'Equipos históricos son sistemáticamente sobre-apostados', description: '' },
  { id: 'h_subchampion_curse',        name: 'La maldición del subcampeón',          category: 'HISTORIA',   subcategory: null, frequency: 0.55, accuracy: 0.70, sample_size: 20, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.12,  is_bias: false, bias_notes: null, description: '' },
  // FORMA
  { id: 'h_tournament_streak',        name: 'La racha dentro del torneo',           category: 'FORMA',      subcategory: null, frequency: 0.78, accuracy: 0.63, sample_size: 60, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.09,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_blowout_bounce',           name: 'El rebote después de la paliza',       category: 'FORMA',      subcategory: null, frequency: 0.60, accuracy: 0.67, sample_size: 30, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.14,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_after_loss_unpredictable', name: 'Después de una derrota, todo puede ser', category: 'FORMA',   subcategory: null, frequency: 0.70, accuracy: 0.48, sample_size: 50, confidence: 'MEDIUM', classification: 'D', roi_hypothetical: -0.05, is_bias: true,  bias_notes: 'La impredecibilidad post-derrota no se sostiene en datos', description: '' },
  { id: 'h_dry_team_keeps_dry',       name: 'El equipo seco sigue seco',            category: 'FORMA',      subcategory: null, frequency: 0.50, accuracy: 0.55, sample_size: 35, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: 0.04,  is_bias: false, bias_notes: null, description: '' },
  // PLANTEL
  { id: 'h_star_player_matters',      name: 'El jugador de otro planeta hace la diferencia', category: 'PLANTEL', subcategory: null, frequency: 0.88, accuracy: 0.51, sample_size: 45, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: -0.02, is_bias: true, bias_notes: 'El impacto de un astro específico es muy variable; la comunidad lo sobrevalora', description: '' },
  { id: 'h_squad_depth_matters',      name: 'El banco gana torneos',                category: 'PLANTEL',    subcategory: null, frequency: 0.65, accuracy: 0.61, sample_size: 40, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.07,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_africans_surprise_groups', name: 'Los africanos siempre sorprenden en grupos', category: 'PLANTEL', subcategory: null, frequency: 0.72, accuracy: 0.42, sample_size: 55, confidence: 'MEDIUM', classification: 'D', roi_hypothetical: -0.08, is_bias: true, bias_notes: 'Generalización continental no validada; varía mucho por selección', description: '' },
  { id: 'h_europeans_grow_knockouts', name: 'Los europeos crecen en eliminatorias', category: 'PLANTEL',    subcategory: null, frequency: 0.68, accuracy: 0.66, sample_size: 50, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.10,  is_bias: false, bias_notes: null, description: '' },
  // TORNEO
  { id: 'h_host_advantage',           name: 'El local siempre tiene ventaja',       category: 'TORNEO',     subcategory: null, frequency: 0.90, accuracy: 0.78, sample_size: 20, confidence: 'HIGH',   classification: 'A', roi_hypothetical: 0.15,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_knockout_upset_window',    name: 'En eliminatorias las sorpresas se abren', category: 'TORNEO', subcategory: null, frequency: 0.75, accuracy: 0.55, sample_size: 64, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: 0.06,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_eliminated_plays_free',    name: 'El eliminado juega libre de presión',  category: 'TORNEO',     subcategory: null, frequency: 0.62, accuracy: 0.71, sample_size: 30, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.13,  is_bias: false, bias_notes: null, description: '' },
  // LOCALIA
  { id: 'h_climate_latin_advantage',  name: 'Los latinoamericanos se adaptan mejor al calor', category: 'LOCALIA', subcategory: null, frequency: 0.55, accuracy: 0.51, sample_size: 20, confidence: 'LOW', classification: 'C', roi_hypothetical: 0.01, is_bias: false, bias_notes: null, description: '' },
  { id: 'h_long_travel_fatigue',      name: 'El viaje largo cansa al equipo',       category: 'LOCALIA',    subcategory: null, frequency: 0.60, accuracy: 0.49, sample_size: 25, confidence: 'LOW',    classification: 'D', roi_hypothetical: -0.02, is_bias: false, bias_notes: null, description: '' },
  // PSICOLOGIA
  { id: 'h_revenge_factor',           name: 'La revancha histórica motiva al equipo', category: 'PSICOLOGIA', subcategory: null, frequency: 0.70, accuracy: 0.62, sample_size: 35, confidence: 'MEDIUM', classification: 'B', roi_hypothetical: 0.08, is_bias: false, bias_notes: null, description: '' },
  { id: 'h_overconfidence_kills',     name: 'La sobreconfianza mata al favorito',   category: 'PSICOLOGIA', subcategory: null, frequency: 0.68, accuracy: 0.68, sample_size: 45, confidence: 'MEDIUM', classification: 'A', roi_hypothetical: 0.16,  is_bias: true,  bias_notes: 'La comunidad detecta la sobreconfianza — funciona como señal contraria validada', description: '' },
  { id: 'h_debut_nerves',             name: 'Los nervios del debut mundialista',    category: 'PSICOLOGIA', subcategory: null, frequency: 0.60, accuracy: 0.59, sample_size: 30, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: 0.05,  is_bias: false, bias_notes: null, description: '' },
  { id: 'h_trap_game',                name: 'El "trap game": el grande cae ante el chico', category: 'PSICOLOGIA', subcategory: null, frequency: 0.65, accuracy: 0.54, sample_size: 40, confidence: 'MEDIUM', classification: 'C', roi_hypothetical: 0.04, is_bias: false, bias_notes: null, description: '' },
];

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const CATEGORY_WEIGHTS: Record<SCFCategory, number> = {
  PLANTEL:    0.25,
  HISTORIA:   0.20,
  FORMA:      0.20,
  PSICOLOGIA: 0.15,
  TORNEO:     0.15,
  LOCALIA:    0.05,
};

const CLASS_MULTIPLIER: Record<string, number> = {
  A: 1.0, B: 0.8, C: 0.5, D: 0.2, E: 0.0,
};

const BIAS_FACTOR = 0.3;

// ---------------------------------------------------------------------------
// Score → most likely scoreline
// Approach: weighted sample from historical WC scoreline pools, conditioned on
// the predicted outcome direction. Dominance modifies the margin distribution.
// A seeded RNG (fixture_id) provides deterministic per-match "gut feel" —
// the same fixture always gets the same scoreline, but each fixture is unique.
// ---------------------------------------------------------------------------

interface ScoreOption { home: number; away: number; w: number }

// Relative frequencies sourced from WC 2006–2022 match data, within each outcome bucket.
const HOME_WIN_POOL: ScoreOption[] = [
  { home: 1, away: 0, w: 34 },
  { home: 2, away: 0, w: 22 },
  { home: 2, away: 1, w: 20 },
  { home: 3, away: 0, w:  8 },
  { home: 3, away: 1, w:  7 },
  { home: 4, away: 0, w:  3 },
  { home: 3, away: 2, w:  4 },
  { home: 4, away: 1, w:  2 },
];

const DRAW_POOL: ScoreOption[] = [
  { home: 1, away: 1, w: 55 },
  { home: 0, away: 0, w: 35 },
  { home: 2, away: 2, w:  8 },
  { home: 3, away: 3, w:  2 },
];

const AWAY_WIN_POOL: ScoreOption[] = [
  { home: 0, away: 1, w: 34 },
  { home: 0, away: 2, w: 22 },
  { home: 1, away: 2, w: 20 },
  { home: 0, away: 3, w:  8 },
  { home: 1, away: 3, w:  7 },
  { home: 0, away: 4, w:  3 },
  { home: 2, away: 3, w:  4 },
  { home: 1, away: 4, w:  2 },
];

// Deterministic hash → [0,1) float. Fixture-specific "gut feel" that never
// changes for the same fixture_id, but varies meaningfully between fixtures.
function fixtureRng(fixtureId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < fixtureId.length; i++) {
    h ^= fixtureId.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // Second pass for better mixing
  h ^= h >>> 16;
  h = (h * 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function weightedSample(pool: ScoreOption[], weights: number[], rng: number): ScoreOption {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function scfMostLikelyScore(
  outcome: { homeWin: number; draw: number; awayWin: number },
  fixtureId: string,
): { home: number; away: number } | null {
  const { homeWin, draw, awayWin } = outcome;
  const max = Math.max(homeWin, draw, awayWin);
  if (max < 0.36) return null;

  const rng = fixtureRng(fixtureId);

  // Draw needs at least 0.30 probability
  if (draw === max && draw < 0.30) return null;

  let pool: ScoreOption[];
  let strength: number; // 0=neutral, 1=certain

  if (homeWin === max) {
    pool = HOME_WIN_POOL;
    strength = Math.max(0, Math.min(1, (homeWin - 0.33) / 0.42));
  } else if (awayWin === max) {
    pool = AWAY_WIN_POOL;
    strength = Math.max(0, Math.min(1, (awayWin - 0.33) / 0.42));
  } else {
    pool = DRAW_POOL;
    strength = Math.max(0, Math.min(1, (draw - 0.25) / 0.20));
  }

  // Dominance modifier: higher strength boosts larger-margin scorelines.
  // For draws: strength pushes toward 1-1 (more "action") over 0-0.
  const weights = pool.map(item => {
    const margin = Math.abs(item.home - item.away);
    const total = item.home + item.away;
    if (draw === max) {
      // More strength → prefer 1-1 and 2-2 over 0-0
      const goalsBoost = 1 + strength * total * 0.5;
      return Math.max(0.5, item.w * goalsBoost);
    }
    // More strength → prefer bigger winning margins
    const marginBoost = 1 + strength * (margin - 1) * 0.45;
    return Math.max(0.5, item.w * marginBoost);
  });

  const picked = weightedSample(pool, weights, rng);
  return { home: picked.home, away: picked.away };
}

// ---------------------------------------------------------------------------
// Score → outcome probabilities
// ---------------------------------------------------------------------------

export function scfScoreToOutcome(score: number): { homeWin: number; draw: number; awayWin: number } {
  const homeRaw = score / 100;
  const awayRaw = 1 - homeRaw;
  const drawAdj = 0.27 * (1 - Math.abs(homeRaw - awayRaw) * 0.8);
  const remaining = 1 - drawAdj;
  return {
    homeWin: remaining * homeRaw,
    draw: drawAdj,
    awayWin: remaining * awayRaw,
  };
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function computeSCFScore(
  ctx: SCFMatchContext,
  heuristics: SCFHeuristic[],
): SCFResult {
  const activeHeuristics: ActiveHeuristic[] = [];
  const categorySignals: Map<SCFCategory, number[]> = new Map();
  let biasCount = 0;

  for (const h of heuristics) {
    const evalFn = EVALUATORS[h.id];
    if (!evalFn) continue;

    const signal = evalFn(ctx);
    if (!signal.applies || signal.strength < 0.01) continue;

    const classMult = CLASS_MULTIPLIER[h.classification] ?? 0;
    const biasMult  = h.is_bias ? BIAS_FACTOR : 1.0;
    const weight    = classMult * biasMult * signal.strength;

    if (weight < 0.01) continue;

    if (h.is_bias) biasCount++;

    activeHeuristics.push({
      id: h.id,
      name: h.name,
      category: h.category,
      direction: signal.direction,
      strength: signal.strength,
      weight,
      isBias: h.is_bias,
      note: signal.note,
    });

    const arr = categorySignals.get(h.category) ?? [];
    // Each signal is: direction * weight (can be positive or negative)
    arr.push(signal.direction * weight);
    categorySignals.set(h.category, arr);
  }

  // Build per-category breakdown
  const categoryBreakdown: SCFCategoryBreakdown[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [cat, catWeight] of Object.entries(CATEGORY_WEIGHTS) as [SCFCategory, number][]) {
    const signals = categorySignals.get(cat) ?? [];
    const totalCatWeight = activeHeuristics
      .filter(h => h.category === cat)
      .reduce((s, h) => s + h.weight, 0);

    let catScore = 0;
    if (totalCatWeight > 0) {
      catScore = signals.reduce((s, v) => s + v, 0) / totalCatWeight;
    }

    categoryBreakdown.push({
      category: cat,
      score: catScore,
      activeCount: activeHeuristics.filter(h => h.category === cat && !h.isBias).length,
      biasCount:   activeHeuristics.filter(h => h.category === cat && h.isBias).length,
    });

    if (totalCatWeight > 0) {
      weightedScore += catScore * catWeight;
      totalWeight += catWeight;
    }
  }

  // Map weighted direction score (-1..+1) to SCF scale (0..100)
  const rawDirection = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const scfScore = Math.max(0, Math.min(100, 50 + rawDirection * 50));

  const topHeuristics = [...activeHeuristics]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  // Confidence based on number of active (non-bias) heuristics and their classifications
  const nonBiasActive = activeHeuristics.filter(h => !h.isBias).length;
  const confidence = Math.min(0.95, nonBiasActive > 0 ? 0.3 + (nonBiasActive / 8) * 0.65 : 0.15);

  const degraded = activeHeuristics.length === 0;

  // Map category weights to result fields
  const catMap = new Map(categoryBreakdown.map(c => [c.category, c]));
  const catHasActive = (cat: SCFCategory) => (catMap.get(cat)?.activeCount ?? 0) > 0;

  return {
    fixture_id: ctx.fixture.id,
    home_team_id: ctx.fixture.home_team_id,
    away_team_id: ctx.fixture.away_team_id,
    scf_score: Math.round(scfScore * 10) / 10,
    outcome: scfScoreToOutcome(scfScore),
    mostLikelyScore: scfMostLikelyScore(scfScoreToOutcome(scfScore), ctx.fixture.id),
    historical_weight:        catHasActive('HISTORIA')   ? CATEGORY_WEIGHTS.HISTORIA   : 0,
    squad_weight:             catHasActive('PLANTEL')    ? CATEGORY_WEIGHTS.PLANTEL     : 0,
    momentum_weight:          catHasActive('FORMA')      ? CATEGORY_WEIGHTS.FORMA       : 0,
    psychology_weight:        catHasActive('PSICOLOGIA') ? CATEGORY_WEIGHTS.PSICOLOGIA  : 0,
    collective_belief_weight: catHasActive('TORNEO')     ? CATEGORY_WEIGHTS.TORNEO      : 0,
    top_heuristics: topHeuristics,
    category_breakdown: categoryBreakdown,
    confidence,
    bias_count: biasCount,
    degraded,
  };
}
