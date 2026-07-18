import { describe, it, expect } from 'vitest';
import { readCurve, nivelTasaLarga, impactoPorTasa } from './rates';

describe('readCurve', () => {
  it('curva invertida (10a < 3m) → rojo', () => {
    const r = readCurve(5.2, 4.3);
    expect(r.spread).toBeCloseTo(-0.9, 6);
    expect(r.forma).toBe('invertida');
    expect(r.luz).toBe('rojo');
  });

  it('curva normal empinada → verde', () => {
    const r = readCurve(3.5, 4.6);
    expect(r.forma).toBe('normal');
    expect(r.luz).toBe('verde');
  });

  it('curva plana → amarillo', () => {
    const r = readCurve(4.2, 4.5);
    expect(r.forma).toBe('plana');
    expect(r.luz).toBe('amarillo');
  });

  it('sin datos → null sin romper', () => {
    expect(readCurve(null, 4.5).forma).toBeNull();
    expect(readCurve(4.2, null).luz).toBeNull();
  });
});

describe('nivelTasaLarga', () => {
  it('≥4.5% verde, media amarillo, baja rojo', () => {
    expect(nivelTasaLarga(4.8).luz).toBe('verde');
    expect(nivelTasaLarga(3.8).luz).toBe('amarillo');
    expect(nivelTasaLarga(2.5).luz).toBe('rojo');
    expect(nivelTasaLarga(null).luz).toBeNull();
  });
});

describe('impactoPorTasa', () => {
  it('ΔPrecio ≈ −Duración × ΔTasa', () => {
    // TLT (dur 17) ante +1% de tasa → ~−17%
    expect(impactoPorTasa(17, 1)).toBeCloseTo(-0.17, 6);
    // SHV (dur 0.4) ante +1% → ~−0.4%
    expect(impactoPorTasa(0.4, 1)).toBeCloseTo(-0.004, 6);
  });
});
