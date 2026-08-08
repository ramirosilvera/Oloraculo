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

// Etiqueta/color de cada AssetType — tipados como Record<AssetType, ...> a propósito: agregar un
// AssetType nuevo sin sumarlo acá es un error de compilación, no una porción de donut sin color/label.
const TIPO_LABEL: Record<AssetType, string> = {
  cedear: 'CEDEARs', accion: 'Acciones (US)', accion_ar: 'Acciones (AR)', etf: 'ETFs', bono: 'Bonos/ONs', cash: 'Cash',
};
const TIPO_COLOR: Record<AssetType, string> = {
  cedear: '#5FB49C', accion: '#7FA7D9', accion_ar: '#C98BD9', etf: '#E3B341', bono: '#4F97D4', cash: '#8B96A5',
};
const TODOS_LOS_TIPOS: AssetType[] = ['cedear', 'accion', 'accion_ar', 'etf', 'bono', 'cash'];

// Etiqueta/color de cada categoría — única fuente (antes duplicada como constante local en
// DashboardPage.tsx); tanto el donut de Distribución como el widget atómico "Distribución por
// categoría" del Dashboard personalizable importan estas mismas dos constantes.
export const CATEGORIA_LABEL: Record<CategoriaPatrimonio, string> = { variable: 'Renta variable', fija: 'Renta fija', liquidez: 'Liquidez' };
export const CATEGORIA_COLOR: Record<CategoriaPatrimonio, string> = { variable: '#5FB49C', fija: '#4F97D4', liquidez: '#8B96A5' };
const TODAS_LAS_CATEGORIAS: CategoriaPatrimonio[] = ['variable', 'fija', 'liquidez'];

export interface GrupoCategoria { categoria: CategoriaPatrimonio; label: string; color: string; value: number }

// Agrupa `alloc` por categoría (fija/variable/liquidez vía categoriaDe()) — mismo criterio de
// orden/filtro que agruparPorTipo (desc, solo con capital > 0).
export function agruparPorCategoria(alloc: { mkt: number; tipo: AssetType }[]): GrupoCategoria[] {
  return TODAS_LAS_CATEGORIAS
    .map(categoria => ({ categoria, label: CATEGORIA_LABEL[categoria], color: CATEGORIA_COLOR[categoria], value: alloc.filter(a => categoriaDe(a.tipo) === categoria).reduce((s, a) => s + a.mkt, 0) }))
    .filter(g => g.value > 0)
    .sort((a, b) => b.value - a.value);
}

export interface GrupoTipo { tipo: AssetType; label: string; color: string; value: number }

// Agrupa `alloc` por tipo de activo (cedear/bono/etf/acción/acción AR/cash) — vista más granular que
// categoriaDe() (que solo distingue fija/variable/liquidez), para el widget "Distribución por tipo de
// activo" del Dashboard personalizable. Mismos datos de `alloc`, mismo criterio de orden/filtro
// (desc, solo tipos con capital > 0) que el donut de categoría ya existente — ver el test que verifica
// que ambas agrupaciones suman lo mismo.
export function agruparPorTipo(alloc: { mkt: number; tipo: AssetType }[]): GrupoTipo[] {
  return TODOS_LOS_TIPOS
    .map(tipo => ({ tipo, label: TIPO_LABEL[tipo], color: TIPO_COLOR[tipo], value: alloc.filter(a => a.tipo === tipo).reduce((s, a) => s + a.mkt, 0) }))
    .filter(g => g.value > 0)
    .sort((a, b) => b.value - a.value);
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
