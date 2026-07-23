import { type Env, json, preflight, guard, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';

const TTL = 60 * 60 * 1000; // 1h

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/riesgo-pais → { riesgo_pais }
export const onRequestGet = guard(async ({ env }) => {
  const cached = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'riesgo_pais', TTL);
  if (cached) return json({ riesgo_pais: cached.valor });
  try {
    const d = await fetchJson<{ valor?: number }>('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo');
    const val = d.valor ?? null;
    if (val != null) { await sbUpsert(env, 'macro_cache', [{ clave: 'riesgo_pais', valor: val, updated_at: new Date().toISOString() }], 'clave'); return json({ riesgo_pais: val }); }
    // Sin valor nuevo: devolvemos el último conocido antes que un campo vacío.
    return json({ riesgo_pais: (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', 'riesgo_pais'))?.valor ?? null });
  } catch {
    // Proveedor caído: último valor conocido (aunque vencido).
    return json({ riesgo_pais: (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', 'riesgo_pais'))?.valor ?? null, stale: true });
  }
});
