import { describe, it, expect } from 'vitest';
import type { Fundamentals, AnnualPoint } from '../types/domain';
import { computeRatios, eg5y } from './ratios';
import { computeDcf, ownerEarningsByYear, sensitivityTable, dcfDefaultsFor, DEFAULT_DCF_INPUTS } from './dcf';

const P = (vals: [number, number][]): AnnualPoint[] =>
  vals.map(([fy, val]) => ({ fy, end: `${fy}-06-30`, val }));

// Fixture tipo MSFT (montos en millones USD, FY2020–2024 aprox).
const MSFT: Fundamentals = {
  ticker: 'MSFT', cik: '0000789019', entityName: 'MICROSOFT CORP', shares: 7430,
  ocf:            P([[2020,60675],[2021,76740],[2022,89035],[2023,87582],[2024,118548]]),
  netIncome:      P([[2020,44281],[2021,61271],[2022,72738],[2023,72361],[2024,88136]]),
  dna:            P([[2020,12796],[2021,11686],[2022,14460],[2023,13861],[2024,22287]]),
  capex:          P([[2020,15441],[2021,20622],[2022,23886],[2023,28107],[2024,44477]]),
  revenue:        P([[2020,143015],[2021,168088],[2022,198270],[2023,211915],[2024,245122]]),
  operatingIncome:P([[2020,52959],[2021,69916],[2022,83383],[2023,88523],[2024,109433]]),
  epsDiluted:     P([[2020,5.76],[2021,8.05],[2022,9.65],[2023,9.68],[2024,11.80]]),
  dividendPerShare:P([[2024,3.00]]),
  equity:         P([[2024,268477]]),
  totalDebt:      P([[2024,97000]]),
  cash:           P([[2024,18315]]),
  shortTermInvestments: P([[2024,57228]]),
  taxes:          P([[2024,19651]]),
  pretaxIncome:   P([[2024,107700]]),
};

describe('ratios', () => {
  const r = computeRatios(MSFT, 420, 0.9, 0.043);
  it('EG5Y = CAGR real del EPS, positivo', () => {
    expect(r.eg5y).toBeGreaterThan(0.1);   // eps 5.76→11.80 en 4 años ≈ 19%/año
    expect(r.eg5y).toBeCloseTo((11.80 / 5.76) ** (1 / 4) - 1, 5);
  });
  it('P/E, ROIC, márgenes razonables', () => {
    expect(r.pe).toBeCloseTo(420 / 11.80, 4);
    expect(r.roic!).toBeGreaterThan(0.15);
    expect(r.roic!).toBeLessThan(0.6);
    expect(r.operatingMargin!).toBeCloseTo(109433 / 245122, 4);
    expect(r.payout!).toBeCloseTo(3.0 / 11.80, 4);
  });
  it('tasa impositiva efectiva dentro de guarda [0,0.6]', () => {
    expect(r.effectiveTaxRate).toBeCloseTo(19651 / 107700, 4);
  });
  it('Ke (costOfEquity) = rf + beta*0.05; WACC real ≤ Ke (ponderado con deuda más barata)', () => {
    expect(r.costOfEquity).toBeCloseTo(0.043 + 0.9 * 0.05, 6);
    expect(r.wacc).not.toBeNull();
    expect(r.wacc!).toBeLessThanOrEqual(r.costOfEquity! + 1e-9);
    expect(r.wacc!).toBeGreaterThan(0);
  });
  it('dcfDefaultsFor: g = EG5Y − 1pto, d = WACC, gt 3%, N 20, MoS 20%', () => {
    const def = dcfDefaultsFor(r);  // redondea a 4 decimales
    expect(def.g).toBeCloseTo(Math.max(0, (r.eg5y ?? 0) - 0.01), 4);
    expect(def.d).toBeCloseTo(Math.max(0.06, r.wacc!), 4);
    expect(def.gt).toBe(0.03);
    expect(def.N).toBe(20);
    expect(def.mosRequired).toBe(0.20);
  });
});

