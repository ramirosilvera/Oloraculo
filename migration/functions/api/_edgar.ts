// SEC EDGAR fundamentals via the existing Cloudflare proxy (data.sec.gov blocks
// datacenter IPs / requires a compliant User-Agent — the proxy handles that).
// Proxy shape: {BASE}/api/xbrl/companyconcept/CIK{cik10}/{taxonomy}/{Concept}.json?k={TOKEN}

import type { Env } from './_shared';

// Default ticker→CIK (EDGAR blocks the ticker lookup file from datacenter IPs, so
// these are hardcoded; the user can add more via the cik_map table).
// Set estándar: mayores empresas del S&P que reportan a la SEC (us-gaap). MANTENER EN SYNC con
// src/lib/defaultCik.ts (espejo del frontend). El usuario puede añadir/sobrescribir vía cik_map.
export const DEFAULT_CIK: Record<string, string> = {
  UNH: '0000731766', MA: '0001141391', MSFT: '0000789019', GOOGL: '0001652044',
  MRK: '0000310158', MELI: '0001099590', LAC: '0001966983', ADBE: '0000796343',
  AMZN: '0001018724', ACN: '0001467373', NKE: '0000320187', AAPL: '0000320193',
  ASML: '0000937966', KO: '0000021344', V: '0001403161', WMT: '0000104169',
  NVDA: '0001045810', META: '0001326801', JNJ: '0000200406', PG: '0000080424',
  PEP: '0000077476', COST: '0000909832', LLY: '0000059478', JPM: '0000019617',
  TSLA: '0001318605', ORCL: '0001341439', CRM: '0001108524', ADP: '0000008670',
  IBM: '0000051143', INTC: '0000050863', CSCO: '0000858877', AMD: '0000002488',
  QCOM: '0000804328', TXN: '0000097476', AVGO: '0001730168', NFLX: '0001065280',
  PYPL: '0001633917', NOW: '0001373715', INTU: '0000896878', PLTR: '0001321655',
  ABT: '0000001800', ABBV: '0001551152', TMO: '0000097745', PFE: '0000078003',
  AMGN: '0000318154', GILD: '0000882095', BMY: '0000014272', CVS: '0000064803',
  ISRG: '0001035267', DHR: '0000313616',
  BRKB: '0001067983', 'BRK.B': '0001067983', BAC: '0000070858', WFC: '0000072971',
  C: '0000831001', GS: '0000886982', MS: '0000895421', AXP: '0000004962',
  BLK: '0001364742', SPGI: '0000064040', SCHW: '0000316709',
  HD: '0000354950', LOW: '0000060667', MCD: '0000063908', SBUX: '0000829224',
  BKNG: '0001075531', MDLZ: '0001103982', MO: '0000764180', CL: '0000021665',
  PM: '0001413329', DIS: '0001744489',
  XOM: '0000034088', CVX: '0000093410', CAT: '0000018230', DE: '0000315189',
  BA: '0000012927', MMM: '0000066740', HON: '0000773840', GE: '0000040545',
  UPS: '0001090727', F: '0000037996', GM: '0001467858',
  VZ: '0000732712', T: '0000732717',
};

