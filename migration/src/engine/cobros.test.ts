import { describe, it, expect } from 'vitest';
import { resumenCobros } from './cobros';
import type { Cobro } from '../types/domain';

const c = (over: Partial<Cobro>): Cobro => ({
  id: 'x', portfolio_id: 'p', posicion_id: null, ticker: 'AAPL', tipo: 'dividendo',
  fecha: '2026-01-01', monto: 100, estado: 'disponible', movimiento_id: null, nota: null,
  created_at: '2026-01-01T00:00:00Z', ...over,
});

describe('resumenCobros', () => {
  it('lista vacía → todo en cero', () => {
    expect(resumenCobros([])).toEqual({ total: 0, disponible: 0, reinvertido: 0, porTipo: { dividendo: 0, interes: 0, amortizacion: 0 } });
  });

  it('suma el total sin importar el tipo (la amortización SÍ es plata que entró)', () => {
    const r = resumenCobros([c({ monto: 100, tipo: 'dividendo' }), c({ monto: 50, tipo: 'interes' }), c({ monto: 200, tipo: 'amortizacion' })]);
    expect(r.total).toBe(350);
    expect(r.porTipo).toEqual({ dividendo: 100, interes: 50, amortizacion: 200 });
  });

  it('separa disponible vs reinvertido por estado', () => {
    const r = resumenCobros([c({ monto: 100, estado: 'disponible' }), c({ monto: 60, estado: 'reinvertido' })]);
    expect(r.disponible).toBe(100);
    expect(r.reinvertido).toBe(60);
    expect(r.total).toBe(160);
  });

  it('acumula varios cobros del mismo tipo', () => {
    const r = resumenCobros([c({ monto: 10, tipo: 'dividendo' }), c({ monto: 15, tipo: 'dividendo' }), c({ monto: 5, tipo: 'dividendo' })]);
    expect(r.porTipo.dividendo).toBe(30);
  });
});
