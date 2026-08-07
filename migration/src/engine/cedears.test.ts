import { describe, it, expect } from 'vitest';
import { calcularCedear, resumenCedears, herfindahl, ROL_LABEL, ROLES } from './cedears';
import type { Posicion } from '../types/domain';

const basePos: Posicion = {
  id: '1', portfolio_id: 'p', tipo: 'cedear', ticker: 'MSFT', empresa: 'Microsoft', sector: 'Tecnología', rol: 'stalwart',
  cantidad: 100, precio_compra: 3, fecha_compra: '2024-01-01', peso_objetivo: null, ratio_cedear: 30,
  tir_esperada: null, beta: null, cupon_tasa: null, cupon_frecuencia: null, cupon_mes: null, vencimiento: null,
  calificadora: null, calificacion: null, notas: null, created_at: '2024-01-01',
};

describe('calcularCedear', () => {
  it('sin cotización: capitalUsado cae al costo', () => {
    const c = calcularCedear(basePos, null);
    expect(c.mkt).toBeNull();
    expect(c.capital).toBe(300); // 100 × 3
    expect(c.capitalUsado).toBe(300);
  });

  it('con cotización: usa unitValueUSD (precio del subyacente / ratio)', () => {
    const c = calcularCedear(basePos, 90); // 90 / 30 = 3 por CEDEAR
    expect(c.mkt).toBe(300); // 100 × 3
    expect(c.res).toBe(0); // igual al costo en este caso
  });

  it('ratio_cedear en 0 o null: sin valor de mercado (evita sobrevaluar N×)', () => {
    const c = calcularCedear({ ...basePos, ratio_cedear: null }, 90);
    expect(c.mkt).toBeNull();
    expect(c.capitalUsado).toBe(c.capital); // cae al costo
  });
});

describe('herfindahl', () => {
  it('un solo emisor con 100% → HHI = 1 (máxima concentración)', () => {
    expect(herfindahl([1])).toBe(1);
  });
  it('3 sectores iguales → HHI = 1/3', () => {
    expect(herfindahl([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(1 / 3, 6);
  });
  it('10 sectores iguales → HHI = 0.1 (bien diversificado)', () => {
    expect(herfindahl(Array(10).fill(0.1))).toBeCloseTo(0.1, 6);
  });
  it('sin pesos → 0', () => {
    expect(herfindahl([])).toBe(0);
  });
});

describe('resumenCedears — agregados', () => {
  const a = calcularCedear({ ...basePos, ticker: 'MSFT', sector: 'Tecnología', rol: 'stalwart', cantidad: 300, ratio_cedear: 30 }, 90); // capitalUsado 900
  const b = calcularCedear({ ...basePos, ticker: 'MELI', sector: 'Consumo discrecional', rol: 'fast_grower', cantidad: 10, precio_compra: 17, ratio_cedear: 100 }, 1000); // capitalUsado 100
  const c = calcularCedear({ ...basePos, ticker: 'LAC', sector: null, rol: null, cantidad: 100, precio_compra: 1, ratio_cedear: 1 }, null); // sin cotización, capital=costo=100, sin sector/rol

  it('totalCapital y totalMkt suman todos los CEDEARs', () => {
    const r = resumenCedears([a, b, c]);
    expect(r.totalMkt).toBeCloseTo(900 + 100 + 100, 6);
  });

  it('mayorPosicion es el de mayor capitalUsado, con su % correcto', () => {
    const r = resumenCedears([a, b, c]);
    expect(r.mayorPosicion?.ticker).toBe('MSFT');
    expect(r.mayorPosicion?.pct).toBeCloseTo(900 / 1100, 6);
  });

  it('porSector agrupa y ordena desc, con "Sin sector" para null', () => {
    const r = resumenCedears([a, b, c]);
    expect(r.porSector[0]).toEqual({ sector: 'Tecnología', pct: 900 / 1100 });
    expect(r.porSector.find(s => s.sector === 'Sin sector')?.pct).toBeCloseTo(100 / 1100, 6);
    expect(r.nSectores).toBe(2); // Tecnología + Consumo discrecional (no cuenta "Sin sector")
  });

  it('porRol agrupa y ordena desc, con "sin_clasificar" para null', () => {
    const r = resumenCedears([a, b, c]);
    expect(r.porRol[0]).toEqual({ rol: 'stalwart', pct: 900 / 1100 });
    expect(r.porRol.find(x => x.rol === 'sin_clasificar')?.pct).toBeCloseTo(100 / 1100, 6);
  });

  it('las fracciones de porSector suman 1', () => {
    const r = resumenCedears([a, b, c]);
    const suma = r.porSector.reduce((s, x) => s + x.pct, 0);
    expect(suma).toBeCloseTo(1, 6);
  });

  it('hhiSector coincide con herfindahl(porSector.pct)', () => {
    const r = resumenCedears([a, b, c]);
    expect(r.hhiSector).toBeCloseTo(herfindahl(r.porSector.map(s => s.pct)), 10);
  });

  it('cartera vacía: no divide por cero', () => {
    const r = resumenCedears([]);
    expect(r.totalMkt).toBe(0);
    expect(r.mayorPosicion).toBeNull();
    expect(r.hhiSector).toBeNull();
    expect(r.porSector).toEqual([]);
    expect(r.porRol).toEqual([]);
  });
});

describe('ROL_LABEL / ROLES', () => {
  it('las 7 categorías tienen label y descripción', () => {
    for (const rol of ROLES) {
      expect(ROL_LABEL[rol].label.length).toBeGreaterThan(0);
      expect(ROL_LABEL[rol].desc.length).toBeGreaterThan(0);
    }
  });
});
