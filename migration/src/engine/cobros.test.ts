import { describe, it, expect } from 'vitest';
import { resumenCobros } from './cobros';
import type { Cobro } from '../types/domain';

const c = (over: Partial<Cobro>): Cobro => ({
  id: 'x', portfolio_id: 'p', posicion_id: null, ticker: 'AAPL', tipo: 'dividendo',
  fecha: '2026-01-01', monto: 100, estado: 'disponible', origen: 'manual', movimiento_id: null, nota: null,
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

  it('un cobro "pendiente" (generado por el cron, sin confirmar) NO suma a ningún total', () => {
    const r = resumenCobros([
      c({ monto: 100, estado: 'disponible' }),
      c({ monto: 999, estado: 'pendiente', origen: 'cron' }),
    ]);
    expect(r.total).toBe(100);
    expect(r.disponible).toBe(100);
    expect(r.porTipo.dividendo).toBe(100);
  });

  it('todo pendiente → resumen en cero (no solo "disponible" en cero)', () => {
    const r = resumenCobros([c({ monto: 500, estado: 'pendiente', origen: 'cron' })]);
    expect(r).toEqual({ total: 0, disponible: 0, reinvertido: 0, porTipo: { dividendo: 0, interes: 0, amortizacion: 0 } });
  });

  it('un cobro "descartado" tampoco suma a ningún total (allowlist, no un continue puntual por estado)', () => {
    const r = resumenCobros([
      c({ monto: 100, estado: 'disponible' }),
      c({ monto: 999, estado: 'descartado', origen: 'cron' }),
    ]);
    expect(r.total).toBe(100);
    expect(r.disponible).toBe(100);
  });

  it('un estado desconocido/futuro (no disponible/reinvertido) queda afuera por default', () => {
    // @ts-expect-error — a propósito: probar la robustez ante un estado que TypeScript no conoce
    // pero que igual podría llegar en runtime (dato viejo, columna nueva sin migrar el cliente, etc.)
    const r = resumenCobros([c({ monto: 100, estado: 'disponible' }), c({ monto: 50, estado: 'algo_nuevo' })]);
    expect(r.total).toBe(100);
  });
});
