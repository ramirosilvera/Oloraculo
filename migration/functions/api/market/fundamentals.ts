import { type Env, json, preflight, guard, cacheFresh, sbUpsert } from '../_shared';
import { DEFAULT_CIK, fetchFundamentals } from '../_edgar';

const TTL = 12 * 60 * 60 * 1000; // 12h

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fundamentals?ticker=MSFT[&cik=...][&fresh=1][&debug=1]
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  // Para tickers conocidos usamos SIEMPRE el CIK oficial (ignoramos el ?cik del query) para que
  // nadie pueda envenenar fundamentals_cache[ticker] con el CIK de otra empresa.
  const cik = DEFAULT_CIK[ticker] || url.searchParams.get('cik') || '';
  const force = url.searchParams.get('fresh') === '1';
  const debug = url.searchParams.get('debug') === '1';

  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!cik) return json({ error: `sin CIK para ${ticker} — cargá el par ticker/CIK en Configuración` }, 400);

  // Modo diagnóstico: muestra qué devuelve el proxy SEC por concepto (status + cantidad de puntos)
  // y cuántos quedan tras el parseo. Sirve para distinguir 403/404 (token/CIK) de 200-vacío o de
  // un filtro que descarta todo. No expone el token.
  if (debug) {
    const probe = async (tax: string, concept: string) => {
      const purl = `${env.SEC_PROXY_BASE}/api/xbrl/companyconcept/CIK${cik}/${tax}/${concept}.json?k=${env.SEC_PROXY_TOKEN}`;
      try {
        const res = await fetch(purl);
        let unitKeys: string[] | null = null; let rawCount: number | null = null;
        let forms: string[] | null = null;
        if (res.ok) {
          const j = await res.json() as { units?: Record<string, { form?: string }[]> };
          unitKeys = Object.keys(j.units ?? {});
          const arr = unitKeys.length ? j.units![unitKeys[0]] : [];
          rawCount = arr.length;
          forms = [...new Set(arr.map(x => x.form).filter(Boolean) as string[])].slice(0, 6);
        }
        return { concept, status: res.status, unitKeys, rawCount, forms };
      } catch (e) { return { concept, error: String(e) }; }
    };
    const probes = await Promise.all([
      probe('us-gaap', 'Revenues'),
      probe('us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'),
      probe('us-gaap', 'NetCashProvidedByUsedInOperatingActivities'),
      probe('us-gaap', 'EarningsPerShareDiluted'),
      probe('dei', 'EntityCommonStockSharesOutstanding'),
    ]);
    const data = await fetchFundamentals(env, ticker, cik);
    return json({
      ticker, cik, proxyBaseSet: !!env.SEC_PROXY_BASE, proxyTokenSet: !!env.SEC_PROXY_TOKEN,
      probes,
      parsed: { ocf: data.ocf.length, epsDiluted: data.epsDiluted.length, revenue: data.revenue.length, shares: data.shares, ungradeable: data.ungradeable },
    });
  }

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
