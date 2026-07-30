import { type Env, json, preflight, guard } from '../_shared';

// GET /api/cron/debug-dividendos?ticker=MSFT — diagnóstico de UNA SOLA VEZ: llama directo a Twelve
// Data (sin pasar por fetchDividendos, que traga errores a propósito para no romper el flujo
// normal) y devuelve el HTTP status + body crudo, para ver EXACTAMENTE por qué no está trayendo
// datos. Nunca expone la key (se recorta del preview por las dudas, algunas APIs la reflejan en
// mensajes de error). Mismo guard que refresh-all/backfill-cobros.

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  if (env.CRON_SECRET && request.headers.get('X-Cron-Secret') !== env.CRON_SECRET) {
    return json({ error: 'no autorizado' }, 401);
  }
  const ticker = (new URL(request.url).searchParams.get('ticker') || 'MSFT').toUpperCase();
  const out: Record<string, unknown> = { ticker };

  if (!env.TWELVE_DATA_API_KEY) {
    out.twelveData = { error: 'TWELVE_DATA_API_KEY no está configurada en esta Function' };
  } else {
    const key = env.TWELVE_DATA_API_KEY;
    try {
      const res = await fetch(`https://api.twelvedata.com/dividends?symbol=${ticker}&apikey=${key}&range=5Y`);
      const body = (await res.text()).replaceAll(key, '***').slice(0, 800);
      out.twelveData = { httpStatus: res.status, bodyPreview: body };
    } catch (e) {
      out.twelveData = { error: String(e).replaceAll(key, '***') };
    }
  }
  return json(out);
});
