// =============================================================================
// Valuación DCF por Owner Earnings (Buffett / Munger). Puro y determinista.
// Owner Earnings = Cash Flow Operativo − Capex de MANTENIMIENTO.
// El capex de CRECIMIENTO (capex total − mantenimiento) se expone aparte: dice
// cuánto invierte la empresa en crecer (y cuánto deprime su FCF de hoy).
// =============================================================================

import type { Fundamentals, AnnualPoint, Ratios } from '../types/domain';

export type CapexMethod = 'dna' | 'capex' | 'avg';

export interface DcfInputs {
  g: number;                 // crecimiento explícito anual (ej. 0.08)
  d: number;                 // tasa de descuento (ej. 0.10)
  gt: number;                // crecimiento terminal (ej. 0.025)
  N: number;                 // años explícitos (default 10)
  capexMethod: CapexMethod;  // capex de mantenimiento
  mosRequired: number;       // margen de seguridad exigido (ej. 0.30)
}

export const DEFAULT_DCF_INPUTS: DcfInputs = {
  g: 0.08, d: 0.10, gt: 0.03, N: 20, capexMethod: 'dna', mosRequired: 0.20,
};

// Techo de crecimiento explícito: ninguna empresa sostiene >15% anual durante N años. Sin este
// tope, un EG5Y histórico alto (growth) proyectado 20 años produce un valor intrínseco absurdo.
export const G_MAX = 0.15;

// Supuestos por defecto CALCULADOS por empresa: g = EG5Y real − 1 punto; d = Ke (CAPM);
// gt 3%, N 20 años, MoS exigido 20%. Son el punto de partida; el usuario puede editar y guardar.
//
// POR QUÉ Ke Y NO WACC: los owner earnings (OCF − capex mant.) ya están DESPUÉS de intereses, o sea
// son flujo del ACCIONISTA, y el valor resultante se divide directo por acciones sin restar deuda
// neta → es una valuación de equity. Descontarla al WACC (que mezcla deuda más barata) infla el
// valor cuanto más apalancada esté la empresa. El WACC correspondería solo si se descontara un
// flujo unlevered (FCFF) y luego se restara la deuda neta, que no es lo que hace este modelo.
//
// g se acota a G_MAX y, además, por debajo de d: con g ≥ d el período explícito compone hacia
// arriba y el modelo deja de ser estable (ver el gate del veredicto en computeDcf).
export function dcfDefaultsFor(r: Ratios): DcfInputs {
  const d = r.costOfEquity != null ? Math.max(0.06, +r.costOfEquity.toFixed(4)) : DEFAULT_DCF_INPUTS.d; // piso 6%
  const gBruto = r.eg5y != null ? Math.max(0, r.eg5y - 0.01) : DEFAULT_DCF_INPUTS.g;
  const g = +Math.max(0, Math.min(gBruto, G_MAX, d - 0.01)).toFixed(4);
  return { g, d, gt: 0.03, N: 20, capexMethod: 'dna', mosRequired: 0.20 };
}

export interface OwnerEarningsYear {
  fy: number;
  ocf: number;
  maintenanceCapex: number;
  growthCapex: number;
  ownerEarnings: number;
}

export interface MungerCheck { label: string; ok: boolean; detail: string; }

export interface DcfResult {
  ownerEarningsByYear: OwnerEarningsYear[];
  ownerEarningsNorm: number;        // promedio 5 años
  histCagrOE: number | null;        // CAGR histórico de owner earnings
  intrinsicValue: number;           // equity total
  intrinsicPerShare: number | null;
  terminalPV: number;
  terminalShare: number;            // % del valor total que viene de la perpetuidad
  marginOfSafety: number | null;    // 1 − precio/valor
  verdict: 'COMPRAR' | 'ESPERAR' | 'CARO' | 'SIN_DATOS';
  motivoInestable: string | null;   // si != null, el veredicto NO puede ser COMPRAR (supuestos frágiles)
  mungerChecks: MungerCheck[];
  shares: number | null;
  price: number | null;
}

const byFy = (arr: AnnualPoint[]) => new Map(arr.map(p => [p.fy, p.val]));

