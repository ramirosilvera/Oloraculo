import { describe, it, expect } from 'vitest';
import { proyectarDividendo, type DividendEvent } from './_dividendos';

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
