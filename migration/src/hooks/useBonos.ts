import { useEffect, useState } from 'react';
import { usePosiciones, useQuotes } from './usePosiciones';
import { ytm, bondDuration } from '../engine/coupons';
import type { Posicion } from '../types/domain';

export interface BonoCalc {
  pos: Posicion;
  px: number | null;           // precio por nominal (data912/100)
  paridad: number | null;      // en %
  capital: number;             // costo (precio_compra × cantidad)
  mkt: number | null;          // valor de mercado (null si no hay cotización)
  res: number | null;          // resultado (mkt − capital)
  cuponOk: boolean;
  tir: number | null;          // YTM
  duracion: { macaulay: number; modified: number } | null;
  capitalUsado: number;        // mkt si hay cotización, si no cae al costo
}

// Cálculo compartido por bono (capital, mercado, TIR, duración) — usado tanto por la tabla+gráfico
// de BonosPage como por el resumen del Dashboard, así nunca se desincronizan entre sí (mismo
// criterio que useRadarTicker para Radar/Dashboard).
export function useBonosCalc(portfolioId: string | undefined) {
  const { data: posiciones = [], isLoading } = usePosiciones(portfolioId);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));
  const hoy = new Date().toISOString().slice(0, 10);

  const bonosCalc: BonoCalc[] = bonos.map(b => {
    const px = quotes[b.ticker] ?? null;
    const paridad = px != null ? px * 100 : null;
    const capital = b.precio_compra * b.cantidad;
    const mkt = px != null ? px * b.cantidad : null;
    const res = mkt != null ? mkt - capital : null;
    const cuponOk = b.cupon_tasa != null && b.cupon_frecuencia != null && b.cupon_mes != null;
    // TIR al vencimiento sobre el precio de MERCADO (si no hay, sobre el costo).
    const precioNominal = px ?? (b.precio_compra > 0 ? b.precio_compra : null);
    const tir = precioNominal != null && b.cupon_tasa != null && b.cupon_frecuencia != null && b.vencimiento
      ? ytm({ precio: precioNominal, tasaAnual: b.cupon_tasa, frecuencia: b.cupon_frecuencia, vencimiento: b.vencimiento, hoy })
      : null;
    // Duración: se descuenta a la MISMA TIR de arriba (consistencia, ver engine/coupons.ts).
    const duracion = tir != null && b.cupon_tasa != null && b.cupon_frecuencia != null && b.vencimiento
      ? bondDuration({ tasaAnual: b.cupon_tasa, frecuencia: b.cupon_frecuencia, vencimiento: b.vencimiento, hoy, ytmAnual: tir })
      : null;
    return { pos: b, px, paridad, capital, mkt, res, cuponOk, tir, duracion, capitalUsado: mkt ?? capital };
  });

  return { bonos, bonosCalc, isLoading };
}

// Objetivo de "corto plazo" (años de duración) y qué % del capital en bonos querés ahí — es una
// preferencia de visualización personal (no afecta cálculos de otras pantallas), así que se
// persiste en localStorage por portfolio, igual que el patrón de usePrefs.ts. Compartido entre
// BonosPage y el resumen del Dashboard para que muestren siempre el mismo objetivo.
export const DEFAULT_ANIOS_CORTO_PLAZO = 2;
export const DEFAULT_PCT_CORTO_PLAZO = 60;

export function useObjetivoDuracion(portfolioId: string | undefined) {
  const key = portfolioId ? `bonos.objetivoDuracion.${portfolioId}` : null;
  const [anios, setAniosState] = useState(DEFAULT_ANIOS_CORTO_PLAZO);
  const [pct, setPctState] = useState(DEFAULT_PCT_CORTO_PLAZO);

  useEffect(() => {
    let a = DEFAULT_ANIOS_CORTO_PLAZO, p = DEFAULT_PCT_CORTO_PLAZO;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.anios) && o.anios > 0) a = o.anios;
        if (Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100) p = o.pct;
      }
    } catch { /* */ }
    setAniosState(a); setPctState(p);
  }, [key]);

  const persist = (a: number, p: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ anios: a, pct: p })); } catch { /* */ }
  };
  return {
    anios, pct,
    setAnios: (a: number) => { setAniosState(a); persist(a, pct); },
    setPct: (p: number) => { setPctState(p); persist(anios, p); },
  };
}

// Agregados sobre bonosCalc — capital total, TIR y duración promedio ponderadas por capital, y %
// del capital dentro del objetivo de corto plazo. Puro (sin hooks), para poder testearlo y para
// que BonosPage y el resumen del Dashboard calculen exactamente lo mismo sobre el mismo input.
export function resumenBonos(bonosCalc: BonoCalc[], objAnios: number) {
  const totalCapital = bonosCalc.reduce((s, b) => s + b.capital, 0);
  const totalMkt = bonosCalc.reduce((s, b) => s + (b.mkt ?? b.capital), 0);
  const conDuracion = bonosCalc.filter(b => b.duracion != null && b.capitalUsado > 0);
  const capitalConDuracion = conDuracion.reduce((s, b) => s + b.capitalUsado, 0);
  const duracionPromedio = capitalConDuracion > 0
    ? conDuracion.reduce((s, b) => s + b.duracion!.macaulay * b.capitalUsado, 0) / capitalConDuracion
    : null;
  const conTir = bonosCalc.filter(b => b.tir != null && b.capitalUsado > 0);
  const capitalConTir = conTir.reduce((s, b) => s + b.capitalUsado, 0);
  const tirPromedio = capitalConTir > 0
    ? conTir.reduce((s, b) => s + b.tir! * b.capitalUsado, 0) / capitalConTir
    : null;
  const capitalCortoPlazo = conDuracion.filter(b => b.duracion!.macaulay <= objAnios).reduce((s, b) => s + b.capitalUsado, 0);
  const pctCortoPlazo = capitalConDuracion > 0 ? capitalCortoPlazo / capitalConDuracion : null;
  return { totalCapital, totalMkt, duracionPromedio, tirPromedio, pctCortoPlazo };
}
