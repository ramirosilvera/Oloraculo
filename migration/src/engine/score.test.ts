import { describe, it, expect } from 'vitest';
import { computeScore } from './score';

describe('computeScore', () => {
  it('empresa barata y de calidad → score alto (A/B)', () => {
    const r = computeScore({
      marginOfSafety: 0.4, roic: 0.18, wacc: 0.09, operatingMargin: 0.30, debtToEquity: 0.3, eg5y: 0.15,
    });
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(75);
    expect(r.rating).toBe('A');
  });

  it('empresa cara y endeudada → score bajo (D)', () => {
    const r = computeScore({
      marginOfSafety: -0.4, roic: 0.04, wacc: 0.10, operatingMargin: 0.05, debtToEquity: 1.9, eg5y: -0.05,
    });
    expect(r.score!).toBeLessThan(45);
    expect(r.rating).toBe('D');
  });

  it('renormaliza cuando faltan dimensiones', () => {
    // Solo valuación disponible → score = esa dimensión, sin romper.
    const r = computeScore({
      marginOfSafety: 0.5, roic: null, wacc: null, operatingMargin: null, debtToEquity: null, eg5y: null,
    });
    expect(r.partes.calidad).toBeNull();
    expect(r.score).toBe(100);
  });

  it('sin ningún dato → score null', () => {
    const r = computeScore({ marginOfSafety: null, roic: null, wacc: null, operatingMargin: null, debtToEquity: null, eg5y: null });
    expect(r.score).toBeNull();
    expect(r.rating).toBeNull();
  });

  it('ROIC<WACC baja la calidad', () => {
    const bueno = computeScore({ marginOfSafety: 0, roic: 0.20, wacc: 0.08, operatingMargin: 0.25, debtToEquity: 0.4, eg5y: 0.1 });
    const malo = computeScore({ marginOfSafety: 0, roic: 0.05, wacc: 0.10, operatingMargin: 0.25, debtToEquity: 0.4, eg5y: 0.1 });
    expect(bueno.partes.calidad!).toBeGreaterThan(malo.partes.calidad!);
  });
});
