import { type Env, json, preflight, guard, cacheFresh, sbUpsert } from '../_shared';
import { DEFAULT_CIK, fetchFundamentals } from '../_edgar';

const TTL = 12 * 60 * 60 * 1000; // 12h

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fundamentals?ticker=MSFT[&cik=0000789019][&fresh=1]
export const onRequestGet = guard(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  // Para tickers conocidos usamos SIEMPRE el CIK oficial (ignoramos el ?cik del query)
  // para que nadie pueda envenenar fundamentals_cache[ticker] con el CIK de otra empresa.
  const cik = DEFAULT_CIK[ticker] || url.searchParams.get('cik') || '';
  const force = url.searchParams.get('fresh') === '1';

  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!cik) return json({ error: `sin CIK para ${ticker} — cargá el par ticker/CIK en Configuración` }, 400);

  if (!force) {
    const cached = await cacheFresh<{ data_json: unknown }>(env, 'fundamentals_cache', 'ticker', ticker, TTL);
    if (cached) return json({ ...(cached.data_json as object), cached: true });
  }

  try {
    const data = await fetchFundamentals(env, ticker, cik);
    // Núcleo: si faltan OCF/EPS/Revenue probablemente fue un fallo transitorio del proxy (429/5xx)
    // o un filer 20-F/IFRS. NO lo cacheamos 12h para no congelar datos vacíos: se reintenta al toque.
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
