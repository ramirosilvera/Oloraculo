import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchText } from '../_shared';

const TTL = 6 * 60 * 60 * 1000; // 6h
// FRED series → clave en macro_cache. Valores en % (ej. DGS10 = 4.3 → guardamos 4.3).
const SERIES: Record<string, string> = {
  DGS10: 'dgs10',            // Treasury 10Y (%)
  DGS3MO: 'dgs3mo',          // T-Bills 3M (%)
  BAMLH0A0HYM2: 'hy_spread', // High Yield OAS (%)
  VIXCLS: 'vix',             // CBOE VIX (nivel) — gratis en FRED (Finnhub free no da ^VIX)
  DTWEXBGS: 'dollar_index',  // Índice dólar amplio (nominal broad, base ene-2006=100)
};

// Last numeric value in a fredgraph CSV (skips "." missing markers).
function lastValue(csv: string): number | null {
  const lines = csv.trim().split('\n');
  for (let i = lines.length - 1; i >= 1; i--) {
    const parts = lines[i].split(',');
    const v = parseFloat(parts[1]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fred → { dgs10, dgs3mo, hy_spread }  (todo en %)
export const onRequestGet = guard(async ({ env }) => {
  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  await Promise.all(Object.entries(SERIES).map(async ([serie, clave]) => {
    const cached = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', clave, TTL);
    if (cached) { out[clave] = cached.valor; return; }
    try {
      const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${serie}`);
      const val = lastValue(csv);
      if (val != null) { out[clave] = val; rows.push({ clave, valor: val, updated_at: new Date().toISOString() }); }
      else out[clave] = (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', clave))?.valor ?? null;
    } catch {
      // Proveedor caído: servimos el último valor conocido (aunque esté vencido) en vez de vaciar.
      out[clave] = (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', clave))?.valor ?? null;
    }
  }));
  if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  return json(out);
});
