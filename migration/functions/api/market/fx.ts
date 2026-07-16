import { type Env, json, preflight, cacheFresh, sbUpsert, fetchJson } from '../_shared';

const TTL = 30 * 60 * 1000; // 30 min
const TIPOS = ['oficial', 'blue', 'bolsa', 'contadoconliqui'] as const;
// dolarapi usa "bolsa" = MEP, "contadoconliqui" = CCL
const CLAVE: Record<string, string> = { oficial: 'dolar_oficial', blue: 'dolar_blue', bolsa: 'dolar_mep', contadoconliqui: 'dolar_ccl' };

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fx  → { dolar_oficial, dolar_mep, dolar_blue, dolar_ccl }
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const out: Record<string, number | null> = {};
  const stale: string[] = [];
  for (const t of TIPOS) {
    const clave = CLAVE[t];
    const cached = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', clave, TTL);
    if (cached) { out[clave] = cached.valor; } else stale.push(t);
  }
  if (stale.length) {
    const rows: unknown[] = [];
    await Promise.all(stale.map(async (t) => {
      try {
        const d = await fetchJson<{ venta?: number; compra?: number }>(`https://dolarapi.com/v1/dolares/${t}`);
        const val = d.venta ?? d.compra ?? null;
        out[CLAVE[t]] = val;
        if (val != null) rows.push({ clave: CLAVE[t], valor: val, updated_at: new Date().toISOString() });
      } catch { out[CLAVE[t]] = out[CLAVE[t]] ?? null; }
    }));
    if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  }
  return json(out);
};
