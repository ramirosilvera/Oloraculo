import { describe, it, expect } from 'vitest';
import { proyectarDividendo, parseTwelveData, type DividendEvent } from './_dividendos';

const ev = (date: string, over: Partial<DividendEvent> = {}): DividendEvent =>
  ({ date, adjDividend: 1, dividend: 1, paymentDate: null, recordDate: null, declarationDate: null, ...over });

describe('proyectarDividendo', () => {
  it('sin historial → sin-dato', () => {
    expect(proyectarDividendo([], '2026-06-01')).toEqual({ proximaFecha: null, montoPorAccion: null, estado: 'sin-dato', frecuenciaAnual: null });
  });

  it('el paymentDate más reciente es futuro → estado "declarado" tal cual', () => {
    const r = proyectarDividendo([ev('2026-08-01', { paymentDate: '2026-08-15', adjDividend: 0.25 })], '2026-06-01');
    expect(r.estado).toBe('declarado');
    expect(r.proximaFecha).toBe('2026-08-15');
    expect(r.montoPorAccion).toBe(0.25);
  });

  it('sin paymentDate, usa el ex-date (`date`) como referencia', () => {
    const r = proyectarDividendo([ev('2026-06-05', { adjDividend: 0.5 })], '2026-06-01');
    expect(r.estado).toBe('declarado');
    expect(r.proximaFecha).toBe('2026-06-05');
  });

  it('el último pago quedó viejo (>7 días) → estima el próximo por cadencia trimestral', () => {
    // 4 pagos trimestrales dentro de los últimos 370 días (desde 2026-06-01 el corte es ~2025-05-27)
    // → frecuencia 4 → ~91 días entre pagos.
    const historial = [
      ev('2026-02-01'), ev('2025-11-01'), ev('2025-08-01'), ev('2025-05-28'),
    ];
    const r = proyectarDividendo(historial, '2026-06-01'); // el último (feb) quedó a 120 días
    expect(r.estado).toBe('estimado');
    expect(r.frecuenciaAnual).toBe(4);
    // 2026-02-01 + 91 días ≈ 2026-05-03, todavía pasado respecto a "hoy" (jun) → sigue sumando
    expect(new Date(r.proximaFecha!).getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
  });

  it('un solo evento muy viejo, sin poder inferir frecuencia (fuera de los últimos 370 días) → sin-dato', () => {
    const r = proyectarDividendo([ev('2020-01-01')], '2026-06-01');
    expect(r.estado).toBe('sin-dato');
    expect(r.montoPorAccion).toBe(1); // el monto histórico se informa igual, aunque no haya fecha
  });

  it('ordena el historial aunque venga desordenado (no asume que el proveedor lo manda ordenado)', () => {
    const r = proyectarDividendo([ev('2025-01-01'), ev('2026-08-15', { paymentDate: '2026-08-20' })], '2026-06-01');
    expect(r.proximaFecha).toBe('2026-08-20');
  });

  it('usa adjDividend si está, si no cae a dividend', () => {
    const r = proyectarDividendo([ev('2026-08-15', { paymentDate: '2026-08-20', adjDividend: null, dividend: 0.42 })], '2026-06-01');
    expect(r.montoPorAccion).toBe(0.42);
  });
});

describe('parseTwelveData', () => {
  it('mapea ex_date/amount/payment_date al shape DividendEvent', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0.91, payment_date: '2026-03-12', record_date: '2026-02-19', declaration_date: '2025-12-02' }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0.91, dividend: 0.91, paymentDate: '2026-03-12', recordDate: '2026-02-19', declarationDate: '2025-12-02' }]);
  });

  // Twelve Data devuelve HTTP 200 con status:"error" para key inválida/símbolo no encontrado/rate
  // limit — no es un HTTP error que fetchJson pueda atrapar por sí solo, hay que chequearlo.
  it('status "error" (HTTP 200 pero la llamada falló) → null, no una lista vacía de eventos', () => {
    expect(parseTwelveData({ status: 'error', dividends: [{ ex_date: '2026-02-19', amount: 0.91 }] })).toBeNull();
  });

  it('sin dividends o lista vacía → null', () => {
    expect(parseTwelveData({})).toBeNull();
    expect(parseTwelveData({ dividends: [] })).toBeNull();
  });

  it('campos opcionales ausentes (record_date/declaration_date/payment_date) → null en vez de romper', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0.91 }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0.91, dividend: 0.91, paymentDate: null, recordDate: null, declarationDate: null }]);
  });

  it('fila sin ex_date o sin amount se descarta, no rompe el resto', () => {
    const r = parseTwelveData({
      dividends: [
        { ex_date: '2026-02-19', amount: 0.91 },
        { amount: 0.5 },                        // sin ex_date
        { ex_date: '2026-05-21' },               // sin amount
      ],
    });
    expect(r).toHaveLength(1);
  });

  it('amount 0 es un valor válido, no se descarta como "sin dato" (usa != null, no truthy)', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0 }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0, dividend: 0, paymentDate: null, recordDate: null, declarationDate: null }]);
  });
});
