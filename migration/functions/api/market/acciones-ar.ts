import { type Env, json, preflight, guard, cacheFresh, sbUpsert, fetchJson } from '../_shared';

const TTL = 20 * 60 * 1000; // 20 min

// Acciones argentinas (BYMA) desde data912, precio en ARS. Se convierte a USD con el MEP
// (macro_cache.dolar_mep, que puebla /api/market/fx) para valuar en la moneda de la app.
function priceOf(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v; // ARS, sin /100 (no es bono)
  }
  return null;
}
function symbolOf(x: Record<string, unknown>): string | null {
  for (const k of ['symbol', 'ticker', 'especie', 'simbolo']) {
    const v = x[k];
    if (typeof v === 'string' && v) return v.toUpperCase();
  }
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/acciones-ar?tickers=YPFD,GGAL,PAMP  → { YPFD: <usd>, ... }
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const tickers = (url.searchParams.get('tickers') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);

  // MEP para pasar ARS → USD. TTL 30 min (igual que fx.ts): con 6h, en días volátiles la
  // conversión podía usar un MEP viejo y desviar la valuación.
  const mepRow = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', 30 * 60 * 1000);
  let mep = mepRow?.valor ?? null;
  if (!mep) {
    try { const d = await fetchJson<{ venta?: number }>('https://dolarapi.com/v1/dolares/bolsa'); mep = d.venta ?? null; } catch { /* */ }
  }

  const arsMap: Record<string, number> = {};
  try {
    const arr = await fetchJson<Record<string, unknown>[]>('https://data912.com/live/arg_stocks');
    for (const it of arr ?? []) {
      const s = symbolOf(it), p = priceOf(it);
      if (s && p != null) arsMap[s] = p;
    }
  } catch { /* proveedor caído */ }

  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  const wanted = tickers.length ? tickers : Object.keys(arsMap);
  for (const t of wanted) {
    const ars = arsMap[t];
    const usd = ars != null && mep ? +(ars / mep).toFixed(4) : null;
    out[t] = usd;
    if (usd != null) rows.push({ ticker: t, precio: usd, moneda: 'USD', updated_at: new Date().toISOString() });
  }
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');
  return json({ mep, precios: out });
});
