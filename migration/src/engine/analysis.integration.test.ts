// =============================================================================
// Test de integración: verifica la cadena completa de análisis de una empresa
// (ratios → DCF → score) con datos realistas, y su degradación correcta cuando
// no hay datos (fundamentals vacíos).
// =============================================================================

import { describe, it, expect } from 'vitest';
import type { Fundamentals, AnnualPoint } from '../types/domain';
import { computeRatios } from './ratios';
import { computeDcf, DEFAULT_DCF_INPUTS } from './dcf';
import { computeScore } from './score';

const P = (vals: [number, number][]): AnnualPoint[] =>
  vals.map(([fy, val]) => ({ fy, end: `${fy}-12-31`, val }));

// Fixture realista tipo "compounder" (estilo MSFT/KO), montos en millones USD,
// FY2020–2024. EPS diluido creciendo ~10%/año (factor 1.10 exacto cada año).
const TECHCO: Fundamentals = {
  ticker: 'TECHCO',
  cik: '0001234567',
  entityName: 'TECHCO CORP',
  shares: 500,
  ocf:             P([[2020, 1900], [2021, 2080], [2022, 2280], [2023, 2500], [2024, 2750]]),
  netIncome:       P([[2020, 1500], [2021, 1650], [2022, 1815], [2023, 1996.5], [2024, 2196.15]]),
  dna:             P([[2020, 300], [2021, 320], [2022, 340], [2023, 360], [2024, 390]]),
  capex:           P([[2020, 400], [2021, 430], [2022, 460], [2023, 500], [2024, 540]]),
  revenue:         P([[2020, 12000], [2021, 13000], [2022, 14000], [2023, 15200], [2024, 16500]]),
  operatingIncome: P([[2020, 3000], [2021, 3300], [2022, 3700], [2023, 4100], [2024, 4600]]),
  epsDiluted:      P([[2020, 3.00], [2021, 3.30], [2022, 3.63], [2023, 3.993], [2024, 4.3923]]),
  dividendPerShare:P([[2020, 0.90], [2021, 1.00], [2022, 1.10], [2023, 1.25], [2024, 1.50]]),
  equity:          P([[2024, 9000]]),
  totalDebt:       P([[2024, 4000]]),
  cash:            P([[2024, 1500]]),
  shortTermInvestments: P([[2024, 500]]),
  taxes:           P([[2024, 584]]),
  pretaxIncome:    P([[2024, 2780]]),
};

const PRICE = 120;

describe('cadena de análisis end-to-end (ratios → DCF → score) con datos realistas', () => {
  const ratios = computeRatios(TECHCO, PRICE, 1, 0.043);

  it('computeRatios produce ratios sanos y no nulos', () => {
    expect(ratios.pe).not.toBeNull();
    expect(ratios.pe!).toBeGreaterThan(0);

    expect(ratios.roic).not.toBeNull();
    expect(ratios.roic!).toBeGreaterThan(0);
    expect(ratios.roic!).toBeLessThan(1);

    expect(ratios.operatingMargin).not.toBeNull();
    expect(ratios.operatingMargin!).toBeGreaterThan(0);
    expect(ratios.operatingMargin!).toBeLessThan(1);

    expect(ratios.eg5y).not.toBeNull();
    expect(ratios.eg5y!).toBeCloseTo(0.10, 2);   // EPS 3.00→4.3923 en 4 años, factor 1.10 exacto

    expect(ratios.wacc).not.toBeNull();
    expect(ratios.wacc).toBeCloseTo(0.043 + 1 * 0.05, 6);
  });

  const dcf = computeDcf(TECHCO, PRICE, ratios.wacc, DEFAULT_DCF_INPUTS, ratios.roic);

  it('computeDcf produce una valuación con datos, no SIN_DATOS', () => {
    expect(dcf.intrinsicPerShare).not.toBeNull();
    expect(dcf.intrinsicPerShare!).toBeGreaterThan(0);
    expect(dcf.marginOfSafety).not.toBeNull();
    expect(['COMPRAR', 'ESPERAR', 'CARO']).toContain(dcf.verdict);
  });

  it('computeScore produce un score y rating no nulos', () => {
    const score = computeScore({
      marginOfSafety: dcf.marginOfSafety,
      roic: ratios.roic,
      wacc: ratios.wacc,
      operatingMargin: ratios.operatingMargin,
      debtToEquity: ratios.debtToEquity,
      eg5y: ratios.eg5y,
    });

    expect(score.score).not.toBeNull();
    expect(score.score!).toBeGreaterThanOrEqual(0);
    expect(score.score!).toBeLessThanOrEqual(100);
    expect(score.rating).not.toBeNull();
  });
});

describe('degradación correcta con fundamentals vacíos (sin datos EDGAR)', () => {
  const EMPTY: Fundamentals = {
    ticker: 'EMPTYCO',
    cik: '0000000000',
    entityName: null,
    shares: null,
    ocf: [], netIncome: [], dna: [], capex: [], revenue: [], operatingIncome: [],
    epsDiluted: [], dividendPerShare: [], equity: [], totalDebt: [], cash: [],
    shortTermInvestments: [], taxes: [], pretaxIncome: [],
  };

  const ratios = computeRatios(EMPTY, PRICE, 1, 0.043);
  const dcf = computeDcf(EMPTY, PRICE, ratios.wacc, DEFAULT_DCF_INPUTS, ratios.roic);

  it('computeDcf da SIN_DATOS sin owner earnings', () => {
    expect(dcf.verdict).toBe('SIN_DATOS');
    expect(dcf.intrinsicPerShare).toBeNull();
    expect(dcf.marginOfSafety).toBeNull();
  });

  it('computeScore da score y rating null sin ninguna dimensión disponible', () => {
    const score = computeScore({
      marginOfSafety: dcf.marginOfSafety,
      roic: ratios.roic,
      wacc: ratios.wacc,
      operatingMargin: ratios.operatingMargin,
      debtToEquity: ratios.debtToEquity,
      eg5y: ratios.eg5y,
    });
    expect(score.score).toBeNull();
    expect(score.rating).toBeNull();
  });
});
