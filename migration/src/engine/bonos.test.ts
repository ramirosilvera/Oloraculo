import { describe, it, expect } from 'vitest';
import { calcularBono, resumenBonos, type BonoCalc } from './bonos';
import type { Posicion } from '../types/domain';

const basePos: Posicion = {
  id: '1', portfolio_id: 'p', tipo: 'bono', ticker: 'GD30', empresa: null, sector: null, rol: null,
  cantidad: 1000, precio_compra: 0.5, fecha_compra: '2024-01-01', peso_objetivo: null, ratio_cedear: null,
  tir_esperada: null, beta: null, cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 1, vencimiento: '2031-07-24',
  calificadora: null, calificacion: null, notas: null, created_at: '2024-01-01',
};
const HOY = '2026-07-24';

describe('calcularBono', () => {
  it('sin cotización: capitalUsado cae al costo', () => {
    const b = calcularBono(basePos, null, HOY);
    expect(b.mkt).toBeNull();
    expect(b.capital).toBe(500);
    expect(b.capitalUsado).toBe(500);
  });

  it('con cotización: capitalUsado usa el valor de mercado', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.mkt).toBe(600);
    expect(b.capitalUsado).toBe(600);
    expect(b.paridad).toBe(60);
  });

  it('calcula TIR, duración y rendimiento corriente cuando hay cupón + vencimiento', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.tir).not.toBeNull();
    expect(b.duracion).not.toBeNull();
    expect(b.rendCorriente).toBeCloseTo(0.08 / 0.6, 6);
  });

  it('clasifica el grado a partir de calificadora + calificación (escala global)', () => {
    const b = calcularBono({ ...basePos, calificadora: 'S&P', calificacion: 'BB-' }, 0.6, HOY);
    expect(b.grado).toBe('especulativo');
    expect(b.escalaGrado).toBe('global');
  });

  it('calificadora de escala nacional (FIX SCR): clasifica igual, marcando escala "local"', () => {
    const b = calcularBono({ ...basePos, calificadora: 'FIX SCR', calificacion: 'AAA(arg)' }, 0.6, HOY);
    expect(b.grado).toBe('grado_inversion');
    expect(b.escalaGrado).toBe('local');
  });

  it('sin calificar → grado y escalaGrado null', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.grado).toBeNull();
    expect(b.escalaGrado).toBeNull();
  });
});

describe('resumenBonos — agregados', () => {
  const a = calcularBono({ ...basePos, ticker: 'GD30', calificadora: 'S&P', calificacion: 'B' }, 0.6, HOY);          // capitalUsado 600, especulativo
  const b = calcularBono({ ...basePos, ticker: 'AL30', cantidad: 2000, calificadora: 'S&P', calificacion: 'BBB' }, 0.5, HOY); // capitalUsado 1000, grado inversión
  const c = calcularBono({ ...basePos, ticker: 'GNCXO', cantidad: 500, calificadora: null, calificacion: null }, 1.0, HOY);   // capitalUsado 500, sin calificar

  it('totalCapital y totalMkt suman todos los bonos', () => {
    const r = resumenBonos([a, b, c], 2);
    expect(r.totalMkt).toBeCloseTo(600 + 1000 + 500, 6);
  });

  it('duracionPromedio y tirPromedio son ponderados por capitalUsado (no simples)', () => {
    const r = resumenBonos([a, b, c], 2);
    // ponderado: entre el promedio simple y el valor del bono de mayor peso (b, 1000 de 2100)
    const simple = ((a.tir ?? 0) + (b.tir ?? 0) + (c.tir ?? 0)) / 3;
    expect(r.tirPromedio).not.toBeNull();
    expect(r.tirPromedio).not.toBeCloseTo(simple, 4); // confirma que NO es el promedio simple
  });

  it('mayorPosicion es el de mayor capitalUsado, con su % correcto', () => {
    const r = resumenBonos([a, b, c], 2);
    expect(r.mayorPosicion?.ticker).toBe('AL30');
    expect(r.mayorPosicion?.pct).toBeCloseTo(1000 / 2100, 6);
  });

  it('distribucionGrado suma 1 (o 0 si no hay capital) y refleja la clasificación real', () => {
    const r = resumenBonos([a, b, c], 2);
    const suma = r.distribucionGrado.gradoInversion + r.distribucionGrado.especulativo + r.distribucionGrado.default + r.distribucionGrado.sinCalificar;
    expect(suma).toBeCloseTo(1, 6);
    expect(r.distribucionGrado.gradoInversion).toBeCloseTo(1000 / 2100, 6);  // b
    expect(r.distribucionGrado.especulativo).toBeCloseTo(600 / 2100, 6);     // a
    expect(r.distribucionGrado.sinCalificar).toBeCloseTo(500 / 2100, 6);     // c
  });

  it('spreadPromedio: null si no se pasa risk-free; calculado si se pasa', () => {
    const sinRf = resumenBonos([a, b, c], 2);
    expect(sinRf.spreadPromedio).toBeNull();
    const conRf = resumenBonos([a, b, c], 2, 0.04);
    expect(conRf.spreadPromedio).not.toBeNull();
    expect(conRf.spreadPromedio).toBeCloseTo((sinRf.tirPromedio ?? 0) - 0.04, 4);
  });

  it('cartera vacía: no divide por cero, todo en null/0', () => {
    const r = resumenBonos([], 2);
    expect(r.totalMkt).toBe(0);
    expect(r.tirPromedio).toBeNull();
    expect(r.mayorPosicion).toBeNull();
    expect(r.distribucionGrado).toEqual({ gradoInversion: 0, especulativo: 0, default: 0, sinCalificar: 0 });
  });
});
