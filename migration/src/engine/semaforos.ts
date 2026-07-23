// =============================================================================
// Semáforos macro — umbrales EXACTOS de la planilla original (sección 9). Puro.
// verde = benigno · amarillo = atención · rojo = estrés.
// =============================================================================

export type Luz = 'verde' | 'amarillo' | 'rojo';

export interface SemaforoDef {
  key: string;
  label: string;
  fmt?: (v: number) => string;
  evalua: (v: number) => Luz;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const usd0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export const SEMAFOROS: SemaforoDef[] = [
  { key: 'dolar_oficial', label: 'Dólar oficial', fmt: usd0, evalua: v => v < 1200 ? 'rojo' : v < 1600 ? 'verde' : 'amarillo' },
  { key: 'dolar_mep',     label: 'Dólar MEP',     fmt: usd0, evalua: v => v < 1400 ? 'rojo' : v < 1750 ? 'verde' : 'amarillo' },
  { key: 'riesgo_pais',   label: 'Riesgo país',   fmt: v => `${Math.round(v)}`, evalua: v => v < 400 ? 'verde' : v < 800 ? 'amarillo' : 'rojo' },
  { key: 'merval_usd',    label: 'Merval USD',    fmt: usd0, evalua: v => v > 2050 ? 'rojo' : v > 1500 ? 'amarillo' : 'verde' },
  { key: 'adr_ypf',       label: 'ADR YPF',       fmt: usd0, evalua: v => v > 40 ? 'verde' : v > 25 ? 'amarillo' : 'rojo' },
  // DXY real (ICE, ~90-115). Dólar fuerte = viento en contra para emergentes/Argentina → rojo.
  { key: 'dollar_index',  label: 'DXY (dólar)',    fmt: v => v.toFixed(2), evalua: v => v > 106 ? 'rojo' : v > 100 ? 'amarillo' : 'verde' },
  // Recalibrado 2026 (S&P ~7400): el umbral original (rojo >7000) quedó estructuralmente en rojo.
  { key: 'sp500',         label: 'S&P 500',       fmt: usd0, evalua: v => v > 8600 ? 'rojo' : v > 7800 ? 'amarillo' : 'verde' },
  { key: 'vix',           label: 'VIX',           fmt: v => v.toFixed(1), evalua: v => v < 20 ? 'verde' : v < 30 ? 'amarillo' : 'rojo' },
  { key: 'hy_spread',     label: 'HY spread',     fmt: pct, evalua: v => v < 4 ? 'verde' : v < 6 ? 'amarillo' : 'rojo' },
  { key: 'dgs3mo',        label: 'T-Bills 3M',    fmt: pct, evalua: v => v > 5 ? 'rojo' : v > 2 ? 'verde' : 'amarillo' },
  { key: 'oro',           label: 'Oro',           fmt: usd0, evalua: v => v > 4000 ? 'rojo' : v > 3000 ? 'amarillo' : 'verde' },
  { key: 'bitcoin',       label: 'Bitcoin',       fmt: usd0, evalua: v => v > 100000 ? 'rojo' : v > 50000 ? 'amarillo' : 'verde' },
];

// Variación del S&P vs máximo histórico: >20% alerta extrema, >0% rojo (caída), si no verde.
export function sp500Drawdown(actual: number, maximoHistorico: number): { pct: number; luz: Luz } {
  const caida = maximoHistorico > 0 ? (maximoHistorico - actual) / maximoHistorico : 0;
  return { pct: caida, luz: caida > 0.20 ? 'rojo' : caida > 0 ? 'rojo' : 'verde' };
}

export interface Sintesis { rojos: number; texto: string; luz: Luz; }

// ≥4 rojos → estrés creciente; ≥2 → vulnerabilidad moderada; si no, estable.
export function sintesis(luces: Luz[]): Sintesis {
  const rojos = luces.filter(l => l === 'rojo').length;
  if (rojos >= 4) return { rojos, texto: 'Estrés creciente', luz: 'rojo' };
  if (rojos >= 2) return { rojos, texto: 'Vulnerabilidad moderada', luz: 'amarillo' };
  return { rojos, texto: 'Panorama estable', luz: 'verde' };
}
