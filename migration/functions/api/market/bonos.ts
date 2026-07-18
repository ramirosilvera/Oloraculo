import { type Env, json, preflight, guard, cacheFresh, sbUpsert, fetchJson } from '../_shared';

const TTL = 30 * 60 * 1000; // 30 min
const LISTS = ['arg_corp', 'arg_bonds', 'arg_notes'] as const;

// data912 devuelve precio por nominal → dividir por 100. Campos de precio posibles.
function priceOf(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v / 100;
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

// GET /api/market/bonos            → { YM41D: 98.2, GD46D: ..., ... }
// GET /api/market/bonos?ticker=X   → { ticker: 'X', precio: n }
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const one = (url.searchParams.get('ticker') || '').toUpperCase().trim();

  if (one) {
    const cached = await cacheFresh<{ precio: number }>(env, 'precios_cache', 'ticker', one, TTL);
    if (cached) return json({ ticker: one, precio: cached.precio });
  }

  const map: Record<string, number> = {};
  await Promise.all(LISTS.map(async (l) => {
    try {
      const arr = await fetchJson<Record<string, unknown>[]>(`https://data912.com/live/${l}`);
      for (const it of arr ?? []) {
        const s = symbolOf(it), p = priceOf(it);
        if (s && p != null) map[s] = p;
      }
    } catch { /* proveedor caído → seguimos con lo que haya */ }
  }));

  const rows = Object.entries(map).map(([ticker, precio]) => ({ ticker, precio, moneda: 'USD', updated_at: new Date().toISOString() }));
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');

  if (one) return json({ ticker: one, precio: map[one] ?? null });
  return json(map);
});
