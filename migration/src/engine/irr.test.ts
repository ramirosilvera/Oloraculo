import { describe, it, expect } from 'vitest';
import { xirr, portfolioTir, type CashFlow } from './irr';

describe('xirr', () => {
  it('un aporte y valor final a 1 año → 10%', () => {
    const r = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.10, 3);
  });

  it('duplicar en 1 año → 100%', () => {
    const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 2000 }]);
    expect(r!).toBeCloseTo(1.0, 3);
  });

  it('duplicar en 2 años → ~41.4% anual', () => {
    const r = xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2026-01-01', amount: 2000 }]);
    expect(r!).toBeCloseTo(Math.SQRT2 - 1, 2);
  });

  it('aportes múltiples (money-weighted): rendimiento positivo coherente', () => {
    // Aporto 1000 al inicio y 1000 a mitad de año; termina en 2200.
    const r = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-07-01', amount: -1000 },
      { date: '2026-01-01', amount: 2200 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.05);
    expect(r!).toBeLessThan(0.35);
  });

  it('pérdida → TIR negativa', () => {
    const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 800 }]);
    expect(r!).toBeCloseTo(-0.20, 3);
  });

  it('sin signos opuestos → null', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: -500 }])).toBeNull();
  });

  it('todo el mismo día (sin horizonte) → null', () => {
    expect(xirr([{ date: '2026-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])).toBeNull();
  });

  it('menos de dos flujos → null', () => {
    expect(xirr([{ date: '2026-01-01', amount: -1000 }])).toBeNull();
    expect(xirr([] as CashFlow[])).toBeNull();
  });
});

describe('portfolioTir', () => {
  it('con aportes: TIR anual (XIRR) e histórica (acumulada)', () => {
    const r = portfolioTir({
      aportes: [{ monto: 1000, fecha: '2025-01-01' }],
      costos: [], valorActual: 1100, hoy: '2026-01-01',
    });
    expect(r.base).toBe('aportes');
    expect(r.aproximada).toBe(false);
    expect(r.anual!).toBeCloseTo(0.10, 3);
    expect(r.historica!).toBeCloseTo(0.10, 6);   // 1100/1000 − 1
    expect(r.invertido).toBe(1000);
  });

  it('sin aportes pero con costos fechados → fallback aproximado', () => {
    const r = portfolioTir({
      aportes: [], costos: [{ costo: 1000, fecha: '2025-01-01' }], valorActual: 1200, hoy: '2026-01-01',
    });
    expect(r.base).toBe('costos');
    expect(r.aproximada).toBe(true);
    expect(r.anual!).toBeCloseTo(0.20, 3);
    expect(r.historica!).toBeCloseTo(0.20, 6);
  });

  it('sin aportes ni costos fechados → sin-datos', () => {
    const r = portfolioTir({ aportes: [], costos: [{ costo: 1000, fecha: null }], valorActual: 1200, hoy: '2026-01-01' });
    expect(r.base).toBe('sin-datos');
    expect(r.anual).toBeNull();
    expect(r.historica).toBeNull();
  });

  it('un solo aporte hoy (sin horizonte) → anual null pero histórica sí', () => {
    const r = portfolioTir({ aportes: [{ monto: 1000, fecha: '2026-01-01' }], costos: [], valorActual: 1000, hoy: '2026-01-01' });
    expect(r.anual).toBeNull();
    expect(r.historica).toBeCloseTo(0, 6);
  });

  it('con retiro: la salida de capital cuenta como flujo positivo', () => {
    // Aporto 1000, retiro 500 a mitad de año, hoy vale 700 → recuperé 1200 sobre 1000 aportado.
    const r = portfolioTir({
      aportes: [{ monto: 1000, fecha: '2025-01-01' }, { monto: 500, fecha: '2025-07-01', retiro: true }],
      costos: [], valorActual: 700, hoy: '2026-01-01',
    });
    expect(r.invertido).toBe(1000);
    expect(r.historica!).toBeCloseTo((700 + 500 - 1000) / 1000, 6); // +20% total
    expect(r.anual).not.toBeNull();
    expect(r.anual!).toBeGreaterThan(0);   // ganancia neta positiva
  });

  it('retiro total (vendí y saqué todo) sin valor final → TIR sobre aporte vs retiro', () => {
    const r = portfolioTir({
      aportes: [{ monto: 1000, fecha: '2025-01-01' }, { monto: 1100, fecha: '2026-01-01', retiro: true }],
      costos: [], valorActual: 0, hoy: '2026-01-01',
    });
    expect(r.anual!).toBeCloseTo(0.10, 3);   // aporté 1000, retiré 1100 al año → 10%
  });

  it('horizonte corto (< 90 días): NO anualiza (evita el número absurdo) pero la histórica sí', () => {
    // Caso Herencia: aporté 3000 hace 7 días, hoy vale 3245. Anualizar +8% en 7 días daría cientos de %.
    const r = portfolioTir({ aportes: [{ monto: 3000, fecha: '2026-07-17' }], costos: [], valorActual: 3245, hoy: '2026-07-24' });
    expect(r.horizonteDias).toBe(7);
    expect(r.horizonteCorto).toBe(true);
    expect(r.anual).toBeNull();
    expect(r.historica!).toBeCloseTo((3245 - 3000) / 3000, 6);   // +8,17% real (no anualizado)
  });

  it('horizonte >= 90 días: sí anualiza', () => {
    const r = portfolioTir({ aportes: [{ monto: 1000, fecha: '2025-01-01' }], costos: [], valorActual: 1100, hoy: '2026-01-01' });
    expect(r.horizonteCorto).toBe(false);
    expect(r.anual!).toBeCloseTo(0.10, 3);
  });
});
