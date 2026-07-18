import { type Env, json, preflight, sbSelect } from '../_shared';
import { DEFAULT_CIK } from '../_edgar';

// GET /api/cron/refresh-all
// Calienta TODAS las caches de mercado en una sola pasada server-side, para que la data se
// actualice sola sin depender de que la app esté abierta. Lo llama el workflow programado
// (refresh-market.yml). Reutiliza los endpoints /api/market/* — cada uno escribe su propia
// cache en Supabase, así hay una única fuente de verdad para cada fetch/parseo.
//
// No devuelve la lista de tickers (evita filtrar la composición del portfolio); solo conteos.

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = new URL(request.url).origin;

  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`);
      return r.ok;
    } catch { return false; }
  };

  // 1) Macro + renta fija (no dependen de posiciones)
  const base = ['/api/market/fx', '/api/market/bonos', '/api/market/riesgo-pais', '/api/market/fred'];

  // 2) Tickers realmente tenidos, agrupados por tipo (service-role → ve todos los portfolios)
  const pos = await sbSelect<{ ticker: string; tipo: string }>(env, 'posiciones', 'select=ticker,tipo');
  const uniq = (a: string[]) => [...new Set(a.map(s => s.toUpperCase()).filter(Boolean))];
  const equity = uniq(pos.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker));
  const ar = uniq(pos.filter(p => p.tipo === 'accion_ar').map(p => p.ticker));
  // (los bonos se refrescan enteros en /api/market/bonos; el cash no cotiza)

  // 3) CIKs conocidos: DEFAULT_CIK + cik_map. Solo pedimos fundamentals de lo que tiene CIK.
  const mapRows = await sbSelect<{ ticker: string; cik: string }>(env, 'cik_map', 'select=ticker,cik');
  const cikOf: Record<string, string> = { ...DEFAULT_CIK };
  for (const r of mapRows) if (r.ticker && r.cik) cikOf[r.ticker.toUpperCase()] = r.cik;

  const dyn: string[] = [];
  if (equity.length) dyn.push(`/api/market/quotes?tickers=${equity.join(',')}`);
  if (ar.length) dyn.push(`/api/market/acciones-ar?tickers=${ar.join(',')}`);
  for (const t of equity) {
    const cik = cikOf[t];
    if (cik) dyn.push(`/api/market/fundamentals?ticker=${t}&cik=${cik}`);
  }

  // Secuencial para no reventar los rate limits de EDGAR/Finnhub.
  let ok = 0;
  const paths = [...base, ...dyn];
  for (const p of paths) if (await hit(p)) ok++;

  return json({ ok, total: paths.length, equity: equity.length, ar: ar.length });
};
