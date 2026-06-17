/**
 * calibrate.mjs — Daily calibration of BASE_BOOST in tournament-momentum.ts
 *
 * Queries Supabase for actual WC2026 results and saved L6 predictions,
 * computes draw bias, and updates BASE_BOOST if drift exceeds DRIFT_THRESHOLD.
 *
 * Usage (from migration/):
 *   node scripts/calibrate.mjs
 *
 * Env vars (from GitHub secrets or .env):
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

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder')) {
  console.error('ERROR: VITE_SUPABASE_URL no configurado.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const MIN_MATCHES      = 5;     // require at least this many WC results
const DRIFT_THRESHOLD  = 0.03;  // minimum change in BOOST to trigger a write
const HISTORICAL_AVG   = 1.25;  // historical WC avg goals per team slot (2.50 / 2)
const FALLBACK_DRAW_P  = 0.22;  // fallback if no L6 snapshots available

const MOMENTUM_FILE = join(__dirname, '..', 'src', 'engine', 'models', 'tournament-momentum.ts');

async function main() {
  console.log('=== Calibración de Momentum del Mundial (L6) ===');
  console.log(`Fecha: ${new Date().toISOString().slice(0, 10)}`);

  // ── 1. Fetch actual WC results ─────────────────────────────────────────────
  const { data: wcResults, error: e1 } = await supabase
    .from('wc_actual_results')
    .select('*')
    .order('played_at', { ascending: true });

  if (e1) {
    console.error('Error al cargar wc_actual_results:', e1.message);
    process.exit(1);
  }

  const n = (wcResults ?? []).length;
  console.log(`\nResultados WC cargados: ${n}`);

  if (n < MIN_MATCHES) {
    console.log(`Mínimo ${MIN_MATCHES} resultados requeridos para calibrar. Saliendo.`);
    process.exit(0);
  }

  // ── 2. Goal inflation ──────────────────────────────────────────────────────
  const totalGoals = wcResults.reduce((s, r) => s + r.home_goals + r.away_goals, 0);
  const avgPerMatch = totalGoals / n;
  const avgPerTeam  = totalGoals / (n * 2);
  const inflation   = +(avgPerTeam / HISTORICAL_AVG).toFixed(3);

  console.log(`Goles: ${totalGoals} en ${n} partidos = ${avgPerMatch.toFixed(2)}/pdo`);
  console.log(`Inflación goleadora: ×${inflation.toFixed(3)}`);

  // ── 3. Actual draw rate ────────────────────────────────────────────────────
  const drawCount    = wcResults.filter(r => r.home_goals === r.away_goals).length;
  const actualDrawRate = drawCount / n;
  console.log(`Empates: ${drawCount}/${n} = ${(actualDrawRate * 100).toFixed(1)}%`);

  // ── 4. Model P(draw) from L6 snapshots ────────────────────────────────────
  const fixtureIds = wcResults.map(r => r.fixture_id).filter(Boolean);
  let modelDrawProb = FALLBACK_DRAW_P;
  let snapshotCount = 0;

  if (fixtureIds.length > 0) {
    const { data: snaps, error: e2 } = await supabase
      .from('prediction_snapshots')
      .select('fixture_id, draw')
      .eq('kind', 'match')
      .eq('model_name', 'Momentum del Mundial')
      .in('fixture_id', fixtureIds);

    if (!e2 && snaps && snaps.length > 0) {
      snapshotCount  = snaps.length;
      modelDrawProb  = snaps.reduce((s, snap) => s + (snap.draw ?? 0), 0) / snaps.length;
      console.log(`Snapshots L6 encontrados: ${snapshotCount}`);
      console.log(`P(draw) promedio del modelo: ${(modelDrawProb * 100).toFixed(1)}%`);
    } else {
      console.log(`Sin snapshots L6 (usando fallback P(draw)=${(FALLBACK_DRAW_P * 100).toFixed(0)}%)`);
    }
  }

  // ── 5. Draw bias → suggested BOOST ────────────────────────────────────────
  //
  // Positive drawBias means the model predicted too few draws → BOOST too
  // aggressive (decisive wins are over-predicted). Scale down proportionally.
  // Formula validated against WC2026 data (N=19):
  //   drawBias=+20% → suggestedBoost = 0.48 × (1 - 0.20×2.0) = 0.28
  const drawBias = actualDrawRate - modelDrawProb;
  const biasSign = drawBias > 0 ? '+' : '';
  console.log(`\nDraw bias: ${biasSign}${(drawBias * 100).toFixed(1)}% (actual - modelo)`);

  const source       = readFileSync(MOMENTUM_FILE, 'utf8');
  const boostMatch   = source.match(/^const BASE_BOOST = ([\d.]+);/m);
  const currentBoost = boostMatch ? parseFloat(boostMatch[1]) : 0.28;

  const rawSuggested  = currentBoost * (1 - drawBias * 2.0);
  const suggestedBoost = Math.round(Math.max(0.10, Math.min(0.80, rawSuggested)) * 100) / 100;
  const drift          = Math.abs(suggestedBoost - currentBoost);

  console.log(`BASE_BOOST actual:   ${currentBoost}`);
  console.log(`BASE_BOOST sugerido: ${suggestedBoost}`);
  console.log(`Drift:               ${drift.toFixed(3)} (umbral ${DRIFT_THRESHOLD})`);

  if (drift < DRIFT_THRESHOLD) {
    console.log(`\nDrift ${drift.toFixed(3)} < ${DRIFT_THRESHOLD}. BOOST calibrado — sin cambios.`);
    process.exit(0);
  }

  // ── 6. Update source file ──────────────────────────────────────────────────
  const direction = suggestedBoost < currentBoost ? 'reduciendo' : 'aumentando';
  console.log(`\nActualizando BASE_BOOST ${currentBoost} → ${suggestedBoost} (${direction}, draw bias ${biasSign}${(drawBias * 100).toFixed(1)}%, N=${n})...`);

  const updated = source.replace(
    /^const BASE_BOOST = [\d.]+;/m,
    `const BASE_BOOST = ${suggestedBoost};`,
  );

  writeFileSync(MOMENTUM_FILE, updated, 'utf8');
  console.log(`Archivo actualizado: ${MOMENTUM_FILE}`);
  console.log('\n[CALIBRADO] El deploy se activará automáticamente al hacer commit.');
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
