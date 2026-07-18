import { describe, it, expect } from 'vitest';
import { couponEvents, couponCalendar, cuponAnualTotal, type CouponBond } from './coupons';

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
