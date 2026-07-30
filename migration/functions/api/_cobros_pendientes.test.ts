import { describe, it, expect } from 'vitest';
import { sugerirDividendoPendiente, sugerirCuponPendiente, type PosicionParaCobro } from './_cobros_pendientes';
import type { DividendoInfo } from './_dividendos';

const pos = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro => ({
  id: 'p1', portfolio_id: 'pf1', ticker: 'AAPL', tipo: 'accion', cantidad: 10, ratio_cedear: null,
  cupon_tasa: null, cupon_frecuencia: null, cupon_mes: null, vencimiento: null, ...over,
});
const div = (over: Partial<DividendoInfo> = {}): DividendoInfo =>
  ({ proximaFecha: '2026-06-01', montoPorAccion: 1, estado: 'declarado', frecuenciaAnual: 4, ...over });

describe('sugerirDividendoPendiente', () => {
  it('acción directa: monto = por acción × cantidad, sin dividir por nada', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'accion', cantidad: 10 }), div({ montoPorAccion: 2 }), '2026-06-01');
    expect(r?.monto).toBe(20);
    expect(r?.tipo).toBe('dividendo');
  });

  it('CEDEAR CON ratio: divide por el ratio (el error más grande si se omite)', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: 20 }), div({ montoPorAccion: 1 }), '2026-06-01');
    expect(r?.monto).toBe(5); // 1 * 100 / 20
  });

  it('CEDEAR SIN ratio cargado: no sugiere nada (mejor nada que un monto 20x mal)', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: null }), div({ montoPorAccion: 1 }), '2026-06-01');
    expect(r).toBeNull();
  });

  it('la fecha proyectada todavía no llegó → no sugiere', () => {
    const r = sugerirDividendoPendiente(pos(), div({ proximaFecha: '2026-12-01' }), '2026-06-01');
    expect(r).toBeNull();
  });

  it('sin dato de dividendo (sin-dato o null) → no sugiere', () => {
    expect(sugerirDividendoPendiente(pos(), null, '2026-06-01')).toBeNull();
    expect(sugerirDividendoPendiente(pos(), div({ estado: 'sin-dato', proximaFecha: null, montoPorAccion: null }), '2026-06-01')).toBeNull();
  });

  it('bono o cash nunca generan dividendo pendiente (van por sugerirCuponPendiente)', () => {
    expect(sugerirDividendoPendiente(pos({ tipo: 'bono' }), div(), '2026-06-01')).toBeNull();
    expect(sugerirDividendoPendiente(pos({ tipo: 'cash' }), div(), '2026-06-01')).toBeNull();
  });

  it('accion_ar NUNCA sugiere (el ticker puede compartirse con un ADR/CEDEAR de otro portfolio, y ' +
     'no hay ratio conocido entre el ADR en USD y la acción local — mezclarlos infla el monto un orden de magnitud)', () => {
    expect(sugerirDividendoPendiente(pos({ tipo: 'accion_ar', ticker: 'GGAL', cantidad: 500 }), div({ montoPorAccion: 5 }), '2026-06-01')).toBeNull();
  });

  it('posición cerrada (cantidad 0) → no sugiere', () => {
    expect(sugerirDividendoPendiente(pos({ cantidad: 0 }), div(), '2026-06-01')).toBeNull();
  });

  it('estado "estimado" igual sugiere, pero la nota lo aclara (no es una fecha confirmada)', () => {
    const r = sugerirDividendoPendiente(pos(), div({ estado: 'estimado' }), '2026-06-01');
    expect(r).not.toBeNull();
    expect(r?.nota).toContain('estimado');
  });
});

describe('sugerirCuponPendiente', () => {
  const bono = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro =>
    pos({ tipo: 'bono', cantidad: 1000, cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 6, ...over });

  it('mes de pago (semestral desde junio → jun y dic): monto = tasa/frecuencia × nominales', () => {
    const r = sugerirCuponPendiente(bono(), '2026-06-15');
    expect(r?.monto).toBe(40); // 0.08/2 * 1000
    expect(r?.fecha).toBe('2026-06-01');
    expect(r?.tipo).toBe('interes');
  });

  it('el otro mes de pago (diciembre) también dispara', () => {
    const r = sugerirCuponPendiente(bono(), '2026-12-20');
    expect(r?.fecha).toBe('2026-12-01');
  });

  it('un mes que NO es de pago → no sugiere', () => {
    expect(sugerirCuponPendiente(bono(), '2026-07-15')).toBeNull();
  });

  it('sin los 4 campos de cupón cargados → no sugiere', () => {
    expect(sugerirCuponPendiente(bono({ cupon_tasa: null }), '2026-06-15')).toBeNull();
    expect(sugerirCuponPendiente(bono({ cupon_frecuencia: null }), '2026-06-15')).toBeNull();
    expect(sugerirCuponPendiente(bono({ cupon_mes: null }), '2026-06-15')).toBeNull();
  });

  it('bono ya vencido → no sigue pagando', () => {
    expect(sugerirCuponPendiente(bono({ vencimiento: '2026-01-01' }), '2026-06-15')).toBeNull();
  });

  it('no es tipo bono → no sugiere cupón', () => {
    expect(sugerirCuponPendiente(pos({ tipo: 'accion', cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 6 }), '2026-06-15')).toBeNull();
  });

  it('reintentar el cron el mismo mes da la MISMA fecha (día 1 fijo) — así dedupe la capa de arriba', () => {
    const a = sugerirCuponPendiente(bono(), '2026-06-05');
    const b = sugerirCuponPendiente(bono(), '2026-06-28');
    expect(a?.fecha).toBe(b?.fecha);
  });
});
