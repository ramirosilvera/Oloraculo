// =============================================================================
// Domain types — mirror the Supabase schema (see supabase/migrations).
// =============================================================================

// bono cubre bonos soberanos y ONs (obligaciones negociables). accion = acción US directa;
// accion_ar = acción argentina (BYMA).
export type AssetType = 'cedear' | 'accion' | 'accion_ar' | 'etf' | 'bono' | 'cash';
export type AssetRole =
  | 'compounder' | 'stalwart' | 'fast_grower' | 'asset_play' | 'slow_grower' | 'turnaround' | 'cyclical';
export type PortfolioState = 'active' | 'archived';
export type AporteTipo = 'inicial' | 'adelanto' | 'recurrente';

export interface Portfolio {
  id: string;
  user_id: string;
  nombre: string;
  descripcion: string | null;
  capital_objetivo: number | null;
  moneda_ref: string;            // 'USD' | 'ARS'
  estrategia: string | null;
  estado: PortfolioState;
  created_at: string;
}

export interface Posicion {
  id: string;
  portfolio_id: string;
  tipo: AssetType;
  ticker: string;
  empresa: string | null;
  sector: string | null;
  rol: AssetRole | null;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string | null;
  peso_objetivo: number | null;  // 0..1
  ratio_cedear: number | null;   // subyacentes por CEDEAR
  tir_esperada: number | null;
  beta: number | null;
  // Cupones (bonos/ONs) — usados por el flujo de cupones:
  cupon_tasa: number | null;         // tasa nominal anual (0.07 = 7%)
  cupon_frecuencia: number | null;   // pagos por año (1/2/4)
  cupon_mes: number | null;          // mes (1-12) de un pago de referencia
  vencimiento: string | null;        // ISO date
  notas: string | null;
  created_at: string;
}

export interface Movimiento {
  id: string;
  portfolio_id: string;
  posicion_id: string | null;
  ticker: string;
  tipo: 'compra' | 'venta' | 'ajuste';
  cantidad: number;
  precio: number;                // precio por unidad (USD)
  fecha: string;
  nota: string | null;
  created_at: string;
}

export interface Aporte {
  id: string;
  portfolio_id: string;
  monto: number;
  fecha: string;
  tipo: AporteTipo;
  descripcion: string | null;
}

// ── Fundamentals derived from EDGAR (computed, not stored hardcoded) ──────────
export interface AnnualPoint { fy: number; end: string; val: number; }

export interface Fundamentals {
  ticker: string;
  cik: string;
  entityName: string | null;
  shares: number | null;                 // dei EntityCommonStockSharesOutstanding (latest)
  ocf: AnnualPoint[];
  netIncome: AnnualPoint[];
  dna: AnnualPoint[];
  capex: AnnualPoint[];                   // magnitude (positive)
  revenue: AnnualPoint[];
  operatingIncome: AnnualPoint[];
  epsDiluted: AnnualPoint[];
  dividendPerShare: AnnualPoint[];
  equity: AnnualPoint[];
  totalDebt: AnnualPoint[];
  cash: AnnualPoint[];
  shortTermInvestments: AnnualPoint[];
  taxes: AnnualPoint[];
  pretaxIncome: AnnualPoint[];
  ungradeable?: string[];                 // concepts EDGAR didn't return (e.g. 20-F/IFRS filers)
  updated_at?: string;
}

export interface Ratios {
  price: number | null;
  eps: number | null;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
  payout: number | null;
  operatingMargin: number | null;
  debtToEquity: number | null;
  netDebtToEbitda: number | null;
  roic: number | null;
  effectiveTaxRate: number | null;
  eg5y: number | null;                    // real historical EPS CAGR (5y)
  peForward: number | null;
  costOfEquity: number | null;            // Ke por CAPM (rf + β·ERP)
  costOfDebt: number | null;              // Kd después de impuestos
  wacc: number | null;                    // WACC real ponderado (Ke·E/V + Kd·D/V); Ke si no hay market cap
}
