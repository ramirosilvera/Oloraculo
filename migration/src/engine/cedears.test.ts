import { describe, it, expect } from 'vitest';
import { calcularCedear, resumenCedears, herfindahl, alertasCedears, ROL_LABEL, ROLES } from './cedears';
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

describe('alertasCedears', () => {
  // Umbrales personales por defecto usados en la mayoría de los tests (40% / 40%, igual a los
  // valores por defecto de useObjetivoConcentracion) — los tests que necesitan otro umbral lo pasan
  // explícito.
  const SECTOR_PCT = 40, ESTILO_PCT = 40;

  it('cartera bien diversificada: sin alertas', () => {
    // 6 tickers de 6 sectores y 6 estilos distintos, ~16.6% cada uno -> HHI ≈ 0.167
    const roles = ['stalwart', 'fast_grower', 'slow_grower', 'cyclical', 'turnaround', 'asset_play'] as const;
    const bonos = ['Tecnología', 'Salud', 'Finanzas', 'Materiales', 'Energía', 'Industriales']
      .map((sector, i) => calcularCedear({ ...basePos, ticker: `T${i}`, sector, rol: roles[i], cantidad: 100, ratio_cedear: 1 }, 1));
    const r = resumenCedears(bonos);
    expect(alertasCedears(r, SECTOR_PCT, ESTILO_PCT)).toHaveLength(0);
  });

  it('mayor posición ≥40%: alerta warn', () => {
    const dominante = calcularCedear({ ...basePos, ticker: 'MSFT', sector: 'Tecnología', cantidad: 500, ratio_cedear: 1 }, 1); // 500
    const resto = calcularCedear({ ...basePos, ticker: 'MELI', sector: 'Consumo discrecional', cantidad: 500, ratio_cedear: 1 }, 1); // 500
    const r = resumenCedears([dominante, resto]);
    const alertas = alertasCedears(r, SECTOR_PCT, ESTILO_PCT);
    expect(alertas.some(a => a.severidad === 'warn' && a.texto.includes('MSFT'))).toBe(true);
  });

  it('mayor sector ≥ umbral personal repartido en varios tickers (sin que ninguno solo llegue al umbral de posición)', () => {
    const a = calcularCedear({ ...basePos, ticker: 'AAA', sector: 'Tecnología', cantidad: 200, ratio_cedear: 1 }, 1);
    const b = calcularCedear({ ...basePos, ticker: 'BBB', sector: 'Tecnología', cantidad: 200, ratio_cedear: 1 }, 1);
    const c = calcularCedear({ ...basePos, ticker: 'CCC', sector: 'Salud', cantidad: 250, ratio_cedear: 1 }, 1);
    const r = resumenCedears([a, b, c]); // total 650: Tecnología = 400/650 ≈ 61.5%, mayor ticker (CCC) = 250/650 ≈ 38.5%
    expect(r.mayorPosicion!.pct).toBeLessThan(0.40); // ningún ticker solo pasa el umbral de posición
    const alertas = alertasCedears(r, SECTOR_PCT, ESTILO_PCT);
    expect(alertas.some(al => al.texto.includes('Tecnología'))).toBe(true); // pero el sector sí (≥40%)
  });

  it('umbral de sector personalizado: sube el umbral y la misma cartera deja de alertar', () => {
    // Tecnología es el sector MAYOR, a exactamente 45% (entre 40 y 50) para que el umbral de 40
    // alerte y el de 50 no.
    const a = calcularCedear({ ...basePos, ticker: 'AAA', sector: 'Tecnología', cantidad: 450, ratio_cedear: 1 }, 1);
    const b = calcularCedear({ ...basePos, ticker: 'BBB', sector: 'Salud', cantidad: 300, ratio_cedear: 1 }, 1);
    const c = calcularCedear({ ...basePos, ticker: 'CCC', sector: 'Finanzas', cantidad: 250, ratio_cedear: 1 }, 1);
    const r = resumenCedears([a, b, c]);
    expect(r.porSector[0]).toMatchObject({ sector: 'Tecnología', pct: 0.45 });
    expect(alertasCedears(r, 40, ESTILO_PCT).some(al => al.texto.includes('Tecnología'))).toBe(true);
    expect(alertasCedears(r, 50, ESTILO_PCT).some(al => al.texto.includes('Tecnología'))).toBe(false);
  });

  it('HHI ≥0.33: alerta de concentración sectorial (umbral fijo, no personalizable)', () => {
    const a = calcularCedear({ ...basePos, ticker: 'A', sector: 'Tecnología', cantidad: 340, ratio_cedear: 1 }, 1);
    const b = calcularCedear({ ...basePos, ticker: 'B', sector: 'Salud', cantidad: 330, ratio_cedear: 1 }, 1);
    const c = calcularCedear({ ...basePos, ticker: 'C', sector: 'Finanzas', cantidad: 330, ratio_cedear: 1 }, 1);
    const r = resumenCedears([a, b, c]); // ~3 sectores parejos -> HHI ≈ 0.333
    expect(r.hhiSector!).toBeGreaterThanOrEqual(0.33);
    expect(alertasCedears(r, SECTOR_PCT, ESTILO_PCT).some(al => al.texto.includes('HHI'))).toBe(true);
  });

  it('mayor estilo (Peter Lynch) ≥ umbral personal: alerta warn mencionando el estilo', () => {
    const a = calcularCedear({ ...basePos, ticker: 'AAA', sector: 'Tecnología', rol: 'compounder', cantidad: 500, ratio_cedear: 1 }, 1);
    const b = calcularCedear({ ...basePos, ticker: 'BBB', sector: 'Salud', rol: 'compounder', cantidad: 100, ratio_cedear: 1 }, 1);
    const c = calcularCedear({ ...basePos, ticker: 'CCC', sector: 'Finanzas', rol: 'cyclical', cantidad: 400, ratio_cedear: 1 }, 1);
    const r = resumenCedears([a, b, c]); // compounder = 600/1000 = 60%
    const alertas = alertasCedears(r, SECTOR_PCT, ESTILO_PCT);
    expect(alertas.some(al => al.texto.includes('Compounder'))).toBe(true);
  });

  it('estilo "sin_clasificar" dominante NO dispara la alerta de estilo (solo estilos reales cuentan)', () => {
    const sinRol = calcularCedear({ ...basePos, ticker: 'AAA', sector: 'Tecnología', rol: null, cantidad: 800, ratio_cedear: 1 }, 1);
    const conRol = calcularCedear({ ...basePos, ticker: 'BBB', sector: 'Salud', rol: 'stalwart', cantidad: 200, ratio_cedear: 1 }, 1);
    const r = resumenCedears([sinRol, conRol]);
    const alertas = alertasCedears(r, SECTOR_PCT, ESTILO_PCT);
    expect(alertas.some(al => al.texto.includes('Peter Lynch'))).toBe(false);
  });

  it('umbral de estilo personalizado: sube el umbral y la misma cartera deja de alertar', () => {
    // 'stalwart' es el estilo MAYOR, a exactamente 45% (entre 40 y 50) para que el umbral de 40
    // alerte y el de 50 no.
    const a = calcularCedear({ ...basePos, ticker: 'AAA', sector: 'Tecnología', rol: 'stalwart', cantidad: 450, ratio_cedear: 1 }, 1);
    const b = calcularCedear({ ...basePos, ticker: 'BBB', sector: 'Salud', rol: 'cyclical', cantidad: 300, ratio_cedear: 1 }, 1);
    const c = calcularCedear({ ...basePos, ticker: 'CCC', sector: 'Finanzas', rol: 'turnaround', cantidad: 250, ratio_cedear: 1 }, 1);
    const r = resumenCedears([a, b, c]);
    expect(r.porRol[0]).toMatchObject({ rol: 'stalwart', pct: 0.45 });
    expect(alertasCedears(r, SECTOR_PCT, 40).some(al => al.texto.includes('Peter Lynch'))).toBe(true);
    expect(alertasCedears(r, SECTOR_PCT, 50).some(al => al.texto.includes('Peter Lynch'))).toBe(false);
  });

  it('≥20% del capital sin sector: alerta de dato faltante', () => {
    const clasificado = calcularCedear({ ...basePos, ticker: 'MSFT', sector: 'Tecnología', cantidad: 800, ratio_cedear: 1 }, 1);
    const sinSector = calcularCedear({ ...basePos, ticker: 'XYZ', sector: null, cantidad: 200, ratio_cedear: 1 }, 1);
    const r = resumenCedears([clasificado, sinSector]);
    expect(alertasCedears(r, SECTOR_PCT, ESTILO_PCT).some(a => a.texto.includes('no tiene sector cargado'))).toBe(true);
  });

  it('cartera vacía: sin alertas, no revienta', () => {
    expect(alertasCedears(resumenCedears([]), SECTOR_PCT, ESTILO_PCT)).toHaveLength(0);
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
