// =============================================================================
// TIR (IRR money-weighted) sobre flujos de caja fechados — XIRR. Puro y determinista.
// r anual tal que Σ monto_i / (1+r)^(días_i/365) = 0. Newton-Raphson con bisección de respaldo.
// Convención de signos: capital que ENTRA al portfolio es negativo (salida de tu bolsillo);
// el valor actual y las ventas son positivos (lo que recuperás).
// =============================================================================

export interface CashFlow {
  date: string;   // ISO 'YYYY-MM-DD'
  amount: number; // firmado: aportes/compras < 0, ventas/valor final > 0
}

const DAY = 86_400_000;

// Valor presente neto de los flujos a una tasa anual r.
function npv(cfs: { t: number; amount: number }[], r: number): number {
  return cfs.reduce((s, f) => s + f.amount / Math.pow(1 + r, f.t), 0);
}
function dNpv(cfs: { t: number; amount: number }[], r: number): number {
  return cfs.reduce((s, f) => s - (f.t * f.amount) / Math.pow(1 + r, f.t + 1), 0);
}

// XIRR anualizada. Devuelve null si no hay flujos válidos, si no hay signos opuestos, si el
// horizonte es 0 (todo el mismo día) o si no converge.
export function xirr(flows: CashFlow[]): number | null {
  const valid = flows.filter(f => Number.isFinite(f.amount) && f.amount !== 0 && !Number.isNaN(Date.parse(f.date)));
  if (valid.length < 2) return null;
  if (!valid.some(f => f.amount > 0) || !valid.some(f => f.amount < 0)) return null;

  const t0 = Math.min(...valid.map(f => Date.parse(f.date)));
  const tN = Math.max(...valid.map(f => Date.parse(f.date)));
  if (tN === t0) return null; // sin horizonte temporal
  const cfs = valid.map(f => ({ t: (Date.parse(f.date) - t0) / (365 * DAY), amount: f.amount }));

  // Newton-Raphson desde 10%.
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(cfs, r);
    if (Math.abs(f) < 1e-7) return clampResult(r);
    const d = dNpv(cfs, r);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-9) { r = next; break; }
    r = next;
  }
  if (Number.isFinite(r) && r > -0.9999 && Math.abs(npv(cfs, r)) < 1e-4) return clampResult(r);

  // Respaldo: bisección sobre [-0.9999, 100] buscando cambio de signo del NPV.
  let lo = -0.9999, hi = 100;
  let flo = npv(cfs, lo), fhi = npv(cfs, hi);
  if (!(Number.isFinite(flo) && Number.isFinite(fhi)) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(cfs, mid);
    if (Math.abs(fm) < 1e-7) return clampResult(mid);
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return clampResult((lo + hi) / 2);
}

// Evita devolver ruido numérico absurdo (>1000%/año casi siempre es un artefacto de datos).
function clampResult(r: number): number | null {
  if (!Number.isFinite(r)) return null;
  if (r > 10) return null;
  return r;
}

// ── TIR del portfolio ─────────────────────────────────────────────────────────
export interface PortfolioTir {
  anual: number | null;        // XIRR anualizada (money-weighted)
  historica: number | null;    // rendimiento total acumulado sobre el capital aportado
  invertido: number;           // base de capital externo (aportes) o costo (fallback)
  base: 'aportes' | 'costos' | 'sin-datos';
  aproximada: boolean;         // true si se usó el fallback por costos (sin registro de aportes)
}

// Construye la TIR del portfolio. PRIMARIO: aportes (capital externo con fecha) + valor actual.
// FALLBACK (aproximado): costo de las posiciones abiertas en su fecha_compra. Los trades internos
// (movimientos) NO entran: comprar un activo con plata que ya estaba adentro no es capital nuevo.
// Nota: como los flujos son todos negativos (aportes/costos) + UN terminal positivo, hay un solo
// cambio de signo → la XIRR tiene raíz única (no aplica la ambigüedad de IRR múltiple).
export function portfolioTir(params: {
  aportes: { monto: number; fecha: string }[];
  costos: { costo: number; fecha: string | null }[];
  valorActual: number;
  hoy: string;
}): PortfolioTir {
  const { aportes, costos, valorActual, hoy } = params;
  const terminal: CashFlow = { date: hoy, amount: valorActual };

  const aportesOk = aportes.filter(a => a.monto > 0 && !Number.isNaN(Date.parse(a.fecha)));
  if (aportesOk.length) {
    const invertido = aportesOk.reduce((s, a) => s + a.monto, 0);
    const flows: CashFlow[] = [...aportesOk.map(a => ({ date: a.fecha, amount: -a.monto })), terminal];
    return {
      anual: xirr(flows),
      historica: invertido > 0 ? valorActual / invertido - 1 : null,
      invertido, base: 'aportes', aproximada: false,
    };
  }

  const costosOk = costos.filter(c => c.costo > 0 && c.fecha && !Number.isNaN(Date.parse(c.fecha)));
  if (costosOk.length) {
    const invertido = costosOk.reduce((s, c) => s + c.costo, 0);
    const flows: CashFlow[] = [...costosOk.map(c => ({ date: c.fecha!, amount: -c.costo })), terminal];
    return {
      anual: xirr(flows),
      historica: invertido > 0 ? valorActual / invertido - 1 : null,
      invertido, base: 'costos', aproximada: true,
    };
  }

  return { anual: null, historica: null, invertido: 0, base: 'sin-datos', aproximada: false };
}
