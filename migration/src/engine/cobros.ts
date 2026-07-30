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
    // 'pendiente' (generado por el cron, sin confirmar) NO es plata cobrada todavía — no debe
    // sumar a NINGÚN total. A propósito NO es un `else`: un estado nuevo que se agregue en el
    // futuro sin tocar esta función cae acá y queda afuera de los totales por default, en vez de
    // colarse silenciosamente en "disponible" (así se coló un bug real en tenencia.ts esta sesión).
    if (c.estado === 'pendiente') continue;
    const m = Number(c.monto) || 0;
    total += m;
    porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + m;
    if (c.estado === 'reinvertido') reinvertido += m;
    else if (c.estado === 'disponible') disponible += m;
  }
  return { total: +total.toFixed(2), disponible: +disponible.toFixed(2), reinvertido: +reinvertido.toFixed(2), porTipo };
}
