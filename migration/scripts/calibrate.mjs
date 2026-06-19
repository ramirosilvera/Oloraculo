/**
 * calibrate.mjs — Daily calibration of BASE_BOOST in tournament-momentum.ts
 *
 * Reads actual WC2026 results from fixtures.json (source of truth — always
 * up-to-date) and compares against L6 prediction_snapshots in Supabase to
 * compute draw bias and adjust BASE_BOOST if drift exceeds DRIFT_THRESHOLD.
 *
 * Usage (from migration/):
 *   node scripts/calibrate.mjs
 *
 * Env vars for Supabase prediction_snapshots (optional — needed only for P(draw)):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present (local dev)
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL  ?? '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY ?? '';
const SUPABASE_ANON    = process.env.VITE_SUPABASE_ANON_KEY ?? '';
// Use service role if available (bypasses RLS, needed for prediction_evaluations)
const SUPABASE_KEY  = SUPABASE_SERVICE || SUPABASE_ANON;
const hasSupabase   = SUPABASE_URL && !SUPABASE_URL.includes('placeholder');

const MIN_MATCHES          = 5;    // minimum WC results before calibrating inflation
const MIN_MATCHES_BOOST    = 15;   // minimum results needed to calibrate BOOST
const MIN_SNAPSHOTS_BOOST  = 8;    // minimum L6 snapshots needed to calibrate BOOST
const DRIFT_THRESHOLD      = 0.03; // minimum change in BOOST to trigger a write
const MAX_BOOST_CHANGE     = 0.04; // maximum BOOST change per calibration cycle
// 48-team WC format has more parity → expected ~28-30% draws (vs ~22% qualifiers)
const FALLBACK_DRAW_P      = 0.28; // fallback when no L6 snapshots available
const GOAL_SCALE           = 1.10; // must match goal-model.ts
const YEARS_WINDOW         = 8;    // must match prediction-engine.ts

const FIXTURES_FILE       = join(__dirname, '..', 'public', 'data', 'fixtures.json');
const RESULTS_FILE        = join(__dirname, '..', 'public', 'data', 'historical_results.json');
const MOMENTUM_FILE       = join(__dirname, '..', 'src', 'engine', 'models', 'tournament-momentum.ts');

/**
 * Compute the same avgGoals the engine uses (per-team average over 8-year window).
 * historical_results.json format: { cols: [...], rows: [[...], ...] }
 */
function computeHistoricalAvg() {
  if (!existsSync(RESULTS_FILE)) return 1.3671; // fallback if file not present
  const raw = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  const cols = raw.cols;
  const rows = raw.rows;

  // Find latest date
  const dateIdx = cols.indexOf('date');
  const hgIdx   = cols.indexOf('home_goals');
  const agIdx   = cols.indexOf('away_goals');

  let maxTime = 0;
  for (const r of rows) {
    const t = new Date(r[dateIdx]).getTime();
    if (t > maxTime) maxTime = t;
  }
  const cutoff = new Date(maxTime);
  cutoff.setFullYear(cutoff.getFullYear() - YEARS_WINDOW);

  let totalGoals = 0, count = 0;
  for (const r of rows) {
    if (new Date(r[dateIdx]).getTime() >= cutoff.getTime()) {
      totalGoals += r[hgIdx] + r[agIdx];
      count++;
    }
  }
  return count > 0 ? totalGoals / (count * 2) : 1.25;
}

