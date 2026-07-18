// =============================================================================
// P&L realizado a partir del historial de movimientos. Puro y determinista.
// Recorre los movimientos en orden cronológico manteniendo cantidad y COSTO PROMEDIO
// corriente; en cada venta realiza (precioVenta − costoPromedio) × cantidad.
// =============================================================================

import type { Movimiento } from '../types/domain';

export interface RealizedResult {
  porTicker: Record<string, number>;
  total: number;
}

const crono = (a: Movimiento, b: Movimiento): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

export function realizedPnl(movs: Movimiento[]): RealizedResult {
  const byTicker: Record<string, Movimiento[]> = {};
  for (const m of movs) (byTicker[m.ticker] ??= []).push(m);

  const porTicker: Record<string, number> = {};
  let total = 0;

  for (const [ticker, list] of Object.entries(byTicker)) {
    const ordered = [...list].sort(crono);
    let qty = 0, avg = 0, realized = 0;
    for (const m of ordered) {
      if (m.tipo === 'venta') {
        const q = Math.min(m.cantidad, qty);      // no vender más de lo que hay
        realized += (m.precio - avg) * q;
        qty -= q;
      } else {                                     // compra / ajuste → entra al promedio
        const nueva = qty + m.cantidad;
        avg = nueva > 0 ? (qty * avg + m.cantidad * m.precio) / nueva : avg;
        qty = nueva;
      }
    }
    porTicker[ticker] = +realized.toFixed(2);
    total += realized;
  }
  return { porTicker, total: +total.toFixed(2) };
}
