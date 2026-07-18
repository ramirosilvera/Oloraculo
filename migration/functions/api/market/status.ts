import { type Env, json, preflight, guard, sbSelect } from '../_shared';

// GET /api/market/status → última actualización de cada cache (para mostrarle al usuario cuándo
// se refrescaron los datos por última vez). No trae datos, solo timestamps.
export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ env }) => {
  const latest = async (table: string): Promise<string | null> => {
    const rows = await sbSelect<{ updated_at: string }>(env, table, 'select=updated_at&order=updated_at.desc&limit=1');
    return rows[0]?.updated_at ?? null;
  };
  const [precios, macro, fundamentals] = await Promise.all([
    latest('precios_cache'), latest('macro_cache'), latest('fundamentals_cache'),
  ]);
  const all = [precios, macro, fundamentals].filter(Boolean) as string[];
  const last = all.length ? all.sort().at(-1) ?? null : null;
  return json({ precios, macro, fundamentals, last });
});
