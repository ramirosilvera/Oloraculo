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

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const hasSupabase   = SUPABASE_URL && !SUPABASE_URL.includes('placeholder');

const MIN_MATCHES      = 5;     // minimum WC results before calibrating
const DRIFT_THRESHOLD  = 0.03;  // minimum change in BOOST to trigger a write
const HISTORICAL_AVG   = 1.25;  // historical WC avg goals per team slot (2.50/2)
const FALLBACK_DRAW_P  = 0.22;  // fallback when no L6 snapshots available

const FIXTURES_FILE  = join(__dirname, '..', 'public', 'data', 'fixtures.json');
const MOMENTUM_FILE  = join(__dirname, '..', 'src', 'engine', 'models', 'tournament-momentum.ts');

async function main() {
  console.log('=== Calibración de Momentum del Mundial (L6) ===');
  console.log(`Fecha: ${new Date().toISOString().slice(0, 10)}`);

  // ── 1. Load actual results from fixtures.json ──────────────────────────────
  if (!existsSync(FIXTURES_FILE)) {
    console.error(`No se encontró ${FIXTURES_FILE}`);
    process.exit(1);
  }

  const fixtures = JSON.parse(readFileSync(FIXTURES_FILE, 'utf8'));
  const played = fixtures.filter(
    f => f.is_played === true && f.home_goals != null && f.away_goals != null,
  );

  const n = played.length;
  console.log(`\nPartidos jugados en fixtures.json: ${n}`);

  if (n < MIN_MATCHES) {
    console.log(`Mínimo ${MIN_MATCHES} resultados requeridos. Saliendo.`);
    process.exit(0);
  }

  // ── 2. Goal inflation ──────────────────────────────────────────────────────
  const totalGoals  = played.reduce((s, f) => s + f.home_goals + f.away_goals, 0);
  const avgPerMatch = totalGoals / n;
  const avgPerTeam  = totalGoals / (n * 2);
  const inflation   = +(avgPerTeam / HISTORICAL_AVG).toFixed(3);

  console.log(`Goles: ${totalGoals} en ${n} partidos = ${avgPerMatch.toFixed(2)}/pdo`);
  console.log(`Inflación goleadora: ×${inflation.toFixed(3)}`);

  // ── 3. Actual draw rate ────────────────────────────────────────────────────
  const drawCount      = played.filter(f => f.home_goals === f.away_goals).length;
  const actualDrawRate = drawCount / n;
  console.log(`Empates: ${drawCount}/${n} = ${(actualDrawRate * 100).toFixed(1)}%`);

  // ── 4. Model P(draw) from Supabase L6 snapshots (optional) ────────────────
  let modelDrawProb = FALLBACK_DRAW_P;
  let snapshotCount = 0;

  if (hasSupabase) {
    try {
      const supabase    = createClient(SUPABASE_URL, SUPABASE_ANON);
      const fixtureIds  = played.map(f => f.id);
      const { data: snaps, error } = await supabase
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
  } else {
    console.log('Sin credenciales Supabase — usando fallback P(draw).');
  }

  // ── 5. Draw bias → suggested BOOST ────────────────────────────────────────
  //
  // Positive drawBias = model predicts too few draws → momentum too aggressive.
  // Formula calibrated against 19 WC2026 results:
  //   drawBias=+20% → suggestedBoost = 0.48 × (1 − 0.20×2.0) = 0.28
  const drawBias    = actualDrawRate - modelDrawProb;
  const biasSign    = drawBias > 0 ? '+' : '';
  console.log(`\nDraw bias: ${biasSign}${(drawBias * 100).toFixed(1)}% (actual - modelo)`);

  const source       = readFileSync(MOMENTUM_FILE, 'utf8');
  const boostMatch   = source.match(/^const BASE_BOOST = ([\d.]+);/m);
  const currentBoost = boostMatch ? parseFloat(boostMatch[1]) : 0.28;

  const rawSuggested   = currentBoost * (1 - drawBias * 2.0);
  const suggestedBoost = Math.round(Math.max(0.10, Math.min(0.80, rawSuggested)) * 100) / 100;
  const drift          = Math.abs(suggestedBoost - currentBoost);

  console.log(`BASE_BOOST actual:   ${currentBoost}`);
  console.log(`BASE_BOOST sugerido: ${suggestedBoost}`);
  console.log(`Drift:               ${drift.toFixed(3)} (umbral ${DRIFT_THRESHOLD})`);

  // ── 6. Summary report (always printed) ───────────────────────────────────
  console.log('\n--- Resumen ---');
  console.log(`Partidos analizados:  ${n}`);
  console.log(`Goles/partido:        ${avgPerMatch.toFixed(2)} (histórico 2.50)`);
  console.log(`Inflación:            ×${inflation.toFixed(3)}`);
  console.log(`Empates reales:       ${(actualDrawRate * 100).toFixed(1)}%`);
  console.log(`Empates modelo (L6):  ${(modelDrawProb * 100).toFixed(1)}%`);
  console.log(`Draw bias:            ${biasSign}${(drawBias * 100).toFixed(1)}%`);

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
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
