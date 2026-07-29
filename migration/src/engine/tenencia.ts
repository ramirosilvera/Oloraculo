// =============================================================================
// Aritmética de tenencia: costo promedio ponderado al comprar y reconstrucción de la posición
// desde su historial de movimientos. Puro y testeable — antes vivía suelta dentro del hook, que
// es justo la lógica que define el COSTO BASE (y con él el P&L de toda la app).
// Convención: la venta descuenta cantidad pero NO cambia el costo promedio.
// =============================================================================

export interface MovimientoLike {
  tipo: 'compra' | 'venta' | 'ajuste';
  cantidad: number;
  precio: number;
  fecha?: string;
}

export interface Tenencia { cantidad: number; costoPromedio: number }

// Consolidación al comprar: costo promedio ponderado entre lo que había y lo que se agrega.
export function consolidarCompra(actual: Tenencia, addQty: number, addPrice: number): Tenencia {
  const q = Number(addQty) || 0, px = Number(addPrice) || 0;
  const oldQty = Number(actual.cantidad) || 0, oldPx = Number(actual.costoPromedio) || 0;
  if (!(q > 0)) return { cantidad: oldQty, costoPromedio: oldPx };  // una compra no puede restar
  const nueva = oldQty + q;
  return { cantidad: nueva, costoPromedio: nueva > 0 ? (oldQty * oldPx + q * px) / nueva : oldPx };
}

// Reconstruye cantidad y costo promedio desde CERO recorriendo los movimientos en orden. Se usa al
// borrar un movimiento mal cargado: la posición se recalcula desde lo que queda.
export function reconstruirTenencia(movs: MovimientoLike[]): Tenencia {
  let t: Tenencia = { cantidad: 0, costoPromedio: 0 };
  for (const m of movs) {
    const q = Number(m.cantidad) || 0, px = Number(m.precio) || 0;
    if (m.tipo === 'venta') { t = { cantidad: Math.max(0, t.cantidad - q), costoPromedio: t.costoPromedio }; continue; }
    // 'ajuste' (split, amortización de capital, corrección): cambia la cantidad SIN tocar el costo
    // promedio — igual criterio que realizedPnl (engine/pnl.ts). Antes caía en la rama de "compra"
    // de acá abajo y el costo promedio se recalculaba mezclado con el precio del ajuste (a veces 0,
    // por ejemplo en una amortización): un movimiento borrado y reconstruido daba OTRO costo base
    // que el que tenía antes de borrarlo.
    if (m.tipo === 'ajuste') { t = { cantidad: Math.max(0, t.cantidad + q), costoPromedio: t.costoPromedio }; continue; }
    t = consolidarCompra(t, q, px);
  }
  return t;
}
