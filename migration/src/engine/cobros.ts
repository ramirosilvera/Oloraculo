// =============================================================================
// Resumen de cobros REALES (dividendos, intereses, amortizaciones) — puro y testeado. La
// amortización es devolución de CAPITAL, no renta: se suma al total cobrado en USD igual que las
// demás (es plata real que entró), pero se desglosa aparte en `porTipo` para no confundirla con
// renta al leer el desglose.
// =============================================================================

import type { Cobro, CobroTipo } from '../types/domain';

export interface ResumenCobros {
  total: number;
  disponible: number;   // cobrado y todavía sin reinvertir
  reinvertido: number;
  porTipo: Record<CobroTipo, number>;
}

export function resumenCobros(cobros: Cobro[]): ResumenCobros {
  const porTipo: Record<CobroTipo, number> = { dividendo: 0, interes: 0, amortizacion: 0 };
  let total = 0, disponible = 0, reinvertido = 0;
  for (const c of cobros) {
    const m = Number(c.monto) || 0;
    total += m;
    porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + m;
    if (c.estado === 'reinvertido') reinvertido += m; else disponible += m;
  }
  return { total: +total.toFixed(2), disponible: +disponible.toFixed(2), reinvertido: +reinvertido.toFixed(2), porTipo };
}
