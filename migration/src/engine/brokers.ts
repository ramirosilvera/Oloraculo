// =============================================================================
// Desglose de patrimonio por broker — puro y testeado. El componente NO calcula nada: le pasa
// filas ya valuadas (mismo unitValueUSD que usa Posiciones) y la lista de brokers del usuario.
// =============================================================================

export interface BrokerResumenItem {
  brokerId: string | null;   // null = "Sin asignar"
  nombre: string;
  valorUsd: number;
  cantidadPosiciones: number;
  pct: number;                // 0..1 del total del portfolio
}

export function resumenPorBroker(
  rows: { brokerId: string | null; valorUsd: number }[],
  brokers: { id: string; nombre: string }[],
): BrokerResumenItem[] {
  const total = rows.reduce((s, r) => s + r.valorUsd, 0);
  const porBroker = new Map<string | null, { valorUsd: number; cantidadPosiciones: number }>();
  for (const r of rows) {
    const cur = porBroker.get(r.brokerId) ?? { valorUsd: 0, cantidadPosiciones: 0 };
    cur.valorUsd += r.valorUsd;
    cur.cantidadPosiciones += 1;
    porBroker.set(r.brokerId, cur);
  }
  const nombreOf = new Map(brokers.map(b => [b.id, b.nombre]));
  const out: BrokerResumenItem[] = [];
  for (const [brokerId, agg] of porBroker) {
    out.push({
      brokerId,
      nombre: brokerId == null ? 'Sin asignar' : (nombreOf.get(brokerId) ?? 'Broker eliminado'),
      valorUsd: +agg.valorUsd.toFixed(2),
      cantidadPosiciones: agg.cantidadPosiciones,
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
