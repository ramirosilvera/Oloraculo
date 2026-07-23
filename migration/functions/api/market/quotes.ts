import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';

const TTL = 15 * 60 * 1000; // 15 min

async function fetchOne(env: Env, symbol: string): Promise<number | null> {
  // Finnhub primero (free tier generoso), FMP como fallback.
  if (env.FINNHUB_API_KEY) {
    try {
      const q = await fetchJson<{ c?: number }>(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`);
      if (q.c && q.c > 0) return q.c;
    } catch { /* fallthrough */ }
  }
  if (env.FMP_API_KEY) {
    try {
      const q = await fetchJson<{ price?: number }[]>(`https://financialmodelingprep.com/api/v3/quote-short/${symbol}?apikey=${env.FMP_API_KEY}`);
      if (q[0]?.price) return q[0].price;
    } catch { /* none */ }
  }
  return null;
}

async function fetchPrice(env: Env, symbol: string): Promise<number | null> {
  const direct = await fetchOne(env, symbol);
  if (direct != null) return direct;
  // Especie dólar de un CEDEAR (termina en D): reintentamos con el subyacente (MELID → MELI).
  // Así estos CEDEARs valúan por "subyacente ÷ ratio" igual que cualquier otro — un solo mecanismo.
  if (symbol.length > 2 && symbol.endsWith('D')) return fetchOne(env, symbol.slice(0, -1));
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/quotes?tickers=MSFT,MA,KO  → { MSFT: 420.1, MA: ..., ... }
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const tickers = (url.searchParams.get('tickers') || url.searchParams.get('ticker') || '')
    .toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!tickers.length) return json({ error: 'tickers requerido' }, 400);

  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  await Promise.all(tickers.map(async (t) => {
    const cached = await cacheFresh<{ precio: number }>(env, 'precios_cache', 'ticker', t, TTL);
    if (cached) { out[t] = cached.precio; return; }
    const p = await fetchPrice(env, t);
    if (p != null) { out[t] = p; rows.push({ ticker: t, precio: p, moneda: 'USD', updated_at: new Date().toISOString() }); }
    // Proveedor caído: último precio conocido (aunque vencido) antes que vaciar la cotización.
    else out[t] = (await cacheLast<{ precio: number }>(env, 'precios_cache', 'ticker', t))?.precio ?? null;
  }));
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');
  return json(out);
});