describe('owner earnings + DCF', () => {
  it('owner earnings = OCF − capex mantenimiento; growth capex separado', () => {
    const oe = ownerEarningsByYear(MSFT, 'dna');
    expect(oe).toHaveLength(5);
    const y2024 = oe.find(y => y.fy === 2024)!;
    expect(y2024.maintenanceCapex).toBe(22287);           // método D&A
    expect(y2024.growthCapex).toBe(44477 - 22287);        // capex total − mantenimiento
    expect(y2024.ownerEarnings).toBe(118548 - 22287);
  });

  it('DCF da valor intrínseco positivo y terminal < 100%', () => {
    const d = computeDcf(MSFT, 420, 0.088, DEFAULT_DCF_INPUTS);
    expect(d.intrinsicPerShare!).toBeGreaterThan(0);
    expect(d.terminalShare).toBeGreaterThan(0);
    expect(d.terminalShare).toBeLessThan(1);
    expect(['COMPRAR', 'ESPERAR', 'CARO']).toContain(d.verdict);
  });

  it('mayor g → mayor valor (monotonicidad)', () => {
    const low = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, g: 0.04 }).intrinsicPerShare!;
    const high = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, g: 0.12 }).intrinsicPerShare!;
    expect(high).toBeGreaterThan(low);
  });

  it('mayor tasa de descuento → menor valor', () => {
    const cheap = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, d: 0.08 }).intrinsicPerShare!;
    const strict = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, d: 0.14 }).intrinsicPerShare!;
    expect(strict).toBeLessThan(cheap);
  });

  it('chequeo Munger: g ≤ CAGR histórico', () => {
    const d = computeDcf(MSFT, 420, 0.088, { ...DEFAULT_DCF_INPUTS, g: 0.30 });
    const check = d.mungerChecks.find(c => c.label.includes('CAGR histórico'))!;
    expect(check.ok).toBe(false);   // g 30% > CAGR histórico de OE
  });

  it('owner earnings negativos → SIN_DATOS, no COMPRAR', () => {
    const bad: Fundamentals = {
      ...MSFT,
      // OCF < capex de mantenimiento (D&A) todos los años → owner earnings negativos
      ocf:   P([[2020,5000],[2021,4000],[2022,3000],[2023,2000],[2024,1000]]),
      dna:   P([[2020,12000],[2021,12000],[2022,12000],[2023,12000],[2024,12000]]),
      capex: P([[2020,15000],[2021,15000],[2022,15000],[2023,15000],[2024,15000]]),
    };
    const d = computeDcf(bad, 100, 0.088, DEFAULT_DCF_INPUTS);
    expect(d.ownerEarningsNorm).toBeLessThan(0);
    expect(d.verdict).toBe('SIN_DATOS');
    expect(d.intrinsicPerShare).toBeNull();
    expect(d.marginOfSafety).toBeNull();
  });

  it('ROIC null si el capital invertido es ≤ 0 (cash-rich)', () => {
    const cashRich: Fundamentals = {
      ...MSFT,
      equity:    P([[2024,10000]]),
      totalDebt: P([[2024,0]]),
      cash:      P([[2024,50000]]),  // cash > equity+deuda → invested capital negativo
    };
    const r = computeRatios(cashRich, 420, 0.9, 0.043);
    expect(r.roic).toBeNull();
  });

  it('sensibilidad: monótona en g y d', () => {
    const t = sensitivityTable(MSFT, 0.088, DEFAULT_DCF_INPUTS, [0.04, 0.08, 0.12], [0.08, 0.10, 0.12]);
    expect(t).toHaveLength(3);
    // subiendo g (filas) sube el valor para una misma d
    expect(t[2].cells[0]!).toBeGreaterThan(t[0].cells[0]!);
    // subiendo d (columnas) baja el valor para una misma g
    expect(t[0].cells[2]!).toBeLessThan(t[0].cells[0]!);
  });
});
