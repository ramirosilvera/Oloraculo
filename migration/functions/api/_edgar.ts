// SEC EDGAR fundamentals via the existing Cloudflare proxy (data.sec.gov blocks
// datacenter IPs / requires a compliant User-Agent — the proxy handles that).
// Proxy shape: {BASE}/api/xbrl/companyconcept/CIK{cik10}/{taxonomy}/{Concept}.json?k={TOKEN}

import type { Env } from './_shared';

// Default ticker→CIK (EDGAR blocks the ticker lookup file from datacenter IPs, so
// these are hardcoded; the user can add more via the cik_map table).
export const DEFAULT_CIK: Record<string, string> = {
  UNH: '0000731766', MA: '0001141391', MSFT: '0000789019', GOOGL: '0001652044',
  MRK: '0000310158', MELI: '0001099590', LAC: '0001966983', ADBE: '0000796343',
  AMZN: '0001018724', ACN: '0001467373', NKE: '0000320187', AAPL: '0000320193',
  ASML: '0000937966', KO: '0000021344', V: '0001403161', WMT: '0000104169',
  NVDA: '0001045810', META: '0001326801', JNJ: '0000200406', PG: '0000080424',
  PEP: '0000077476', COST: '0000909832', LLY: '0000059478', JPM: '0000019617',
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
} as const;

interface Raw { end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; }
export interface AnnualPoint { fy: number; end: string; val: number; }

async function fetchConcept(env: Env, cik: string, taxonomy: string, concept: string): Promise<Raw[] | null> {
  const url = `${env.SEC_PROXY_BASE}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json?k=${env.SEC_PROXY_TOKEN}`;
  const res = await fetch(url);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) return null;
  const data = await res.json() as { units?: Record<string, Raw[]> };
  const units = data.units ?? {};
  // USD for money, USD/shares for EPS, shares for share counts — take the first present.
  const key = Object.keys(units)[0];
  return key ? units[key] : null;
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
  const tenK = raw.filter(x => x.form === '10-K' && (x.fp === 'FY' || x.fp == null));
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
  pretaxIncome: AnnualPoint[]; ungradeable: string[];
}

export async function fetchFundamentals(env: Env, ticker: string, cik: string): Promise<EdgarFundamentals> {
  const g = (aliases: readonly string[]) => fetchFirst(env, cik, 'us-gaap', aliases);
  const [ocf, ni, dna, capex, rev, opInc, eps, dps, eq, dl, ds, cash, sti, tax, pre, sharesRaw] = await Promise.all([
    g(CONCEPTS.ocf), g(CONCEPTS.netIncome), g(CONCEPTS.dna), g(CONCEPTS.capex),
    g(CONCEPTS.revenue), g(CONCEPTS.operatingIncome), g(CONCEPTS.epsDiluted), g(CONCEPTS.dividendPerShare),
    g(CONCEPTS.equity), g(CONCEPTS.totalDebtLong), g(CONCEPTS.totalDebtShort), g(CONCEPTS.cash),
    g(CONCEPTS.shortTermInvestments), g(CONCEPTS.taxes), g(CONCEPTS.pretaxIncome),
    fetchConcept(env, cik, 'dei', 'EntityCommonStockSharesOutstanding'),
  ]);

  const totalDebt = sumByFy(parseAnnual(dl), parseAnnual(ds));
  const ungradeable: string[] = [];
  const req: [string, AnnualPoint[]][] = [['ocf', parseAnnual(ocf)], ['epsDiluted', parseAnnual(eps)], ['revenue', parseAnnual(rev)]];
  for (const [k, v] of req) if (v.length === 0) ungradeable.push(k);

  return {
    ticker, cik, entityName: null, shares: parseLatest(sharesRaw),
    ocf: parseAnnual(ocf), netIncome: parseAnnual(ni), dna: parseAnnual(dna), capex: parseAnnual(capex),
    revenue: parseAnnual(rev), operatingIncome: parseAnnual(opInc), epsDiluted: parseAnnual(eps),
    dividendPerShare: parseAnnual(dps), equity: parseAnnual(eq), totalDebt,
    cash: parseAnnual(cash), shortTermInvestments: parseAnnual(sti), taxes: parseAnnual(tax),
    pretaxIncome: parseAnnual(pre), ungradeable,
  };
}
