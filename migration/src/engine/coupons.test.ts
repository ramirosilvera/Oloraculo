import { describe, it, expect } from 'vitest';
import { couponEvents, couponCalendar, cuponAnualTotal, ytm, bondDuration, rendimientoCorriente, type CouponBond } from './coupons';

const semestral: CouponBond = { ticker: 'GD46', faceValue: 1000, tasaAnual: 0.08, frecuencia: 2, mesRef: 1 };
// paga en enero y julio; cupón por período = 1000 × 0.08/2 = 40

describe('couponEvents', () => {
  it('semestral: 2 pagos en 12 meses, monto correcto', () => {
    const ev = couponEvents([semestral], 2026, 1, 12);
    expect(ev).toHaveLength(2);
    expect(ev.every(e => e.monto === 40)).toBe(true);
    expect(ev.map(e => e.month).sort((a, b) => a - b)).toEqual([1, 7]);
  });

  it('trimestral: 4 pagos en 12 meses', () => {
    const trim: CouponBond = { ticker: 'ON', faceValue: 400, tasaAnual: 0.10, frecuencia: 4, mesRef: 3 };
    const ev = couponEvents([trim], 2026, 1, 12);
    expect(ev).toHaveLength(4);                 // meses 3,6,9,12
    expect(ev[0].monto).toBe(10);               // 400 × 0.10/4
    expect(ev.map(e => e.month).sort((a, b) => a - b)).toEqual([3, 6, 9, 12]);
  });

  it('respeta el vencimiento (no paga después)', () => {
    const vto: CouponBond = { ...semestral, vencimiento: '2026-07-31' };
    const ev = couponEvents([vto], 2026, 1, 24);
    // enero 2026 y julio 2026, nada después de julio 2026
    expect(ev.every(e => e.year === 2026 && e.month <= 7)).toBe(true);
  });

  it('ignora bonos sin tasa o sin nominal', () => {
    expect(couponEvents([{ ...semestral, tasaAnual: 0 }], 2026, 1, 12)).toHaveLength(0);
    expect(couponEvents([{ ...semestral, faceValue: 0 }], 2026, 1, 12)).toHaveLength(0);
  });
});

describe('couponCalendar', () => {
  it('devuelve un bucket por mes con el total del mes', () => {
    const cal = couponCalendar([semestral], 2026, 1, 12);
    expect(cal).toHaveLength(12);
    expect(cal[0].total).toBe(40);              // enero
    expect(cal[6].total).toBe(40);              // julio
    expect(cal[1].total).toBe(0);               // febrero sin pago
  });
});

describe('cuponAnualTotal', () => {
  it('suma el cupón anual de todos los bonos', () => {
    expect(cuponAnualTotal([semestral])).toBe(80); // 1000 × 0.08
  });
});

describe('ytm — TIR al vencimiento (vs current yield)', () => {
  it('a la par: YTM ≈ tasa del cupón', () => {
    const r = ytm({ precio: 1, tasaAnual: 0.06, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' })!;
    expect(r).toBeCloseTo(0.0609, 2);   // ≈6% (levemente más por capitalización semestral)
  });

  it('bajo la par: YTM MUY superior al current yield (pull-to-par)', () => {
    // Cupón 7% comprado a 60 de paridad: current yield = 7/60 = 11,7%; la YTM debe ser bastante mayor.
    const r = ytm({ precio: 0.60, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' })!;
    const currentYield = 0.07 / 0.60;
    expect(r).toBeGreaterThan(currentYield);
    expect(r).toBeGreaterThan(0.17);
  });

  it('sobre la par: YTM menor que el cupón', () => {
    const r = ytm({ precio: 1.15, tasaAnual: 0.08, frecuencia: 2, vencimiento: '2030-07-24', hoy: '2026-07-24' })!;
    expect(r).toBeLessThan(0.08);
    expect(r).toBeGreaterThan(0);
  });

  it('datos inválidos o bono vencido → null (no inventa)', () => {
    expect(ytm({ precio: 0, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2030-01-01', hoy: '2026-07-24' })).toBeNull();
    expect(ytm({ precio: 1, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2020-01-01', hoy: '2026-07-24' })).toBeNull();
    expect(ytm({ precio: 1, tasaAnual: 0.07, frecuencia: 2, vencimiento: 'nope', hoy: '2026-07-24' })).toBeNull();
  });
});

describe('bondDuration — Macaulay y modificada', () => {
  it('cupón cero (bullet puro): Macaulay = tiempo exacto al vencimiento', () => {
    // Sin cupón, el único flujo es el rescate al vencimiento → el "promedio ponderado" es ese único punto.
    const d = bondDuration({ tasaAnual: 0, frecuencia: 2, vencimiento: '2027-07-24', hoy: '2026-07-24', ytmAnual: 0.10 })!;
    expect(d.macaulay).toBeCloseTo(1.0, 2);
    expect(d.modified).toBeCloseTo(1.0 / 1.10, 2);
  });

  it('con cupón, la duración es MENOR al tiempo al vencimiento (los cupones adelantan flujo)', () => {
    const d = bondDuration({ tasaAnual: 0.08, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(d.macaulay).toBeGreaterThan(0);
    expect(d.macaulay).toBeLessThan(5);   // 5 años al vencimiento
  });

  it('a mayor cupón, menor duración (más peso en flujos tempranos)', () => {
    const bajo = bondDuration({ tasaAnual: 0.03, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    const alto = bondDuration({ tasaAnual: 0.12, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(alto.macaulay).toBeLessThan(bajo.macaulay);
  });

  it('a mayor plazo al vencimiento, mayor duración', () => {
    const corto = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2028-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    const largo = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2036-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(largo.macaulay).toBeGreaterThan(corto.macaulay);
  });

  it('modificada = macaulay / (1 + YTM)', () => {
    const d = bondDuration({ tasaAnual: 0.07, frecuencia: 4, vencimiento: '2033-01-15', hoy: '2026-07-24', ytmAnual: 0.095 })!;
    expect(d.modified).toBeCloseTo(d.macaulay / 1.095, 6);
  });

  it('datos inválidos o bono vencido → null (no inventa)', () => {
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: '2020-01-01', hoy: '2026-07-24', ytmAnual: 0.08 })).toBeNull();
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: 'nope', hoy: '2026-07-24', ytmAnual: 0.08 })).toBeNull();
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: '2030-01-01', hoy: '2026-07-24', ytmAnual: NaN })).toBeNull();
  });
});

describe('rendimientoCorriente — current yield', () => {
  it('a la par: rendimiento corriente = tasa del cupón', () => {
    expect(rendimientoCorriente(0.08, 1)).toBeCloseTo(0.08, 6);
  });

  it('bajo la par: rendimiento corriente > tasa del cupón', () => {
    expect(rendimientoCorriente(0.07, 0.60)).toBeCloseTo(0.07 / 0.60, 6);
    expect(rendimientoCorriente(0.07, 0.60)).toBeGreaterThan(0.07);
  });

  it('sobre la par: rendimiento corriente < tasa del cupón', () => {
    expect(rendimientoCorriente(0.08, 1.15)).toBeLessThan(0.08);
  });

  it('cupón 0 → rendimiento corriente 0 (no es null, 0 es válido)', () => {
    expect(rendimientoCorriente(0, 0.5)).toBe(0);
  });

  it('precio inválido → null (no inventa)', () => {
    expect(rendimientoCorriente(0.08, 0)).toBeNull();
    expect(rendimientoCorriente(0.08, -1)).toBeNull();
    expect(rendimientoCorriente(-0.01, 1)).toBeNull();
  });
});
