import { type Env, json, preflight, guard, cacheFresh, sbUpsert, fetchJson } from '../_shared';

const TTL = 20 * 60 * 1000; // 20 min

// Indicadores de mercado para los semáforos macro. Se escriben en macro_cache con las MISMAS
// claves que espera engine/semaforos.ts. Fuentes gratuitas (Finnhub). Donde no hay un dato
// directo gratis, se usa un proxy DOCUMENTADO (SPY ≈ S&P500/10, GLD ≈ onza de oro/10) — nunca
// un número inventado. Si una fuente no responde, la clave queda en null (el dashboard muestra —).

async function finnhub(env: Env, symbol: string): Promise<number | null> {
  if (!env.FINNHUB_API_KEY) return null;
  try {
    const q = await fetchJson<{ c?: number }>(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${env.FINNHUB_API_KEY}`);
    return q.c && q.c > 0 ? q.c : null;
  } catch { return null; }
}

// Precio actual de un símbolo vía el chart de Yahoo Finance (gratis, sin auth). Server-side no hay
// CORS. Se manda User-Agent porque Yahoo rechaza requests sin él.
async function yahooPrice(symbol: string): Promise<number | null> {
  try {
    const j = await fetchJson<{ chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } }>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch { return null; }
}

// Merval en USD = índice Merval en pesos (Yahoo ^MERV) ÷ dólar CCL (o MEP) ya cacheado.
async function mervalUsd(env: Env): Promise<number | null> {
  const pesos = await yahooPrice('^MERV');
  if (pesos == null) return null;
  const SEIS_H = 6 * 60 * 60 * 1000;
  const ccl = (await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_ccl', SEIS_H))?.valor
    ?? (await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', SEIS_H))?.valor;
  return ccl && ccl > 0 ? Math.round(pesos / ccl) : null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/indicadores → { adr_ypf, bitcoin, sp500, oro, vix }  (para los semáforos)
export const onRequestGet = guard(async ({ env }) => {
  const out: Record<string, number | null> = {};
  const CLAVES = ['adr_ypf', 'bitcoin', 'sp500', 'oro', 'merval_usd', 'dollar_index']; // vix lo provee FRED

  // Cache: devolvemos lo fresco, pedimos solo lo vencido.
  const stale: string[] = [];
  for (const c of CLAVES) {
    const hit = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', c, TTL);
    if (hit) out[c] = hit.valor; else stale.push(c);
  }

  if (stale.length) {
    const fuente: Record<string, () => Promise<number | null>> = {
      adr_ypf: () => finnhub(env, 'YPF'),                 // ADR de YPF (cotiza en NYSE)
      bitcoin: () => finnhub(env, 'BINANCE:BTCUSDT'),     // BTC spot
      sp500:   async () => { const spy = await finnhub(env, 'SPY'); return spy != null ? Math.round(spy * 10) : null; },
      oro:     async () => { const gld = await finnhub(env, 'GLD'); return gld != null ? Math.round(gld * 10) : null; },
      merval_usd: () => mervalUsd(env),
      dollar_index: async () => { const d = await yahooPrice('DX-Y.NYB'); return d != null ? +d.toFixed(2) : null; }, // DXY real (ICE)
    };
    const rows: { clave: string; valor: number; updated_at: string }[] = [];
    await Promise.all(stale.map(async (c) => {
      const v = await fuente[c]?.();
      out[c] = v ?? out[c] ?? null;
      if (v != null) rows.push({ clave: c, valor: v, updated_at: new Date().toISOString() });
    }));
    if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  }

  return json(out);
});
