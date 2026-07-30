import { type Env, json, preflight, guard, sbSelect, sbRpc, tokenInterno } from '../_shared';
import { DEFAULT_CIK } from '../_edgar';
import { sugerirDividendoPendiente, sugerirCuponPendiente, type PosicionParaCobro } from '../_cobros_pendientes';
import type { DividendoInfo } from '../_dividendos';

// GET /api/cron/refresh-all
// Calienta TODAS las caches de mercado en una sola pasada server-side, para que la data se
// actualice sola sin depender de que la app esté abierta. Lo llama el workflow programado
// (refresh-market.yml). Reutiliza los endpoints /api/market/* — cada uno escribe su propia
// cache en Supabase, así hay una única fuente de verdad para cada fetch/parseo.
//
// No devuelve la lista de tickers (evita filtrar la composición del portfolio); solo conteos.

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  // Si CRON_SECRET está configurado, solo el workflow (que manda X-Cron-Secret) puede dispararlo.
  // Sin el secret configurado sigue abierto (compatibilidad), pero se recomienda setearlo.
  if (env.CRON_SECRET && request.headers.get('X-Cron-Secret') !== env.CRON_SECRET) {
    return json({ error: 'no autorizado' }, 401);
  }
  const origin = new URL(request.url).origin;

  // Los endpoints de mercado exigen sesión; el cron se identifica con su token interno (derivado de
  // un secret que siempre existe), así el refresco funciona aunque CRON_SECRET no esté configurado.
  const headers: Record<string, string> = { 'X-Internal-Refresh': await tokenInterno(env) };
  if (env.CRON_SECRET) headers['X-Cron-Secret'] = env.CRON_SECRET;
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { headers });
      return r.ok;
    } catch { return false; }
  };

  // 1) Macro + renta fija (no dependen de posiciones)
  const base = ['/api/market/fx', '/api/market/bonos', '/api/market/riesgo-pais', '/api/market/fred', '/api/market/indicadores'];

  // 2) Posiciones reales (service-role → ve todos los portfolios). Selección amplia: además de
  // refrescar cotizaciones, estos mismos campos alimentan la sugerencia de cobros pendientes
  // (paso 4) — una sola consulta para ambos usos.
  const pos = await sbSelect<PosicionParaCobro>(env, 'posiciones',
    'select=id,portfolio_id,ticker,tipo,cantidad,ratio_cedear,cupon_tasa,cupon_frecuencia,cupon_mes,vencimiento');
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

  // 4) Cobros pendientes: dividendos reales (equities, vía FMP/Finnhub) + cupones sintéticos
  // (bonos, desde los 4 campos manuales) que ya llegaron a su fecha proyectada. SIEMPRE quedan en
  // estado 'pendiente' — el cron NUNCA los confirma solo; eso lo decide el usuario a mano (ver
  // 0012_cobros_pendientes.sql y engine/cobros.ts). Falla aislada: si esto se cae, no afecta ok/total.
  let pendientes = 0;
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    let divPorTicker: Record<string, DividendoInfo | null> = {};
    if (equity.length) {
      const r = await fetch(`${origin}/api/market/dividendos?tickers=${equity.join(',')}`, { headers });
      if (r.ok) divPorTicker = await r.json();
    }
    for (const p of pos) {
      const sug = p.tipo === 'bono'
        ? sugerirCuponPendiente(p, hoy)
        : sugerirDividendoPendiente(p, divPorTicker[p.ticker.toUpperCase()] ?? null, hoy);
      if (!sug) continue;
      try {
        await sbRpc(env, 'insertar_cobro_pendiente_cron', {
          p_portfolio_id: sug.portfolio_id, p_posicion_id: sug.posicion_id, p_ticker: sug.ticker,
          p_tipo: sug.tipo, p_fecha: sug.fecha, p_monto: sug.monto, p_nota: sug.nota,
        });
        pendientes++;
      } catch { /* una sugerencia fallida no frena las demás */ }
    }
  } catch { /* sin dividendos disponibles (sin key, proveedor caído): no rompe el resto del cron */ }

  // Solo conteos agregados — sin tickers ni montos (no filtrar composición del portfolio).
  return json({ ok, total: paths.length, pendientes });
});
