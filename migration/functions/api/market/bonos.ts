import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';

const TTL = 30 * 60 * 1000; // 30 min
const LISTS = ['arg_corp', 'arg_bonds', 'arg_notes'] as const;

// data912 devuelve precio por cada 100 nominales (paridad) → dividir por 100 = precio por nominal.
// OJO con la MONEDA: las listas traen especies hard-dollar Y especies en PESOS. Si una especie en
// pesos se guarda como USD, la posición queda sobrevaluada ~1000× y contamina patrimonio, TIR y
// pesos objetivo. Por eso se distingue por sufijo (convención BYMA: D = MEP/hard dollar, C = CCL)
// y las especies en pesos se convierten con el MEP; si no hay MEP, se devuelve null (no se inventa).
function rawPrice(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v / 100;
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

// Convención de especies argentinas: el sufijo D (dólar MEP) o C (CCL) indica liquidación en USD;
// sin sufijo, la especie liquida en PESOS. Cubre soberanos (AL30D/GD30C) y ONs (YM41D, XMC1D…).
export function esHardDollar(ticker: string): boolean {
  return ticker.length >= 3 && (ticker.endsWith('D') || ticker.endsWith('C'));
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/bonos            → { YM41D: 0.982, ... }  (precio por nominal, en USD)
// GET /api/market/bonos?ticker=X   → { ticker: 'X', precio: n }
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const one = (url.searchParams.get('ticker') || '').toUpperCase().trim();

  if (one) {
    const cached = await cacheFresh<{ precio: number }>(env, 'precios_cache', 'ticker', one, TTL);
    if (cached) return json({ ticker: one, precio: cached.precio });
  }

  // MEP para pasar a USD las especies en pesos (mismo criterio que acciones-ar.ts).
  const mepRow = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', 30 * 60 * 1000);
  let mep = mepRow?.valor ?? null;
  if (!mep) {
    try { const d = await fetchJson<{ venta?: number }>('https://dolarapi.com/v1/dolares/bolsa'); mep = d.venta ?? null; } catch { /* */ }
  }
  if (!mep) mep = (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep'))?.valor ?? null;

  const map: Record<string, number> = {};
  await Promise.all(LISTS.map(async (l) => {
    try {
      const arr = await fetchJson<Record<string, unknown>[]>(`https://data912.com/live/${l}`);
      for (const it of arr ?? []) {
        const s = symbolOf(it), p = rawPrice(it);
        if (!s || p == null) continue;
        if (esHardDollar(s)) { map[s] = p; continue; }      // ya está en USD
        if (mep && mep > 0) map[s] = +(p / mep).toFixed(6);  // especie en pesos → USD
        // sin MEP: no publicamos la especie en pesos (mejor "—" que un valor 1000× inflado)
      }
    } catch { /* proveedor caído → seguimos con lo que haya */ }
  }));

  const rows = Object.entries(map).map(([ticker, precio]) => ({ ticker, precio, moneda: 'USD', updated_at: new Date().toISOString() }));
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');

  if (one) return json({ ticker: one, precio: map[one] ?? null });
  return json(map);
});
