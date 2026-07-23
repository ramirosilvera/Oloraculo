// =============================================================================
// Rebalanceo de objetivos y simulación de compra para acercarse a un objetivo. Puro y testeado
// (los NÚMEROS los calcula el código). Todo en la misma moneda (USD) que la valuación.
// =============================================================================

// Monto (USD) a AGREGAR a una posición para que su peso llegue a `objetivo` (0..1), contemplando
// que comprar también agranda el total: resolvemos (vi + x)/(V + x) = t  →  x = (t·V − vi)/(1 − t).
// Negativo = la posición ya está por ENCIMA del objetivo (habría que vender ~|x|).
export function montoParaObjetivo(valorPosicion: number, valorTotal: number, objetivo: number): number {
  const t = Math.max(0, Math.min(0.999999, objetivo)); // t→1 sería infinito; lo acotamos
  return (t * valorTotal - valorPosicion) / (1 - t);
}

// Peso resultante de una posición tras agregarle `monto` comprando (el total crece igual).
export function pesoResultante(valorPosicion: number, valorTotal: number, monto: number): number {
  const V = valorTotal + monto;
  return V > 0 ? (valorPosicion + monto) / V : 0;
}

// Cantidad de unidades para invertir `monto` a `precioUnitario` (USD por unidad valuada).
export function cantidadPorMonto(monto: number, precioUnitario: number): number {
  return precioUnitario > 0 ? monto / precioUnitario : 0;
}

export interface ObjetivoItem { id: string; peso_objetivo: number | null }

// Reajusta los objetivos del "plan" (las posiciones con objetivo asignado) para que sumen 100%
// cuando cambia uno. El resto se escala proporcional a lo que tenía; si ninguno tenía, en partes
// iguales. `nuevo = null` saca la posición del plan y reparte su lugar entre las demás.
export function aplicarObjetivo(
  targeted: ObjetivoItem[], changedId: string, nuevo: number | null,
): { id: string; peso_objetivo: number | null }[] {
  // Con nuevo=null la posición sale del plan (objetivo null) y el resto se renormaliza a 1.
  if (nuevo == null) {
    const otros = targeted.filter(i => i.id !== changedId);
    const sum = otros.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);
    return targeted.map(i => {
      if (i.id === changedId) return { id: i.id, peso_objetivo: null };
      if (otros.length === 0) return { id: i.id, peso_objetivo: null };
      const base = sum > 0 ? (i.peso_objetivo ?? 0) / sum : 1 / otros.length;
      return { id: i.id, peso_objetivo: base };
    });
  }
  const t = Math.max(0, Math.min(1, nuevo));
  const otros = targeted.filter(i => i.id !== changedId);
  const restante = 1 - t;
  const sumOtros = otros.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);
  return targeted.map(i => {
    if (i.id === changedId) return { id: i.id, peso_objetivo: t };
    if (otros.length === 0) return { id: i.id, peso_objetivo: t >= 1 ? 0 : 1 }; // caso borde: 1 solo activo
    const base = sumOtros > 0 ? (i.peso_objetivo ?? 0) / sumOtros : 1 / otros.length;
    return { id: i.id, peso_objetivo: restante * base };
  });
}