// Concept alias lists (probamos en orden hasta que una devuelva datos).
export const CONCEPTS = {
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  dna: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'Depreciation'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  operatingIncome: ['OperatingIncomeLoss'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  dividendPerShare: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  totalDebtLong: ['LongTermDebtNoncurrent', 'LongTermDebt'],
  totalDebtShort: ['LongTermDebtCurrent', 'DebtCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  shortTermInvestments: ['ShortTermInvestments', 'AvailableForSaleSecuritiesCurrent'],
  taxes: ['IncomeTaxExpenseBenefit'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  interestExpense: ['InterestExpense', 'InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpenseNonoperating'],
} as const;

interface Raw { end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; }
export interface AnnualPoint { fy: number; end: string; val: number; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Devuelve la serie de un concepto. Distingue "no existe" (404/403 → null definitivo) de errores
// transitorios (429/5xx/red → reintenta con backoff), para no confundir un rate-limit del proxy
// con ausencia real de dato. Elige la unidad correcta (USD / USD/shares / shares) explícitamente.
async function fetchConcept(env: Env, cik: string, taxonomy: string, concept: string): Promise<Raw[] | null> {
  // Normalizar la base: si el secret SEC_PROXY_BASE termina en "/", la doble barra resultante
  // hacía que el worker respondiera 400 "Ruta no permitida" para TODOS los conceptos.
  const base = (env.SEC_PROXY_BASE || '').replace(/\/+$/, '');
  const url = `${base}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json?k=${env.SEC_PROXY_TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      await sleep(300 * (attempt + 1));   // error de red → reintento
      continue;
    }
    if (res.status === 404 || res.status === 403) return null;              // concepto inexistente
    if (res.status === 429 || res.status >= 500) { await sleep(400 * (attempt + 1)); continue; } // transitorio
    if (!res.ok) return null;
    const data = await res.json() as { units?: Record<string, Raw[]> };
    const units = data.units ?? {};
    const keys = Object.keys(units);
    const key = keys.find(k => k === 'USD') ?? keys.find(k => k === 'USD/shares') ?? keys.find(k => k === 'shares') ?? keys[0];
    return key ? units[key] : null;
  }
  return null; // reintentos agotados
}

// Try each alias; return the first concept that yields data.
async function fetchFirst(env: Env, cik: string, taxonomy: string, aliases: readonly string[]): Promise<Raw[] | null> {
  for (const a of aliases) {
    const r = await fetchConcept(env, cik, taxonomy, a);
    if (r && r.length) return r;
  }
  return null;
}

// Annual flow series: only 10-K FY points; when a period repeats across filings,
// keep the latest-filed value; sorted oldest→newest.
function parseAnnual(raw: Raw[] | null): AnnualPoint[] {
  if (!raw) return [];
  const tenK = raw.filter(x => (x.form ?? '').startsWith('10-K') && (x.fp === 'FY' || x.fp == null));
  const byEnd = new Map<string, Raw>();
  for (const x of tenK) {
    const prev = byEnd.get(x.end);
    if (!prev || (x.filed ?? '') > (prev.filed ?? '')) byEnd.set(x.end, x);
  }
  return [...byEnd.values()]
    .map(x => ({ fy: x.fy ?? Number(x.end.slice(0, 4)), end: x.end, val: x.val }))
    .sort((a, b) => a.end.localeCompare(b.end));
}

// Latest instant value (balance-sheet / share count): max by (end, filed).
function parseLatest(raw: Raw[] | null): number | null {
  if (!raw || !raw.length) return null;
  const sorted = [...raw].sort((a, b) => (a.end + (a.filed ?? '')).localeCompare(b.end + (b.filed ?? '')));
  return sorted[sorted.length - 1].val;
}

// Sum two annual series by fiscal year (long + short debt → total debt).
function sumByFy(a: AnnualPoint[], b: AnnualPoint[]): AnnualPoint[] {
  const m = new Map<number, AnnualPoint>();
  for (const p of a) m.set(p.fy, { ...p });
  for (const p of b) { const e = m.get(p.fy); if (e) e.val += p.val; else m.set(p.fy, { ...p }); }
  return [...m.values()].sort((x, y) => x.fy - y.fy);
}

export interface EdgarFundamentals {
  ticker: string; cik: string; entityName: string | null; shares: number | null;
  ocf: AnnualPoint[]; netIncome: AnnualPoint[]; dna: AnnualPoint[]; capex: AnnualPoint[];
  revenue: AnnualPoint[]; operatingIncome: AnnualPoint[]; epsDiluted: AnnualPoint[];
  dividendPerShare: AnnualPoint[]; equity: AnnualPoint[]; totalDebt: AnnualPoint[];
  cash: AnnualPoint[]; shortTermInvestments: AnnualPoint[]; taxes: AnnualPoint[];
  pretaxIncome: AnnualPoint[]; interestExpense: AnnualPoint[]; ungradeable: string[];
}

export async function fetchFundamentals(env: Env, ticker: string, cik: string): Promise<EdgarFundamentals> {
  const g = (aliases: readonly string[]) => fetchFirst(env, cik, 'us-gaap', aliases);
  const [ocf, ni, dna, capex, rev, opInc, eps, dps, eq, dl, ds, cash, sti, tax, pre, intExp, sharesRaw] = await Promise.all([
    g(CONCEPTS.ocf), g(CONCEPTS.netIncome), g(CONCEPTS.dna), g(CONCEPTS.capex),
    g(CONCEPTS.revenue), g(CONCEPTS.operatingIncome), g(CONCEPTS.epsDiluted), g(CONCEPTS.dividendPerShare),
    g(CONCEPTS.equity), g(CONCEPTS.totalDebtLong), g(CONCEPTS.totalDebtShort), g(CONCEPTS.cash),
    g(CONCEPTS.shortTermInvestments), g(CONCEPTS.taxes), g(CONCEPTS.pretaxIncome), g(CONCEPTS.interestExpense),
    fetchConcept(env, cik, 'dei', 'EntityCommonStockSharesOutstanding'),
  ]);

  const P = {
    ocf: parseAnnual(ocf), netIncome: parseAnnual(ni), dna: parseAnnual(dna), capex: parseAnnual(capex),
    revenue: parseAnnual(rev), operatingIncome: parseAnnual(opInc), epsDiluted: parseAnnual(eps),
    dividendPerShare: parseAnnual(dps), equity: parseAnnual(eq), totalDebt: sumByFy(parseAnnual(dl), parseAnnual(ds)),
    cash: parseAnnual(cash), shortTermInvestments: parseAnnual(sti), taxes: parseAnnual(tax),
    pretaxIncome: parseAnnual(pre), interestExpense: parseAnnual(intExp),
  };

  // Marcamos como "ungradeable" TODO campo crítico que alimenta el DCF (owner earnings) o los
  // ratios (ROIC, P/B) — no solo ocf/eps/revenue — para poder avisar cuando falta algo clave.
  const criticos: [string, AnnualPoint[]][] = [
    ['ocf', P.ocf], ['epsDiluted', P.epsDiluted], ['revenue', P.revenue],
    ['dna', P.dna], ['capex', P.capex], ['equity', P.equity], ['totalDebt', P.totalDebt], ['cash', P.cash],
  ];
  const ungradeable = criticos.filter(([, v]) => v.length === 0).map(([k]) => k);

  return { ticker, cik, entityName: null, shares: parseLatest(sharesRaw), ...P, ungradeable };
}
