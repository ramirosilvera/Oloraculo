import { describe, it, expect } from 'vitest';
import { couponEvents, couponCalendar, cuponAnualTotal, ytm, type CouponBond } from './coupons';

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
