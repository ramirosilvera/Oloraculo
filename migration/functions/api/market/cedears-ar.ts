import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';

const TTL = 20 * 60 * 1000; // 20 min

// Precio de la especie en PESOS del CEDEAR (BYMA, data912) → se pasa a USD con el MEP. Sirve para
// valuar CEDEARs que no cotizan por su subyacente en Finnhub (p.ej. las especies dólar MELID/MAD/
// MSFTD): tomamos la especie base en pesos (MELID→MELI), precio ARS ÷ MEP = USD por CEDEAR.
function priceOf(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v; // ARS
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

// GET /api/market/cedears-ar?tickers=MELID,MAD,MSFTD → { mep, precios: { MELID: <usd/cedear>, ... } }
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const tickers = (url.searchParams.get('tickers') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!tickers.length) return json({ mep: null, precios: {} });

  // MEP para ARS → USD (mismo criterio que acciones-ar). Fallback directo a dolarapi si no hay cache.
  const mepRow = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', 30 * 60 * 1000);
  let mep = mepRow?.valor ?? null;
  if (!mep) {
    try { const d = await fetchJson<{ venta?: number }>('https://dolarapi.com/v1/dolares/bolsa'); mep = d.venta ?? null; } catch { /* */ }
  }

  const arsMap: Record<string, number> = {};
  try {
    const arr = await fetchJson<Record<string, unknown>[]>('https://data912.com/live/arg_cedears');
    for (const it of arr ?? []) {
      const s = symbolOf(it), p = priceOf(it);
      if (s && p != null) arsMap[s] = p;
    }
  } catch { /* proveedor caído: se usa fallback de precios_cache abajo */ }

  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  for (const t of tickers) {
    // Especie en pesos: si el ticker es la versión dólar (termina en D) usamos la base (MELID→MELI).
    const peso = t.length > 2 && t.endsWith('D') ? t.slice(0, -1) : t;
    const ars = arsMap[peso] ?? arsMap[t] ?? null;
    let usd = ars != null && mep ? +(ars / mep).toFixed(4) : null;
    if (usd == null) usd = (await cacheLast<{ precio: number }>(env, 'precios_cache', 'ticker', t))?.precio ?? null; // último conocido
    out[t] = usd;
    if (ars != null && mep) rows.push({ ticker: t, precio: usd, moneda: 'USD', updated_at: new Date().toISOString() });
  }
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');
  return json({ mep, precios: out });
});
