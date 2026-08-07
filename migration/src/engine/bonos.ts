// =============================================================================
// Cálculo agregado de la cartera de renta fija: por bono (capital, TIR, duración, rating) y en
// conjunto (promedios ponderados, concentración, distribución por calidad crediticia). Puro y
// testeado — compartido por BonosPage (tabla + gráfico) y el resumen del Dashboard, así nunca
// muestran números distintos del mismo bono (mismo criterio que engine/rebalance.ts + useRadarTicker
// para el resto de la app).
// =============================================================================

import { ytm, bondDuration, rendimientoCorriente } from './coupons';
import { clasificarRating, type GradoCredito } from './rating';
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
  rendCorriente: number | null;   // cupón / precio (ignora pull-to-par, a diferencia de la YTM)
  grado: GradoCredito | null;     // null = sin calificar, o calificadora de escala local (no clasificamos)
  capitalUsado: number;        // mkt si hay cotización, si no cae al costo
}

// Un solo bono: capital, mercado, TIR, duración, rendimiento corriente y clasificación de rating.
export function calcularBono(pos: Posicion, px: number | null, hoy: string): BonoCalc {
  const paridad = px != null ? px * 100 : null;
  const capital = pos.precio_compra * pos.cantidad;
  const mkt = px != null ? px * pos.cantidad : null;
  const res = mkt != null ? mkt - capital : null;
  const cuponOk = pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.cupon_mes != null;
  // TIR al vencimiento sobre el precio de MERCADO (si no hay, sobre el costo).
  const precioNominal = px ?? (pos.precio_compra > 0 ? pos.precio_compra : null);
  const tir = precioNominal != null && pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.vencimiento
    ? ytm({ precio: precioNominal, tasaAnual: pos.cupon_tasa, frecuencia: pos.cupon_frecuencia, vencimiento: pos.vencimiento, hoy })
    : null;
  // Duración: se descuenta a la MISMA TIR de arriba (consistencia, ver engine/coupons.ts).
  const duracion = tir != null && pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.vencimiento
    ? bondDuration({ tasaAnual: pos.cupon_tasa, frecuencia: pos.cupon_frecuencia, vencimiento: pos.vencimiento, hoy, ytmAnual: tir })
    : null;
  const rendCorriente = precioNominal != null && pos.cupon_tasa != null
    ? rendimientoCorriente(pos.cupon_tasa, precioNominal)
    : null;
  const grado = clasificarRating(pos.calificadora, pos.calificacion);
  return { pos, px, paridad, capital, mkt, res, cuponOk, tir, duracion, rendCorriente, grado, capitalUsado: mkt ?? capital };
}

export interface ResumenBonos {
  totalCapital: number;
  totalMkt: number;
  duracionPromedio: number | null;
  tirPromedio: number | null;
  rendCorrientePromedio: number | null;
  spreadPromedio: number | null;      // TIR − tasa libre de riesgo, ponderado por capital
  pctCortoPlazo: number | null;
  // Concentración por POSICIÓN (ticker), no por emisor real: varias series del mismo emisor (ej.
  // AL30/AL35/GD30 son todos deuda soberana argentina) cuentan aparte — no hay un campo de emisor
  // separado del ticker en el schema, así que agrupar de verdad requeriría cargarlo a mano.
  mayorPosicion: { ticker: string; pct: number } | null;
  // Fracciones (0..1) del capital total en bonos por calidad crediticia — suman 1 si totalMkt > 0.
  distribucionGrado: { gradoInversion: number; especulativo: number; default: number; sinCalificar: number };
}

// Promedio ponderado por capitalUsado de `sel(b)` sobre los bonos donde `sel(b)` no es null.
function promedioPonderado(bonos: BonoCalc[], sel: (b: BonoCalc) => number | null): number | null {
  const con = bonos.filter(b => sel(b) != null && b.capitalUsado > 0);
  const capital = con.reduce((s, b) => s + b.capitalUsado, 0);
  if (capital <= 0) return null;
  return con.reduce((s, b) => s + sel(b)! * b.capitalUsado, 0) / capital;
}

export function resumenBonos(bonosCalc: BonoCalc[], objAnios: number, riskFree?: number | null): ResumenBonos {
  const totalCapital = bonosCalc.reduce((s, b) => s + b.capital, 0);
  const totalMkt = bonosCalc.reduce((s, b) => s + b.capitalUsado, 0);

  const duracionPromedio = promedioPonderado(bonosCalc, b => b.duracion?.macaulay ?? null);
  const tirPromedio = promedioPonderado(bonosCalc, b => b.tir);
  const rendCorrientePromedio = promedioPonderado(bonosCalc, b => b.rendCorriente);
  const spreadPromedio = riskFree != null ? promedioPonderado(bonosCalc, b => b.tir != null ? b.tir - riskFree : null) : null;

  const conDuracion = bonosCalc.filter(b => b.duracion != null && b.capitalUsado > 0);
  const capitalConDuracion = conDuracion.reduce((s, b) => s + b.capitalUsado, 0);
  const capitalCortoPlazo = conDuracion.filter(b => b.duracion!.macaulay <= objAnios).reduce((s, b) => s + b.capitalUsado, 0);
  const pctCortoPlazo = capitalConDuracion > 0 ? capitalCortoPlazo / capitalConDuracion : null;

  const mayorPosicion = totalMkt > 0 && bonosCalc.length > 0
    ? bonosCalc.reduce((max, b) => b.capitalUsado > max.capitalUsado ? b : max, bonosCalc[0])
    : null;

  const sumGrado = (g: GradoCredito) => bonosCalc.filter(b => b.grado === g).reduce((s, b) => s + b.capitalUsado, 0);
  const capGradoInversion = sumGrado('grado_inversion');
  const capEspeculativo = sumGrado('especulativo');
  const capDefault = sumGrado('default');
  const capSinCalificar = totalMkt - capGradoInversion - capEspeculativo - capDefault;

  return {
    totalCapital, totalMkt, duracionPromedio, tirPromedio, rendCorrientePromedio, spreadPromedio, pctCortoPlazo,
    mayorPosicion: mayorPosicion && totalMkt > 0 ? { ticker: mayorPosicion.pos.ticker, pct: mayorPosicion.capitalUsado / totalMkt } : null,
    distribucionGrado: totalMkt > 0
      ? { gradoInversion: capGradoInversion / totalMkt, especulativo: capEspeculativo / totalMkt, default: capDefault / totalMkt, sinCalificar: capSinCalificar / totalMkt }
      : { gradoInversion: 0, especulativo: 0, default: 0, sinCalificar: 0 },
  };
}