async function main() {
  console.log('=== Calibración de Momentum del Mundial (L6) ===');
  console.log(`Fecha: ${new Date().toISOString().slice(0, 10)}`);

  // ── 0. Historical baseline (matches the engine exactly) ────────────────────
  const historicalAvg = computeHistoricalAvg();
  console.log(`\nBaseline histórico (8 años): ${historicalAvg.toFixed(4)} goles/equipo`);
  console.log(`Predicción base match neutro: ${(historicalAvg * GOAL_SCALE * 2).toFixed(2)} goles`);

  // ── 1. Load actual results — merge fixtures.json + Supabase wc_actual_results ─
  // Same merge logic as useAppData.ts: static first, Supabase overrides.
  // This ensures results entered via the app (→ Supabase) are always picked up.
  if (!existsSync(FIXTURES_FILE)) {
    console.error(`No se encontró ${FIXTURES_FILE}`);
    process.exit(1);
  }

  const fixtures = JSON.parse(readFileSync(FIXTURES_FILE, 'utf8'));

  // Create Supabase client once (reused for both wc_actual_results and snapshots)
  if (hasSupabase) {
    const keyType = SUPABASE_SERVICE ? 'service_role' : 'anon';
    console.log(`Supabase: ${keyType} key`);
  }
  const db = hasSupabase ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  // Start with static results from fixtures.json
  const playedMap = new Map();
  for (const f of fixtures) {
    if (f.is_played && f.home_goals != null && f.away_goals != null) {
      playedMap.set(f.id, { fixture_id: f.id, home_goals: f.home_goals, away_goals: f.away_goals });
    }
  }
  console.log(`\nPartidos en fixtures.json: ${playedMap.size}`);

  // Merge Supabase wc_actual_results (overrides static)
  if (db) {
    try {
      const { data: wcRows, error: wcErr } = await db
        .from('wc_actual_results')
        .select('fixture_id, home_goals, away_goals');
      if (!wcErr && wcRows && wcRows.length > 0) {
        for (const r of wcRows) playedMap.set(r.fixture_id, r);
        console.log(`Partidos en Supabase wc_actual_results: ${wcRows.length}`);
      } else if (wcErr) {
        console.log(`Supabase wc_actual_results no disponible: ${wcErr.message}`);
      }
    } catch {
      console.log('Supabase no accesible — usando solo fixtures.json.');
    }
  }

  const played = [...playedMap.values()];
  const n = played.length;
  console.log(`Total partidos combinados: ${n}`);

  if (n < MIN_MATCHES) {
    console.log(`Mínimo ${MIN_MATCHES} resultados requeridos. Saliendo.`);
    process.exit(0);
  }

  // ── 2. Goal inflation ──────────────────────────────────────────────────────
  const totalGoals  = played.reduce((s, f) => s + f.home_goals + f.away_goals, 0);
  const avgPerMatch = totalGoals / n;
  const avgPerTeam  = totalGoals / (n * 2);
  const inflation   = +Math.max(0.5, Math.min(3.0, avgPerTeam / historicalAvg)).toFixed(3);

  // Outlier analysis (matches with ≥5 goals are blowouts)
  const outliers = played.filter(f => f.home_goals + f.away_goals >= 5);
  const normal   = played.filter(f => f.home_goals + f.away_goals < 5);
  const normalGoals = normal.reduce((s, f) => s + f.home_goals + f.away_goals, 0);
  const inflationWithout = normal.length > 0
    ? +Math.max(0.5, Math.min(3.0, normalGoals / (normal.length * 2) / historicalAvg)).toFixed(3)
    : 1.0;

  console.log(`Goles: ${totalGoals} en ${n} partidos = ${avgPerMatch.toFixed(2)}/pdo`);
  console.log(`Inflación goleadora: ×${inflation.toFixed(3)}`);
  console.log(`Partidos outlier (≥5 goles): ${outliers.length} → sin ellos inflación ×${inflationWithout.toFixed(3)}`);
  console.log(`Impacto sobre match neutro: ${(historicalAvg * GOAL_SCALE * 2).toFixed(2)} → ${(historicalAvg * GOAL_SCALE * 2 * inflation).toFixed(2)} goles`);

  // ── 3. Actual draw rate ────────────────────────────────────────────────────
  const drawCount      = played.filter(f => f.home_goals === f.away_goals).length;
  const actualDrawRate = drawCount / n;
  console.log(`Empates: ${drawCount}/${n} = ${(actualDrawRate * 100).toFixed(1)}%`);

  // ── 4. Model P(draw) from Supabase L6 snapshots (optional) ────────────────
  let modelDrawProb = FALLBACK_DRAW_P;
  let snapshotCount = 0;

  if (db) {
    try {
      const fixtureIds  = played.map(f => f.fixture_id);
      const { data: snaps, error } = await db
        .from('prediction_snapshots')
        .select('fixture_id, draw')
        .eq('kind', 'match')
        .eq('model_name', 'Momentum del Mundial')
        .in('fixture_id', fixtureIds);

      if (!error && snaps && snaps.length > 0) {
        snapshotCount = snaps.length;
        modelDrawProb = snaps.reduce((s, snap) => s + (snap.draw ?? 0), 0) / snaps.length;
        console.log(`Snapshots L6 encontrados: ${snapshotCount}`);
        console.log(`P(draw) promedio del modelo: ${(modelDrawProb * 100).toFixed(1)}%`);
      } else {
        console.log(`Sin snapshots L6 (usando fallback P(draw)=${(FALLBACK_DRAW_P * 100).toFixed(0)}%)`);
      }
    } catch {
      console.log('Supabase no disponible — usando fallback P(draw).');
    }
  } else if (!hasSupabase) {
    console.log('Sin credenciales Supabase — usando fallback P(draw).');
  }

  // ── 5. Draw bias → suggested BOOST ────────────────────────────────────────
  //
  // Positive drawBias = model predicts too few draws → momentum too aggressive.
  // Formula: suggestedBoost = currentBoost × (1 − drawBias × 2.0)
  const drawBias    = actualDrawRate - modelDrawProb;
  const biasSign    = drawBias > 0 ? '+' : '';
  console.log(`\nDraw bias: ${biasSign}${(drawBias * 100).toFixed(1)}% (actual - modelo)`);

  const source       = readFileSync(MOMENTUM_FILE, 'utf8');
  const boostMatch   = source.match(/^const BASE_BOOST = ([\d.]+);/m);
  const currentBoost = boostMatch ? parseFloat(boostMatch[1]) : 0.22;

  // Cap change per cycle to prevent over-correction; prioritize real snapshots
  const rawSuggested     = currentBoost * (1 - drawBias * 2.0);
  const clampedSuggested = Math.max(0.10, Math.min(0.80, rawSuggested));
  const cappedSuggested  = currentBoost + Math.max(-MAX_BOOST_CHANGE, Math.min(MAX_BOOST_CHANGE, clampedSuggested - currentBoost));
  const suggestedBoost   = Math.round(cappedSuggested * 100) / 100;
  const drift            = Math.abs(suggestedBoost - currentBoost);

  const hasEnoughData    = n >= MIN_MATCHES_BOOST;
  const hasEnoughSnaps   = snapshotCount >= MIN_SNAPSHOTS_BOOST;
  const canCalibrateBoost = hasEnoughData || hasEnoughSnaps;

  console.log(`BASE_BOOST actual:   ${currentBoost}`);
  console.log(`BASE_BOOST sugerido: ${suggestedBoost} (cap ±${MAX_BOOST_CHANGE})`);
  console.log(`Drift:               ${drift.toFixed(3)} (umbral ${DRIFT_THRESHOLD})`);
  console.log(`Datos suficientes:   ${n}/${MIN_MATCHES_BOOST} partidos, ${snapshotCount}/${MIN_SNAPSHOTS_BOOST} snapshots → ${canCalibrateBoost ? 'SÍ' : 'NO'}`);

  // ── 6. Summary report (always printed) ───────────────────────────────────
  console.log('\n--- Resumen ---');
  console.log(`Partidos analizados:      ${n} (outliers ≥5 goles: ${outliers.length})`);
  console.log(`Goles/partido:            ${avgPerMatch.toFixed(2)} (base histórica: ${(historicalAvg*2).toFixed(2)})`);
  console.log(`Inflación (vs engine):    ×${inflation.toFixed(3)}`);
  console.log(`Match neutro estimado:    ${(historicalAvg * GOAL_SCALE * 2 * inflation).toFixed(2)} goles`);
  console.log(`Empates reales:           ${(actualDrawRate * 100).toFixed(1)}%`);
  console.log(`Empates modelo (L6):      ${(modelDrawProb * 100).toFixed(1)}%`);
  console.log(`Draw bias:                ${biasSign}${(drawBias * 100).toFixed(1)}%`);

  if (!canCalibrateBoost) {
    console.log(`\nInsuficientes datos para calibrar BOOST (necesita ${MIN_MATCHES_BOOST} partidos o ${MIN_SNAPSHOTS_BOOST} snapshots). Sin cambios.`);
    process.exit(0);
  }

  if (drift < DRIFT_THRESHOLD) {
    console.log(`\nDrift ${drift.toFixed(3)} < ${DRIFT_THRESHOLD}. BOOST calibrado — sin cambios.`);
    process.exit(0);
  }

  // ── 7. Update source file ──────────────────────────────────────────────────
  const direction = suggestedBoost < currentBoost ? 'reduciendo' : 'aumentando';
  console.log(`\nActualizando BASE_BOOST ${currentBoost} → ${suggestedBoost} (${direction})...`);

  const updated = source.replace(
    /^const BASE_BOOST = [\d.]+;/m,
    `const BASE_BOOST = ${suggestedBoost};`,
  );
  writeFileSync(MOMENTUM_FILE, updated, 'utf8');
  console.log(`Guardado: ${MOMENTUM_FILE}`);
  console.log('\n[CALIBRADO] El deploy se activará automáticamente al hacer commit.');

  // ── 8. Draw threshold grid search (requires prediction_evaluations) ─────────
  if (!db) { console.log('\n[THRESHOLD ANALYSIS] Sin Supabase — omitido.'); return; }

  console.log('\n=== Análisis de umbral de empate (grid search) ===');
  const { data: evals, error: evalErr } = await db
    .from('prediction_evaluations')
    .select('model_name,actual,home_win,draw,away_win');

  if (evalErr || !evals || evals.length === 0) {
    console.log('Sin evaluaciones en Supabase — corré "Recalcular evaluaciones" primero.');
    return;
  }
  console.log(`Evaluaciones cargadas: ${evals.length}`);

  // Outcome distribution
  const dist = { Home: 0, Draw: 0, Away: 0 };
  for (const e of evals) dist[e.actual] = (dist[e.actual] ?? 0) + 1;
  const total = evals.length;
  console.log(`\nDistribución de resultados reales:`);
  console.log(`  Local:    ${dist.Home}/${total} = ${(dist.Home/total*100).toFixed(1)}%`);
  console.log(`  Empate:   ${dist.Draw}/${total} = ${(dist.Draw/total*100).toFixed(1)}%`);
  console.log(`  Visitante:${dist.Away}/${total} = ${(dist.Away/total*100).toFixed(1)}%`);

  // topPick at a given threshold
  function pick(hw, dr, aw, thr) {
    const best = Math.max(hw, aw);
    if (best - dr < thr) return 'Draw';
    return hw >= aw ? 'Home' : 'Away';
  }

  // Grid search over thresholds
  const thresholds = [0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15];
  console.log('\nGrid search por umbral (todas las evaluaciones combinadas):');
  console.log('Umbral | Global%  | Local%   | Empate%  | Visit%   | Pred.Emp% | DrawF1');
  console.log('-------+----------+----------+----------+----------+-----------+-------');

  let bestThreshold = 0, bestF1 = -1;
  for (const thr of thresholds) {
    let correct = 0, drawPred = 0, drawHit = 0;
    const byActual = { Home: { c: 0, n: 0 }, Draw: { c: 0, n: 0 }, Away: { c: 0, n: 0 } };
    for (const e of evals) {
      const p = pick(e.home_win, e.draw, e.away_win, thr);
      const hit = p === e.actual;
      if (hit) correct++;
      byActual[e.actual].n++;
      if (hit) byActual[e.actual].c++;
      if (p === 'Draw') drawPred++;
      if (p === 'Draw' && e.actual === 'Draw') drawHit++;
    }
    const precision = drawPred > 0 ? drawHit / drawPred : 0;
    const recall    = dist.Draw > 0 ? drawHit / dist.Draw : 0;
    const f1        = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    if (f1 > bestF1) { bestF1 = f1; bestThreshold = thr; }
    const fmt = n => String(n).padStart(5);
    const pct = v => `${(v*100).toFixed(1)}%`.padStart(8);
    console.log(
      `  ${String(thr.toFixed(2)).padStart(4)} | ${pct(correct/total)} | ${pct(byActual.Home.c/Math.max(1,byActual.Home.n))} | ${pct(byActual.Draw.c/Math.max(1,byActual.Draw.n))} | ${pct(byActual.Away.c/Math.max(1,byActual.Away.n))} | ${pct(drawPred/total)} | ${f1.toFixed(3)}`
    );
  }
  console.log(`\n→ Mejor umbral por Draw-F1: ${bestThreshold} (F1=${bestF1.toFixed(3)})`);
  console.log(`  Umbral actual en el código: 0.04`);
  if (Math.abs(bestThreshold - 0.04) > 0.01) {
    console.log(`  ⚠ Diferencia significativa — considera actualizar DRAW_MARGIN_THRESHOLD en probability-helper.ts`);
  } else {
    console.log(`  ✓ Umbral actual óptimo o cercano al óptimo.`);
  }

  // Per-model breakdown at the best threshold
  console.log(`\nRendimiento por modelo con umbral=${bestThreshold}:`);
  const models = [...new Set(evals.map(e => e.model_name))];
  console.log('Modelo                       | N  | Global% | Empate% | DrawF1');
  console.log('-----------------------------+----+---------+---------+-------');
  for (const model of models) {
    const rows = evals.filter(e => e.model_name === model);
    const drawActual = rows.filter(r => r.actual === 'Draw').length;
    let correct = 0, drawPred = 0, drawHit = 0;
    for (const e of rows) {
      const p = pick(e.home_win, e.draw, e.away_win, bestThreshold);
      if (p === e.actual) correct++;
      if (p === 'Draw') drawPred++;
      if (p === 'Draw' && e.actual === 'Draw') drawHit++;
    }
    const prec = drawPred > 0 ? drawHit / drawPred : 0;
    const rec  = drawActual > 0 ? drawHit / drawActual : 0;
    const f1   = (prec + rec) > 0 ? 2*prec*rec/(prec+rec) : 0;
    const name = model.slice(0, 28).padEnd(28);
    console.log(`${name} | ${String(rows.length).padStart(2)} | ${(correct/rows.length*100).toFixed(1).padStart(6)}% | ${(drawHit/Math.max(1,drawActual)*100).toFixed(1).padStart(6)}% | ${f1.toFixed(3)}`);
  }
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
