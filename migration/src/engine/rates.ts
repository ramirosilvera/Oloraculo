// =============================================================================
// Escalera de tasas EEUU (bond ladder por duración) + lectura de la curva.
// Puro y determinista. Los ETFs representan tramos de la curva de Treasuries:
//   SHV = 0-1 año · IEF = 7-10 años · TLT = 20+ años.
// La sugerencia sale de la FORMA de la curva (spread 10a − 3m), no de opinión.
// =============================================================================

export type Luz = 'verde' | 'amarillo' | 'rojo';

export interface LadderRung {
  key: string;
  label: string;
  etf: string;        // ETF que sigue el tramo
  tramo: string;
  durYears: number;   // duración aproximada (años) → sensibilidad a la tasa
}

export const LADDER: LadderRung[] = [
  { key: 'corto', label: 'Corto', etf: 'SHV', tramo: 'T-Bills 0-1a', durYears: 0.4 },
  { key: 'medio', label: 'Medio', etf: 'IEF', tramo: 'Notes 7-10a', durYears: 7.5 },
  { key: 'largo', label: 'Largo', etf: 'TLT', tramo: 'Bonds 20a+', durYears: 17 },
];

export interface CurveRead {
  dgs3mo: number | null;
  dgs10: number | null;
  spread: number | null;                              // 10a − 3m, en puntos %
  forma: 'invertida' | 'plana' | 'normal' | null;
  luz: Luz | null;
  sugerencia: string;
}

// Lee la curva a partir de las tasas de FRED (ya en %). Invertida = señal clásica de recesión.
export function readCurve(dgs3mo: number | null, dgs10: number | null): CurveRead {
  if (dgs3mo == null || dgs10 == null) {
    return { dgs3mo, dgs10, spread: null, forma: null, luz: null, sugerencia: 'Sin datos de tasas (FRED). Se completan con el refresco.' };
  }
  const spread = +(dgs10 - dgs3mo).toFixed(2);
  const forma = spread < -0.1 ? 'invertida' : spread < 0.5 ? 'plana' : 'normal';
  const luz: Luz = forma === 'invertida' ? 'rojo' : forma === 'plana' ? 'amarillo' : 'verde';
  const sugerencia =
    forma === 'invertida'
      ? 'Curva invertida: el tramo corto (SHV) rinde más y sin riesgo de duración. Alargar a TLT solo si apostás a que la Fed baja tasas (el largo sube de precio cuando bajan).'
      : forma === 'plana'
        ? 'Curva plana: poco premio por alargar duración. Preferir corto/medio (SHV/IEF) hasta que se empine.'
        : 'Curva normal (empinada): el tramo largo (TLT) paga premio por duración. Sirve para fijar tasa si esperás que bajen.';
  return { dgs3mo, dgs10, spread, forma, luz, sugerencia };
}

// Nivel absoluto de la tasa larga: alta = oportunidad de fijar; baja = poco premio.
export function nivelTasaLarga(dgs10: number | null): { luz: Luz | null; texto: string } {
  if (dgs10 == null) return { luz: null, texto: '—' };
  if (dgs10 >= 4.5) return { luz: 'verde', texto: 'Tasa larga alta: buena oportunidad para fijar rendimiento a largo plazo.' };
  if (dgs10 >= 3.5) return { luz: 'amarillo', texto: 'Tasa larga media: fijar largo es razonable pero sin urgencia.' };
  return { luz: 'rojo', texto: 'Tasa larga baja: poco premio por asumir duración; preferir tramo corto.' };
}

// % de variación de precio de un tramo ante un cambio de tasa (regla de duración):
// ΔPrecio ≈ −Duración × ΔTasa. Útil para dimensionar el riesgo de cada peldaño.
export function impactoPorTasa(durYears: number, deltaTasaPct: number): number {
  return -durYears * (deltaTasaPct / 100);
}
