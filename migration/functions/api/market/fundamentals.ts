import { type Env, json, preflight, guard, cacheFresh, sbUpsert } from '../_shared';
import { DEFAULT_CIK, fetchFundamentals } from '../_edgar';

const TTL = 12 * 60 * 60 * 1000; // 12h

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fundamentals?ticker=MSFT[&cik=...][&fresh=1]
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  // Para tickers conocidos usamos SIEMPRE el CIK oficial (ignoramos el ?cik del query) para que
  // nadie pueda envenenar fundamentals_cache[ticker] con el CIK de otra empresa.
  const cik = DEFAULT_CIK[ticker] || url.searchParams.get('cik') || '';
  const force = url.searchParams.get('fresh') === '1';

  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!cik) return json({ error: `sin CIK para ${ticker} — cargá el par ticker/CIK en Configuración` }, 400);
  // (El modo debug que probaba variantes contra el proxy se eliminó tras encontrar la causa raíz:
  // era un amplificador de requests públicos sin autenticación.)

  // Cache válida solo si tiene el núcleo (OCF/EPS/Revenue). Una entrada vieja vacía (de un fallo
  // transitorio previo) se ignora y se vuelve a consultar → auto-sana.
  if (!force) {
    const cached = await cacheFresh<{ data_json: { ocf?: unknown[]; epsDiluted?: unknown[]; revenue?: unknown[] } }>(
      env, 'fundamentals_cache', 'ticker', ticker, TTL);
    const dj = cached?.data_json;
    const nucleoOk = dj && (dj.ocf?.length || dj.epsDiluted?.length || dj.revenue?.length);
    if (cached && nucleoOk) return json({ ...(dj as object), cached: true });
  }

  try {
    const data = await fetchFundamentals(env, ticker, cik);
    const nucleoIncompleto = !data.ocf.length || !data.epsDiluted.length || !data.revenue.length;
    if (!nucleoIncompleto) {
      await sbUpsert(env, 'fundamentals_cache', [{
        ticker, cik, data_json: data, updated_at: new Date().toISOString(),
      }], 'ticker');
    }
    if (data.ungradeable.length) {
      return json({ ...data, warning: `datos incompletos vía EDGAR: falta ${data.ungradeable.join(', ')} (posible 20-F/IFRS o rate-limit)` });
    }
    return json(data);
  } catch (e) {
    return json({ error: 'edgar-fetch-failed', detail: String(e) }, 502);
  }
});
