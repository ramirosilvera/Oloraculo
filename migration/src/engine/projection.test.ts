import { describe, it, expect } from 'vitest';
import { project } from './projection';

describe('projection', () => {
  const rows = project({ valorInicial: 1000, aporteAnual: 100, tasaAnual: 0.10, anios: 3, anioBase: 2025, edadInicial: 35 });

  it('año 0 = estado inicial', () => {
    expect(rows[0]).toMatchObject({ anio: 2025, edad: 35, valor: 1000, aporteAcumulado: 0, aportadoTotal: 1000 });
  });

  it('valor_t = valor_{t-1}*(1+tasa) + aporte', () => {
    // 2026: 1000*1.1 + 100 = 1200 ; 2027: 1200*1.1 + 100 = 1420 ; 2028: 1420*1.1 + 100 = 1662
    expect(rows[1].valor).toBeCloseTo(1200, 6);
    expect(rows[2].valor).toBeCloseTo(1420, 6);
    expect(rows[3].valor).toBeCloseTo(1662, 6);
  });

  it('edad y aporte acumulado avanzan', () => {
    expect(rows[3].edad).toBe(38);
    expect(rows[3].aporteAcumulado).toBe(300);
    expect(rows[3].aportadoTotal).toBe(1300);
    expect(rows[3].gananciaAcumulada).toBeCloseTo(1662 - 1300, 6);
  });

  it('sin edad → edad null', () => {
    const r = project({ valorInicial: 0, aporteAnual: 1000, tasaAnual: 0, anios: 2, anioBase: 2025 });
    expect(r[2].edad).toBeNull();
    expect(r[2].valor).toBe(2000); // tasa 0 → solo aportes
  });
});
