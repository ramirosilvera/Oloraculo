import { describe, it, expect } from 'vitest';
import { categoriaDe, pctRentaFija, alertasDistribucion } from './distribucion';

describe('categoriaDe', () => {
  it('bono es fija, cash es liquidez, el resto es variable', () => {
    expect(categoriaDe('bono')).toBe('fija');
    expect(categoriaDe('cash')).toBe('liquidez');
    expect(categoriaDe('cedear')).toBe('variable');
    expect(categoriaDe('accion')).toBe('variable');
    expect(categoriaDe('accion_ar')).toBe('variable');
    expect(categoriaDe('etf')).toBe('variable');
  });
});

describe('pctRentaFija', () => {
  it('calcula el % sobre el total (incluyendo liquidez en el denominador)', () => {
    const alloc = [
      { mkt: 300, tipo: 'bono' as const },
      { mkt: 600, tipo: 'cedear' as const },
      { mkt: 100, tipo: 'cash' as const },
    ];
    expect(pctRentaFija(alloc, 1000)).toBeCloseTo(30, 6);
  });

  it('total <= 0: devuelve null (no 0 — "sin patrimonio" no es lo mismo que "0% en fija")', () => {
    expect(pctRentaFija([{ mkt: 100, tipo: 'bono' }], 0)).toBeNull();
  });

  it('sin bonos: 0%', () => {
    expect(pctRentaFija([{ mkt: 1000, tipo: 'cedear' }], 1000)).toBe(0);
  });
});

describe('alertasDistribucion', () => {
  it('dentro de la tolerancia: sin alertas', () => {
    expect(alertasDistribucion(32, 30, 10)).toHaveLength(0);
    expect(alertasDistribucion(28, 30, 10)).toHaveLength(0);
  });

  it('justo en el borde de la tolerancia (diff == tolerancia): SÍ alerta (mismo criterio >= que el resto de las alertas)', () => {
    expect(alertasDistribucion(40, 30, 10)).toHaveLength(1);
  });

  it('por debajo del objetivo más allá de la tolerancia: alerta warn, menciona "debajo"', () => {
    const alertas = alertasDistribucion(15, 30, 10);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].severidad).toBe('warn');
    expect(alertas[0].texto).toContain('debajo');
  });

  it('por encima del objetivo más allá de la tolerancia: alerta warn, menciona "encima"', () => {
    const alertas = alertasDistribucion(50, 30, 10);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].texto).toContain('encima');
  });

  it('fijaPct null (portfolio vacío/sin valuar): sin alertas, no revienta — evita el falso positivo de "0% del patrimonio" en un portfolio recién creado', () => {
    expect(alertasDistribucion(null, 30, 10)).toHaveLength(0);
    expect(alertasDistribucion(pctRentaFija([], 0), 30, 10)).toHaveLength(0);
  });
});