// Join OCF / D&A / capex por año fiscal y arma owner earnings por año.
export function ownerEarningsByYear(f: Fundamentals, method: CapexMethod): OwnerEarningsYear[] {
  const ocf = byFy(f.ocf), dna = byFy(f.dna), capex = byFy(f.capex);
  // Exigir SOLO lo que el método necesita. Antes se pedía capex siempre, incluso con el método
  // 'dna' (el default), que no lo usa: si EDGAR no traía el capex del último año, ese año se
  // descartaba entero y los owner earnings normalizados quedaban anclados a años viejos y chicos.
  const needsDna = method === 'dna' || method === 'avg';
  const needsCapex = method === 'capex' || method === 'avg';
  const years = [...ocf.keys()]
    .filter(fy => (!needsDna || dna.has(fy)) && (!needsCapex || capex.has(fy)))
    .sort((a, b) => a - b);
  return years.map(fy => {
    const cf = ocf.get(fy)!;
    const d = dna.has(fy) ? Math.abs(dna.get(fy)!) : 0;
    const tieneCapex = capex.has(fy);
    const cx = tieneCapex ? Math.abs(capex.get(fy)!) : 0;
    const maint = method === 'dna' ? d : method === 'capex' ? cx : (d + cx) / 2;
    // El capex de crecimiento solo tiene sentido si conocemos el capex total del año.
    return { fy, ocf: cf, maintenanceCapex: maint, growthCapex: tieneCapex ? cx - maint : 0, ownerEarnings: cf - maint };
  });
}

// CAGR histórico de owner earnings (para el chequeo Munger de "supuesto no optimista").
function cagr(series: number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0], last = series[series.length - 1];
  if (first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / (series.length - 1)) - 1;
}

