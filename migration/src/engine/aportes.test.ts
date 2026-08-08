import { describe, it, expect } from 'vitest';
import { resumenAportes } from './aportes';
import type { Aporte } from '../types/domain';

const aporte = (over: Partial<Aporte>): Aporte => ({
  id: 'x', portfolio_id: 'p', monto: 100, fecha: '2026-01-01', tipo: 'recurrente', descripcion: null, ...over,
});

describe('resumenAportes', () => {
  it('suma aportado (todo lo que no es retiro) y retirado por separado', () => {
    const r = resumenAportes([
      aporte({ monto: 1000, tipo: 'inicial' }),
      aporte({ monto: 200, tipo: 'recurrente' }),
      aporte({ monto: 50, tipo: 'adelanto' }),
      aporte({ monto: 300, tipo: 'retiro' }),
    ]);
    expect(r.aportado).toBe(1250);
    expect(r.retirado).toBe(300);
    expect(r.neto).toBe(950);
  });

  it('sin aportes: todo en 0 (NO cae a costo — a diferencia de aportadoNeto en DashboardPage, que sí tiene ese fallback)', () => {
    expect(resumenAportes([])).toEqual({ aportado: 0, retirado: 0, neto: 0 });
  });

  it('solo retiros: aportado 0, neto negativo', () => {
    const r = resumenAportes([aporte({ monto: 500, tipo: 'retiro' })]);
    expect(r).toEqual({ aportado: 0, retirado: 500, neto: -500 });
  });

  // Verifica que la fórmula acá coincide con la de aportadoNeto en DashboardPage.tsx
  // (`reduce((s, a) => s + (a.tipo === 'retiro' ? -a.monto : a.monto), 0)`) — mismo resultado, dos
  // formas de calcularlo, SOLO para portfolios con aportes cargados (aportes.length > 0). No
  // extender esta comparación a la lista vacía: ahí divergen a propósito (ver el comment del archivo).
  it('equivale a la fórmula de aportadoNeto de DashboardPage.tsx cuando hay aportes cargados', () => {
    const lista = [
      aporte({ monto: 1000, tipo: 'inicial' }),
      aporte({ monto: 250, tipo: 'adelanto' }),
      aporte({ monto: 400, tipo: 'retiro' }),
      aporte({ monto: 80, tipo: 'recurrente' }),
    ];
    const aportadoNetoEquivalente = lista.reduce((s, a) => s + (a.tipo === 'retiro' ? -a.monto : a.monto), 0);
    expect(resumenAportes(lista).neto).toBe(aportadoNetoEquivalente);
  });
});
