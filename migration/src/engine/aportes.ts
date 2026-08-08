// Resumen de aportes/retiros de capital — puro, testeado. Antes vivía como un reduce inline en
// AportesPage.tsx (aportado/retirado/neto); se extrae acá para que la nueva sección "Aportes" del
// Dashboard personalizable use EXACTAMENTE el mismo cálculo que la página, en vez de reimplementarlo
// (regla de oro #1).
//
// OJO — esto es un cálculo DISTINTO e INDEPENDIENTE de `aportadoNeto` en DashboardPage.tsx (el que
// alimenta la TIR y el registro diario de snapshots). Son matemáticamente equivalentes cuando hay
// aportes cargados (Σ no-retiro − Σ retiro ≡ Σ ±monto), pero `aportadoNeto` tiene un fallback a
// `costo` cuando `aportes.length === 0` que este archivo NO reproduce (acá un portfolio sin aportes
// da `neto: 0`, no el costo de las posiciones) — NUNCA reemplazar `aportadoNeto` por
// `resumenAportes(aportes).neto`, rompería el histórico de rendimiento en un portfolio sin aportes
// cargados. Ver el comentario en DashboardPage.tsx junto a `aportadoNeto`.
import type { Aporte } from '../types/domain';

export interface ResumenAportes {
  aportado: number;
  retirado: number;
  neto: number;
}

export function resumenAportes(aportes: Aporte[]): ResumenAportes {
  const aportado = aportes.filter(a => a.tipo !== 'retiro').reduce((s, a) => s + a.monto, 0);
  const retirado = aportes.filter(a => a.tipo === 'retiro').reduce((s, a) => s + a.monto, 0);
  return { aportado, retirado, neto: aportado - retirado };
}
