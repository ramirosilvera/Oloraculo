import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';

const TTL = 30 * 60 * 1000; // 30 min

// Indicadores clave: distancia al máximo de 52 semanas (drawdown). Fuente: Yahoo Finance (histórico
// 1 año). ^GSPC = S&P 500, GC=F = oro (COMEX), ^MERV = Merval (en pesos). El máximo se calcula de
// los cierres diarios del último año (no de un campo que puede venir vacío) → dato real, no inventado.
const SYMS: Record<string, string> = { sp500: '^GSPC', oro: 'GC=F', merval: '^MERV' };

interface DD { actual: number; max: number; dd: number }

async function drawdown(symbol: string): Promise<DD | null> {
  const j = await fetchJson<{
    chart?: { result?: { meta?: { regularMarketPrice?: number }; indicators?: { quote?: { close?: (number | null)[]; high?: (number | null)[] }[] } }[] };
  }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const r = j.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const closes = (q?.close ?? []).filter((x): x is number => typeof x === 'number' && x > 0);
  // Máximo de 52s con los MÁXIMOS intradiarios (el "52-week high" clásico); cae a los cierres si
  // no viniera el array de highs.
  const highs = (q?.high ?? []).filter((x): x is number => typeof x === 'number' && x > 0);
  if (!closes.length) return null;
  const actual = typeof r?.meta?.regularMarketPrice === 'number' && r.meta.regularMarketPrice > 0
    ? r.meta.regularMarketPrice : closes[closes.length - 1];
  const max = Math.max(...(highs.length ? highs : closes), actual);
  if (!(max > 0)) return null;
  return { actual, max, dd: actual / max - 1 };
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/drawdowns → { sp500: {actual,max,dd}, oro: {...}, merval: {...} }  (dd fracción ≤ 0)
export const onRequestGet = guard(async ({ env }) => {
  const out: Record<string, DD | null> = {};
  const rows: unknown[] = [];
  await Promise.all(Object.entries(SYMS).map(async ([key, sym]) => {
    const clave = `dd_${key}`;
    const cached = await cacheFresh<{ valor: number; data_json: { actual: number; max: number } }>(env, 'macro_cache', 'clave', clave, TTL);
    if (cached?.data_json) { out[key] = { dd: cached.valor, actual: cached.data_json.actual, max: cached.data_json.max }; return; }
    try {
      const d = await drawdown(sym);
      if (d) { out[key] = d; rows.push({ clave, valor: d.dd, data_json: { actual: d.actual, max: d.max }, updated_at: new Date().toISOString() }); return; }
    } catch { /* cae al último conocido abajo */ }
    // Yahoo caído o sin datos: último valor conocido (aunque vencido) antes que vaciar.
    const last = await cacheLast<{ valor: number; data_json: { actual: number; max: number } }>(env, 'macro_cache', 'clave', clave);
    out[key] = last?.data_json ? { dd: last.valor, actual: last.data_json.actual, max: last.data_json.max } : null;
  }));
  if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  return json(out);
});