export function computeDcf(f: Fundamentals, price: number | null, wacc: number | null, inp: DcfInputs, roic: number | null = null): DcfResult {
  const oeYears = ownerEarningsByYear(f, inp.capexMethod);
  const last5 = oeYears.slice(-5);
  const shares = f.shares ?? null;

  if (last5.length === 0) {
    return {
      ownerEarningsByYear: oeYears, ownerEarningsNorm: 0, histCagrOE: null,
      intrinsicValue: 0, intrinsicPerShare: null, terminalPV: 0, terminalShare: 0,
      marginOfSafety: null, verdict: 'SIN_DATOS', motivoInestable: null, mungerChecks: [], shares, price,
    };
  }

  const ownerEarningsNorm = last5.reduce((s, y) => s + y.ownerEarnings, 0) / last5.length;
  const histCagrOE = cagr(last5.map(y => y.ownerEarnings));

  // Owner earnings normalizados ≤ 0 (capex agresivo / OCF < capex mant.): el DCF no
  // aplica. Sin esto, un valor intrínseco negativo produce MoS > 100% y un falso "COMPRAR".
  if (ownerEarningsNorm <= 0) {
    return {
      ownerEarningsByYear: oeYears, ownerEarningsNorm, histCagrOE,
      intrinsicValue: 0, intrinsicPerShare: null, terminalPV: 0, terminalShare: 0,
      marginOfSafety: null, verdict: 'SIN_DATOS', motivoInestable: null,
      mungerChecks: [], shares, price,
    };
  }

  // Proyección: N años a tasa g, descontados a d, valor terminal de Gordon con gt.
  // Saneamos los supuestos: un N no finito o enorme (dato guardado corrupto) haría que el bucle
  // no termine y cuelgue el render; g/d/gt no finitos propagarían NaN. N se acota a 1..100.
  const g = Number.isFinite(inp.g) ? inp.g : DEFAULT_DCF_INPUTS.g;
  const d = Number.isFinite(inp.d) && inp.d > 0 ? inp.d : DEFAULT_DCF_INPUTS.d;
  const gt = Number.isFinite(inp.gt) ? inp.gt : DEFAULT_DCF_INPUTS.gt;
  const N = Number.isFinite(inp.N) ? Math.min(Math.max(Math.round(inp.N), 1), 100) : DEFAULT_DCF_INPUTS.N;
  let pvExplicit = 0;
  let oeT = ownerEarningsNorm;
  for (let t = 1; t <= N; t++) {
    oeT = ownerEarningsNorm * (1 + g) ** t;
    pvExplicit += oeT / (1 + d) ** t;
  }
  const oeN = ownerEarningsNorm * (1 + g) ** N;
  // Guarda: si d <= gt el modelo de Gordon no es válido (valor infinito) → terminal 0.
  const terminalValue = d > gt ? (oeN * (1 + gt)) / (d - gt) : 0;
  const terminalPV = terminalValue / (1 + d) ** N;

  const intrinsicValue = pvExplicit + terminalPV;
  const intrinsicPerShare = shares && shares > 0 ? intrinsicValue / shares : null;
  const terminalShare = intrinsicValue > 0 ? terminalPV / intrinsicValue : 0;
  const marginOfSafety = intrinsicPerShare && intrinsicPerShare > 0 && price ? 1 - price / intrinsicPerShare : null;

  // Gate de estabilidad: con g ≥ d el período explícito compone hacia arriba (el valor intrínseco
  // se infla y daría un COMPRAR falso), y un valor terminal que es casi todo el total significa que
  // la valuación depende de una perpetuidad, no del negocio proyectado. En esos casos NO afirmamos
  // COMPRAR: degradamos a ESPERAR y exponemos el motivo para que el usuario revise los supuestos.
  const motivoInestable = !(g < d)
    ? `supuesto inestable: g ${(g * 100).toFixed(1)}% ≥ d ${(d * 100).toFixed(1)}%`
    : terminalShare > 0.85
      ? `el ${(terminalShare * 100).toFixed(0)}% del valor viene de la perpetuidad`
      : null;

  const verdict: DcfResult['verdict'] =
    marginOfSafety == null ? 'SIN_DATOS'
    : (marginOfSafety >= inp.mosRequired && !motivoInestable) ? 'COMPRAR'
    : marginOfSafety >= 0 ? 'ESPERAR' : 'CARO';

  const mungerChecks: MungerCheck[] = [
    {
      // ROIC es retorno sobre el capital TOTAL (equity + deuda), así que el benchmark correcto es el
      // WACC (costo del capital total), no Ke. El rótulo decía "Ke" aunque recibía el WACC.
      label: '¿ROIC > WACC? (crea valor)',
      ok: roic != null && wacc != null ? roic > wacc : false,
      detail: roic != null && wacc != null ? `ROIC ${(roic * 100).toFixed(1)}% vs WACC ${(wacc * 100).toFixed(1)}%` : 'ROIC/WACC no disponible',
    },
    {
      label: '¿g ≤ CAGR histórico de owner earnings? (supuesto no optimista)',
      ok: histCagrOE != null ? g <= histCagrOE + 1e-9 : false,
      detail: histCagrOE != null ? `g ${(g * 100).toFixed(1)}% vs histórico ${(histCagrOE * 100).toFixed(1)}%` : 'sin histórico',
    },
    {
      label: '¿g < d? (modelo estable)',
      ok: g < d,
      detail: `g ${(g * 100).toFixed(1)}% vs d ${(d * 100).toFixed(1)}%`,
    },
    {
      label: '¿valor terminal < 75% del total?',
      ok: terminalShare < 0.75,
      detail: `terminal = ${(terminalShare * 100).toFixed(0)}% del valor`,
    },
  ];

  return {
    ownerEarningsByYear: oeYears, ownerEarningsNorm, histCagrOE,
    intrinsicValue, intrinsicPerShare, terminalPV, terminalShare,
    marginOfSafety, verdict, motivoInestable, mungerChecks, shares, price,
  };
}

// Tabla de sensibilidad: valor intrínseco por acción variando g (filas) contra d (columnas).
export function sensitivityTable(
  f: Fundamentals, wacc: number | null, base: DcfInputs,
  gValues: number[], dValues: number[],
): { g: number; cells: (number | null)[] }[] {
  return gValues.map(g => ({
    g,
    cells: dValues.map(d => computeDcf(f, null, wacc, { ...base, g, d }).intrinsicPerShare),
  }));
}
