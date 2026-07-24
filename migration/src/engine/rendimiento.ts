// =============================================================================
// Rendimiento por año calendario (como los fondos): cuánto rindió el portfolio en 2025, 2026, etc.
// Es rendimiento del PASADO, no anualizado ni proyectado. Puro y determinista.
//
// Cada "punto" es el valor de mercado del portfolio a una fecha + el capital APORTADO acumulado
// (neto: aportes − retiros) a esa fecha. El rendimiento de un año = ganancia del año sobre el
// capital que estuvo trabajando: (Vfin − Vini − aportesNetosDelAño) / (Vini + aportesNetosDelAño).
// Simple (no time-weighted) pero estable; coincide con el total cuando el portfolio nace ese año.
//
// HONESTO ante la falta de datos: un año solo se calcula si hay un CIERRE real dentro del año
// (snapshot ≥ inicio del año) y una APERTURA válida (snapshot del año previo, o 0 si es el año de
// creación). Los años sin datos suficientes devuelven null (no se inventa el corte).
// =============================================================================

export interface Punto { fecha: string; valor: number; aportado: number } // aportado = neto acumulado
export interface RendAnio { anio: number; rendimiento: number | null }

export function rendimientoPorAnio(puntos: Punto[], inceptionYear: number, hoy: string): RendAnio[] {
  const pts = puntos
    .filter(p => p && !Number.isNaN(Date.parse(p.fecha)) && Number.isFinite(p.valor) && Number.isFinite(p.aportado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (Number.isNaN(Date.parse(hoy)) || !Number.isFinite(inceptionYear)) return [];

  const hasta = Number(hoy.slice(0, 4));
  const out: RendAnio[] = [];

  for (let y = inceptionYear; y <= hasta; y++) {
    const yStart = `${y}-01-01`;
    const yEnd = `${y}-12-31`;
    // Apertura: 0 si es el año de creación; si no, el último snapshot ANTES del año (cierre previo).
    const prior = [...pts].reverse().find(p => p.fecha < yStart);
    const vIni = y === inceptionYear ? 0 : (prior ? prior.valor : null);
    const aIni = y === inceptionYear ? 0 : (prior ? prior.aportado : null);
    // Cierre: último punto DENTRO del año (≥ inicio, ≤ fin). Para el año en curso, hoy cae adentro.
    const fin = [...pts].reverse().find(p => p.fecha >= yStart && p.fecha <= yEnd);

    if (vIni == null || aIni == null || !fin) { out.push({ anio: y, rendimiento: null }); continue; }
    const fNeto = fin.aportado - aIni;     // aportes netos del año (aportes − retiros)
    const base = vIni + fNeto;             // capital que estuvo trabajando
    const rend = Math.abs(base) > 1e-9 ? (fin.valor - vIni - fNeto) / base : null;
    out.push({ anio: y, rendimiento: rend });
  }
  return out;
}
