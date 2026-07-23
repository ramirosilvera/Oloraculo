import type { Posicion } from '../types/domain';

// Valor en USD de UNA unidad. Un CEDEAR liquida por (precio_subyacente / ratio); si el
// ratio no está cargado o es 0, devolvemos null (mostrar "—" y NO computar en el patrimonio)
// en vez de valuarlo al precio del subyacente completo — eso sobrevaluaba la posición N×.
export function unitValueUSD(p: Posicion, live: number | null): number | null {
  if (live == null) return null;
  if (p.tipo === 'cedear') return p.ratio_cedear && p.ratio_cedear > 0 ? live / p.ratio_cedear : null;
  return live; // etf/bono (precio ya por nominal) / cash
}

// Valor USD de una unidad, con soporte para valuar CEDEARs por su especie en pesos (BYMA ÷ MEP).
// Si la posición es un CEDEAR sin ratio (no valuable por subyacente) y hay precio de la especie en
// pesos, ese precio YA es USD por CEDEAR y se usa directo. Si no, cae al modelo subyacente/ratio.
export function resolveUnitUSD(p: Posicion, live: number | null, cedearPesoUsd?: number | null): number | null {
  if (p.tipo === 'cedear' && (p.ratio_cedear == null || p.ratio_cedear <= 0) && cedearPesoUsd != null && cedearPesoUsd > 0) {
    return cedearPesoUsd;
  }
  return unitValueUSD(p, live);
}

// Valor de mercado de la posición, o null si no hay precio válido.
export function marketValueUSD(p: Posicion, live: number | null): number | null {
  const u = unitValueUSD(p, live);
  return u != null ? u * p.cantidad : null;
}

// Valor a costo (cantidad × precio de compra).
export function costUSD(p: Posicion): number {
  return p.precio_compra * p.cantidad;
}
