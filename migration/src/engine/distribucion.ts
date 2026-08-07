// =============================================================================
// Distribución del patrimonio total entre renta fija y renta variable, y alerta cuando el % en
// renta fija se aleja del objetivo personal del usuario. Puro y testeado — mismo criterio de
// tolerancia (± puntos porcentuales) que TOLERANCIA_OBJETIVO en engine/rebalance.ts, pero acá a
// nivel de categoría de activo (fija/variable/liquidez), no de posición individual.
// =============================================================================

import type { Alerta } from './alertas';
import type { AssetType } from '../types/domain';

export type CategoriaPatrimonio = 'variable' | 'fija' | 'liquidez';

// Renta fija = bono (coherente con la sección /bonos). Liquidez = cash (no es una posición
// "variable" en el sentido de riesgo de mercado, se cuenta aparte). Todo lo demás (cedear, acción
// US/AR, ETF) es renta variable.
export function categoriaDe(tipo: AssetType): CategoriaPatrimonio {
  return tipo === 'bono' ? 'fija' : tipo === 'cash' ? 'liquidez' : 'variable';
}

// % del patrimonio TOTAL (incluye liquidez en el denominador, no solo fija+variable) en renta
// fija — mismo criterio que el donut de Distribución del Dashboard. `null` si no hay patrimonio
// (portfolio vacío o sin valuar todavía) — a propósito NO se devuelve 0, porque 0% de un
// patrimonio real es un dato válido (cartera 100% variable) y no debe confundirse con "no hay
// datos" (ver alertasDistribucion, que usa este null para no alertar en falso en un portfolio vacío).
export function pctRentaFija(alloc: { mkt: number; tipo: AssetType }[], total: number): number | null {
  if (total <= 0) return null;
  const fija = alloc.filter(a => categoriaDe(a.tipo) === 'fija').reduce((s, a) => s + a.mkt, 0);
  return (fija / total) * 100;
}

// Alerta cuando el % de renta fija se aleja (para cualquier lado) del objetivo personal en más de
// `toleranciaPct` puntos porcentuales. `objetivoFijaPct`/`toleranciaPct` son umbrales PERSONALES
// del usuario (0..100), no una constante fija del motor — obligatorios como parámetro, igual que
// los umbrales de alertasBonos/alertasCedears. `fijaPct = null` (sin patrimonio) nunca alerta —
// mismo criterio que el resto del motor (ver ej. `r.totalMkt > 0 &&` en alertasBonos).
export function alertasDistribucion(fijaPct: number | null, objetivoFijaPct: number, toleranciaPct: number): Alerta[] {
  if (fijaPct == null) return [];
  const diff = fijaPct - objetivoFijaPct;
  if (Math.abs(diff) < toleranciaPct) return [];
  const texto = diff < 0
    ? `Renta fija en ${Math.round(fijaPct)}% del patrimonio — por debajo de tu objetivo de ${objetivoFijaPct}% (tolerancia ±${toleranciaPct}pp).`
    : `Renta fija en ${Math.round(fijaPct)}% del patrimonio — por encima de tu objetivo de ${objetivoFijaPct}% (tolerancia ±${toleranciaPct}pp), quizás sea momento de rotar hacia renta variable.`;
  return [{ severidad: 'warn', texto }];
}
