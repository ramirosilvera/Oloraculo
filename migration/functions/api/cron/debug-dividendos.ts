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

  // EODHD y Alpha Vantage tienen keys DEMO públicas para probar sin registrarse — sirven solo
  // para un puñado de tickers fijos (no los del portfolio), así que se prueban con esos tickers
  // fijos, no con `ticker`: el objetivo acá es solo confirmar si el endpoint de dividendos
  // funciona en el tier gratis, no traer datos reales de nadie.
  try {
    const res = await fetch('https://eodhd.com/api/div/AAPL.US?api_token=demo&fmt=json&from=2025-01-01');
    const body = (await res.text()).slice(0, 800);
    out.eodhd = { httpStatus: res.status, bodyPreview: body, nota: 'probado con AAPL.US (única que acepta la key demo pública)' };
  } catch (e) {
    out.eodhd = { error: String(e) };
  }

  try {
    const res = await fetch('https://www.alphavantage.co/query?function=DIVIDENDS&symbol=IBM&apikey=demo');
    const body = (await res.text()).slice(0, 800);
    out.alphaVantage = { httpStatus: res.status, bodyPreview: body, nota: 'probado con IBM (única que acepta la key demo pública)' };
  } catch (e) {
    out.alphaVantage = { error: String(e) };
  }

  return json(out);
});
