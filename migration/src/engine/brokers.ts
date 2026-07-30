// =============================================================================
// Desglose de patrimonio por broker y detalle de posiciones repartidas entre varios brokers —
// puro y testeado. El componente NO calcula nada: le pasa posiciones ya valuadas (mismo
// unitValueUSD que usa Posiciones) y las asignaciones posición↔broker↔cantidad (posicion_brokers).
// =============================================================================

export interface PosicionValuada { id: string; cantidad: number; valorUsd: number; }
export interface Asignacion { posicionId: string; brokerId: string; cantidad: number; }

export interface BrokerResumenItem {
  brokerId: string | null;   // null = "Sin asignar"
  nombre: string;
  valorUsd: number;
  cantidadPosiciones: number;
  pct: number;                // 0..1 del total del portfolio
}

export function resumenPorBroker(
  posiciones: PosicionValuada[],
  asignaciones: Asignacion[],
  brokers: { id: string; nombre: string }[],
): BrokerResumenItem[] {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const porBroker = new Map<string | null, { valorUsd: number; posicionIds: Set<string> }>();
  const bump = (brokerId: string | null, valorUsd: number, posicionId: string) => {
    const cur = porBroker.get(brokerId) ?? { valorUsd: 0, posicionIds: new Set<string>() };
    cur.valorUsd += valorUsd;
    cur.posicionIds.add(posicionId);
    porBroker.set(brokerId, cur);
  };
  const porPosicion = new Map<string, Asignacion[]>();
  for (const a of asignaciones) {
    if (a.cantidad <= 0) continue;
    const arr = porPosicion.get(a.posicionId) ?? [];
    arr.push(a);
    porPosicion.set(a.posicionId, arr);
  }
  for (const p of posiciones) {
    if (p.cantidad <= 0) continue;
    const unitValor = p.valorUsd / p.cantidad;
    const asigns = porPosicion.get(p.id) ?? [];
    let asignado = 0;
    for (const a of asigns) {
      // Clamp defensivo: si la suma de asignaciones superara la cantidad real de la posición (dato
      // desactualizado), no se reparte más valor del que la posición efectivamente tiene.
      const cant = Math.min(a.cantidad, Math.max(0, p.cantidad - asignado));
      if (cant <= 0) continue;
      asignado += cant;
      bump(a.brokerId, unitValor * cant, p.id);
    }
    // Lo no asignado (total o parcial) cae en "Sin asignar" — recordatorio de pendiente, no un error.
    const restante = p.cantidad - asignado;
    if (restante > 1e-9) bump(null, unitValor * restante, p.id);
  }
  const nombreOf = new Map(brokers.map(b => [b.id, b.nombre]));
  const out: BrokerResumenItem[] = [];
  for (const [brokerId, agg] of porBroker) {
    out.push({
      brokerId,
      nombre: brokerId == null ? 'Sin asignar' : (nombreOf.get(brokerId) ?? 'Broker eliminado'),
      valorUsd: +agg.valorUsd.toFixed(2),
      cantidadPosiciones: agg.posicionIds.size,
      pct: total > 0 ? agg.valorUsd / total : 0,
    });
  }
  // Mayor valor primero; "Sin asignar" siempre al final (aunque tenga plata), para que no compita
  // visualmente con los brokers reales — es un recordatorio de pendiente, no un ranking.
  out.sort((a, b) => {
    if (a.brokerId == null) return 1;
    if (b.brokerId == null) return -1;
    return b.valorUsd - a.valorUsd;
  });
  return out;
}

// Filas "ticker, cantidad, broker" — SOLO para posiciones repartidas entre MÁS DE UN broker (una
// posición entera en un solo broker no aporta nada nuevo sobre "Patrimonio por broker").
export interface DetalleMultiBrokerRow {
  ticker: string;
  cantidad: number;
  broker: string;
}

export function detalleMultiBroker(
  posiciones: { id: string; ticker: string }[],
  asignaciones: Asignacion[],
  brokers: { id: string; nombre: string }[],
): DetalleMultiBrokerRow[] {
  const nombreOf = new Map(brokers.map(b => [b.id, b.nombre]));
  const tickerOf = new Map(posiciones.map(p => [p.id, p.ticker]));
  const porPosicion = new Map<string, Asignacion[]>();
  for (const a of asignaciones) {
    if (a.cantidad <= 0) continue;
    const arr = porPosicion.get(a.posicionId) ?? [];
    arr.push(a);
    porPosicion.set(a.posicionId, arr);
  }
  const out: DetalleMultiBrokerRow[] = [];
  for (const [posicionId, asigns] of porPosicion) {
    if (asigns.length < 2) continue;
    const ticker = tickerOf.get(posicionId) ?? '?';
    for (const a of asigns) out.push({ ticker, cantidad: a.cantidad, broker: nombreOf.get(a.brokerId) ?? 'Broker eliminado' });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.broker.localeCompare(b.broker));
}
