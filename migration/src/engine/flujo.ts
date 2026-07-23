// =============================================================================
// Flujo de caja personal — motor puro (los NÚMEROS los calcula el código).
// Modelo cascada: Ingresos − Egresos = Disponible → se asigna a inversiones
// (FCI, Mercado Pago, CEDEARs, bonos…). Reporta todo en ARS; convierte filas en
// USD con el MEP real. Sin MEP, las filas en USD quedan pendientes (nunca inventa).
// =============================================================================

export type FlujoCategoria = 'ingreso' | 'egreso' | 'inversion';
export type FlujoDestino = 'fci' | 'mercadopago' | 'cedears' | 'bonos' | 'efectivo' | 'otro';
export type Moneda = 'ARS' | 'USD';

export interface FlujoItemLike {
  categoria: FlujoCategoria;
  monto: number;
  moneda: Moneda | string;
  destino?: FlujoDestino | string | null;
  activo?: boolean;
}

export interface ResumenFlujo {
  ingresos: number;              // en ARS
  egresos: number;
  disponible: number;            // ingresos − egresos
  invertido: number;             // Σ inversiones
  sinAsignar: number;            // disponible − invertido (lo que todavía no colocaste)
  porDestino: Record<string, number>;
  fci: number;                   // sleeve near-cash: fci + mercadopago
  tasaAhorro: number | null;     // disponible / ingresos (0..1)
  pendientesConversion: number;  // filas en USD que no se pudieron convertir (sin MEP)
  mep: number | null;
}

// Los destinos que consideramos "liquidez / FCI" para el Dashboard.
export const DESTINOS_FCI: FlujoDestino[] = ['fci', 'mercadopago'];

// Convierte un ítem a ARS. USD → ARS con el MEP; sin MEP devuelve null (pendiente).
function montoEnArs(i: FlujoItemLike, mep: number | null): number | null {
  const m = Number(i.monto) || 0;
  if (i.moneda === 'USD') return mep != null && mep > 0 ? m * mep : null;
  return m; // ARS (o cualquier otra cosa se trata como ARS)
}

export function resumenFlujo(items: FlujoItemLike[], mep: number | null): ResumenFlujo {
  const activos = items.filter(i => i.activo !== false);
  let ingresos = 0, egresos = 0, invertido = 0, pendientes = 0;
  const porDestino: Record<string, number> = {};

  for (const i of activos) {
    const v = montoEnArs(i, mep);
    if (v == null) { pendientes++; continue; }
    if (i.categoria === 'ingreso') ingresos += v;
    else if (i.categoria === 'egreso') egresos += v;
    else {
      invertido += v;
      const d = (i.destino as string) || 'otro';
      porDestino[d] = (porDestino[d] ?? 0) + v;
    }
  }

  const disponible = ingresos - egresos;
  const fci = DESTINOS_FCI.reduce((s, d) => s + (porDestino[d] ?? 0), 0);
  return {
    ingresos, egresos, disponible, invertido,
    sinAsignar: disponible - invertido,
    porDestino, fci,
    tasaAhorro: ingresos > 0 ? disponible / ingresos : null,
    pendientesConversion: pendientes,
    mep,
  };
}
