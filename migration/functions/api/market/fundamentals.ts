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
    const base = (env.SEC_PROXY_BASE || '').replace(/\/+$/, '');
    const tok = env.SEC_PROXY_TOKEN || '';
    const secPath = `api/xbrl/companyconcept/CIK${cik}/us-gaap/Revenues.json`;
    // Probamos varios formatos de request para descubrir cuál acepta el worker proxy.
    const variants: { label: string; url: string; init?: RequestInit }[] = [
      { label: 'a) ?k= (actual)', url: `${base}/${secPath}?k=${tok}` },
      { label: 'b) ?token=', url: `${base}/${secPath}?token=${tok}` },
      { label: 'c) ?key=', url: `${base}/${secPath}?key=${tok}` },
      { label: 'd) header Authorization Bearer', url: `${base}/${secPath}`, init: { headers: { Authorization: `Bearer ${tok}` } } },
      { label: 'e) header x-api-key', url: `${base}/${secPath}`, init: { headers: { 'x-api-key': tok } } },
      { label: 'f) sin /api/xbrl', url: `${base}/companyconcept/CIK${cik}/us-gaap/Revenues.json?k=${tok}` },
      { label: 'g) ?url=<sec>&k=', url: `${base}/?url=${encodeURIComponent('https://data.sec.gov/' + secPath)}&k=${tok}` },
      { label: 'h) raíz + header', url: `${base}/`, init: { headers: { 'x-token': tok } } },
    ];
    const results = await Promise.all(variants.map(async v => {
      try {
        const res = await fetch(v.url, v.init);
        const body = (await res.text()).slice(0, 180).replace(/\s+/g, ' ');
        return { label: v.label, status: res.status, ct: res.headers.get('content-type'), body };
      } catch (e) { return { label: v.label, error: String(e) }; }
    }));
    return json({ ticker, cik, proxyBase: base.slice(0, 40), proxyTokenLen: tok.length, results });
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
