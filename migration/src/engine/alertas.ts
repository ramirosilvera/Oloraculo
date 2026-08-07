// =============================================================================
// Tipo compartido de alerta — usado por engine/cedears.ts y engine/bonos.ts (y consumido por
// CedearsPage, BonosPage y el resumen del Dashboard) para que las 3 pantallas muestren exactamente
// el mismo criterio de "esto necesita tu atención", nunca uno distinto por pantalla.
// =============================================================================

export type Severidad = 'warn' | 'neg';
export interface Alerta { severidad: Severidad; texto: string }
