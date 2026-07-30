// Calendario de dividendos de acciones/CEDEARs — a diferencia de EDGAR (solo da el total ANUAL
// histórico, ver fundamentals.dividendPerShare), esto trae eventos individuales con fecha real
// (o, si el último pago conocido ya quedó viejo, una fecha ESTIMADA por la cadencia histórica —
// nunca se confunden: `estado` distingue 'declarado' de 'estimado').

import type { Env } from './_shared';
import { fetchJson } from './_shared';

export interface DividendEvent {
  date: string;                    // ex-dividend date
  adjDividend: number | null;
  dividend: number | null;
  paymentDate: string | null;
  recordDate: string | null;
  declarationDate: string | null;
}

export interface DividendoInfo {
  proximaFecha: string | null;     // ISO date del próximo pago (declarado o estimado)
  montoPorAccion: number | null;   // USD por acción del SUBYACENTE, bruto (sin ratio CEDEAR ni retención)
  estado: 'declarado' | 'estimado' | 'sin-dato';
  frecuenciaAnual: number | null;  // pagos/año, inferido de los últimos ~370 días de historial
}

// Puro y testeado: recibe `hoy` como parámetro (nunca Date.now() adentro) para poder testear
// determinísticamente, igual criterio que engine/coupons.ts y el resto del motor.
export function proyectarDividendo(historical: DividendEvent[], hoy: string): DividendoInfo {
  const sinDato: DividendoInfo = { proximaFecha: null, montoPorAccion: null, estado: 'sin-dato', frecuenciaAnual: null };
  const ordenados = (historical ?? [])
    .filter(h => h.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // más reciente primero
  if (!ordenados.length) return sinDato;

  const ultimo = ordenados[0];
  const montoUltimo = ultimo.adjDividend ?? ultimo.dividend ?? null;

  // Frecuencia: cuántos pagos hubo en los últimos ~370 días (30 de margen por calendario irregular).
  const corte = new Date(hoy); corte.setDate(corte.getDate() - 370);
  const corteStr = corte.toISOString().slice(0, 10);
  const enUltimoAnio = ordenados.filter(h => h.date >= corteStr).length;
  const frecuenciaAnual = enUltimoAnio > 0 ? enUltimoAnio : null;

  // Si el pago (o ex-date, si no hay paymentDate) más reciente conocido es futuro o de hasta hace
  // 7 días, lo tomamos tal cual — es un dato DECLARADO por el proveedor, no una proyección nuestra.
  const fechaRef = ultimo.paymentDate || ultimo.date;
  const margen = new Date(hoy); margen.setDate(margen.getDate() - 7);
  const margenStr = margen.toISOString().slice(0, 10);
  if (fechaRef && fechaRef >= margenStr) {
    return { proximaFecha: fechaRef, montoPorAccion: montoUltimo, estado: 'declarado', frecuenciaAnual };
  }

  // Si no, ESTIMAMOS el próximo por la cadencia histórica (intervalo típico entre pagos), sumando
  // desde el último conocido hasta pasar "hoy" — necesario si el historial quedó desactualizado.
  if (frecuenciaAnual) {
    const diasEntrePagos = Math.round(365 / frecuenciaAnual);
    const base = new Date(fechaRef || ultimo.date);
    base.setDate(base.getDate() + diasEntrePagos);
    const hoyDate = new Date(hoy);
    for (let i = 0; base < hoyDate && i < 24; i++) base.setDate(base.getDate() + diasEntrePagos);
    return { proximaFecha: base.toISOString().slice(0, 10), montoPorAccion: montoUltimo, estado: 'estimado', frecuenciaAnual };
  }

  return { proximaFecha: null, montoPorAccion: montoUltimo, estado: 'sin-dato', frecuenciaAnual: null };
}

interface FmpDividendRow { date?: string; adjDividend?: number; dividend?: number; paymentDate?: string; recordDate?: string; declarationDate?: string }
interface FinnhubDividendRow { date?: string; amount?: number; adjustedAmount?: number; payDate?: string; recordDate?: string; declarationDate?: string }

// FMP primero (el endpoint de dividendos suele estar en su plan gratuito); Finnhub como fallback
// oportunista (ese endpoint de Finnhub suele requerir plan pago — si no está habilitado, 403 y
// seguimos sin romper nada). Orden INVERSO al de quotes.ts a propósito: ahí Finnhub es gratis y
// generoso, acá no.
export async function fetchDividendos(env: Env, symbol: string): Promise<DividendEvent[] | null> {
  if (env.FMP_API_KEY) {
    try {
      const r = await fetchJson<{ historical?: FmpDividendRow[] }>(
        `https://financialmodelingprep.com/api/v3/historical-price-full/stock_dividend/${symbol}?apikey=${env.FMP_API_KEY}`);
      if (r.historical?.length) {
        const eventos = r.historical
          .filter(h => h.date)
          .map(h => ({
            date: h.date!, adjDividend: h.adjDividend ?? null, dividend: h.dividend ?? null,
            paymentDate: h.paymentDate ?? null, recordDate: h.recordDate ?? null, declarationDate: h.declarationDate ?? null,
          }));
        if (eventos.length) return eventos;
      }
    } catch { /* fallthrough a Finnhub */ }
  }
  if (env.FINNHUB_API_KEY) {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const desde = new Date(); desde.setFullYear(desde.getFullYear() - 3);
      const r = await fetchJson<FinnhubDividendRow[]>(
        `https://finnhub.io/api/v1/stock/dividend?symbol=${symbol}&from=${desde.toISOString().slice(0, 10)}&to=${hoy}&token=${env.FINNHUB_API_KEY}`);
      if (Array.isArray(r) && r.length) {
        const eventos = r
          .filter(h => h.date)
          .map(h => ({
            date: h.date!, adjDividend: h.adjustedAmount ?? h.amount ?? null, dividend: h.amount ?? null,
            paymentDate: h.payDate ?? null, recordDate: h.recordDate ?? null, declarationDate: h.declarationDate ?? null,
          }));
        if (eventos.length) return eventos;
      }
    } catch { /* ninguna fuente disponible */ }
  }
  return null;
}
