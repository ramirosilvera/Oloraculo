// =============================================================================
// Score compuesto del Radar/Watchlist (0-100). Puro y determinista.
// Combina 4 dimensiones con pesos; si falta una, se renormaliza sobre las disponibles
// (no se inventa: si no hay NADA, el score es null). Los números vienen del motor
// (ratios + DCF), nunca de la IA.
// =============================================================================

export interface ScoreInputs {
  marginOfSafety: number | null;  // de computeDcf (1 − precio/valor)
  roic: number | null;
  wacc: number | null;
  operatingMargin: number | null;
  debtToEquity: number | null;
  eg5y: number | null;            // CAGR real de EPS 5a
}

export type Rating = 'A' | 'B' | 'C' | 'D';

export interface ScoreResult {
  score: number | null;           // 0-100
  rating: Rating | null;
  partes: { valuacion: number | null; calidad: number | null; crecimiento: number | null; solidez: number | null };
}

const clamp = (v: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, v));
// Mapea x∈[min,max] a 0..100 lineal.
const lin = (x: number, min: number, max: number): number => clamp(((x - min) / (max - min)) * 100);

const PESOS = { valuacion: 0.35, calidad: 0.30, crecimiento: 0.20, solidez: 0.15 };

export function computeScore(inp: ScoreInputs): ScoreResult {
  // Valuación: MoS de −0.5 (muy caro) a +0.5 (muy barato) → 0..100.
  const valuacion = inp.marginOfSafety != null ? lin(inp.marginOfSafety, -0.5, 0.5) : null;

  // Calidad: spread ROIC−WACC (−5% a +15% → 0..100) mezclado 70/30 con margen operativo (0 a 35%).
  let calidad: number | null = null;
  const spread = inp.roic != null && inp.wacc != null ? lin(inp.roic - inp.wacc, -0.05, 0.15) : null;
  const margen = inp.operatingMargin != null ? lin(inp.operatingMargin, 0, 0.35) : null;
  if (spread != null && margen != null) calidad = spread * 0.7 + margen * 0.3;
  else calidad = spread ?? margen;

  // Crecimiento: EG5Y de 0% (o menos) a +20% → 0..100.
  const crecimiento = inp.eg5y != null ? lin(inp.eg5y, 0, 0.20) : null;

  // Solidez: Deuda/Equity de 2.0 (débil) a 0 (fuerte) → 0..100 (invertido).
  const solidez = inp.debtToEquity != null ? clamp(100 - lin(inp.debtToEquity, 0, 2)) : null;

  const partes = { valuacion, calidad, crecimiento, solidez };

  // Composición con renormalización sobre las dimensiones disponibles.
  let num = 0, den = 0;
  (Object.keys(PESOS) as (keyof typeof PESOS)[]).forEach(k => {
    const v = partes[k];
    if (v != null) { num += v * PESOS[k]; den += PESOS[k]; }
  });
  const score = den > 0 ? Math.round(num / den) : null;
  let rating: Rating | null =
    score == null ? null : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
  // Sin señal de valuación (DCF SIN_DATOS → MoS null) el score se renormaliza sobre calidad/
  // crecimiento/solidez y podría dar A/B sin saber si está cara. Capeamos el rating en C.
  if (valuacion == null && rating != null && (rating === 'A' || rating === 'B')) rating = 'C';

  return { score, rating, partes };
}
