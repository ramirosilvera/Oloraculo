// =============================================================================
// Oloráculo — Model tier metadata
// Shared by ModelDetailPanel and PerformancePage
// =============================================================================

export interface ModelTierInfo {
  /** Tier identifier: "L0", "L1", ... "L4.5", "L6" */
  tier: string;
  /** Short name for mobile display */
  shortName: string;
  /** Tailwind class for the tier badge color */
  color: string;
  /** 1-line description of what the model does */
  desc: string;
  /** 2-3 sentence description of how it calculates */
  how: string;
}

export const MODEL_TIERS: Record<string, ModelTierInfo> = {
  'Base': {
    tier: 'L0',
    shortName: 'Base',
    color: 'text-gray-400',
    desc: 'Probabilidad uniforme — sin datos',
    how: 'Devuelve 33.3% para cada resultado. Es el piso del sistema cuando no hay ningún dato disponible.',
  },
  'Ranking FIFA': {
    tier: 'L1',
    shortName: 'FIFA',
    color: 'text-gray-400',
    desc: '[Archivado] Puntos FIFA como proxy de calidad',
    how: 'Removido del ensemble activo (correlación 0.82 con Elo — señal redundante). Los datos históricos se conservan para referencia.',
  },
  'Elo': {
    tier: 'L2',
    shortName: 'Elo',
    color: 'text-blue-600',
    desc: 'Rating Elo histórico internacional',
    how: 'Usa ratings Elo calculados sobre todos los resultados internacionales. Más sensible que FIFA: ganarle a un rival fuerte sube más que ganarle a uno débil.',
  },
  'Forma reciente': {
    tier: 'L3',
    shortName: 'Forma',
    color: 'text-indigo-600',
    desc: 'Elo + rendimiento de los últimos 8 partidos',
    how: 'Ajusta el Elo base con un delta por los últimos 8 partidos. Cada partido más antiguo pesa 20% menos. Los partidos de Mundial/eliminatoria valen más que amistosos.',
  },
  'Modelo de goles (Poisson)': {
    tier: 'L4',
    shortName: 'Poisson',
    color: 'text-violet-600',
    desc: 'Dixon-Coles Poisson, historial 8 años',
    how: 'Itera 8 veces para estimar fuerza de ataque y vulnerabilidad defensiva de cada equipo. Construye una grilla 9×9 de probabilidades de marcador. Pondera más los partidos recientes y los de alta competencia.',
  },
  'Potencial del plantel': {
    tier: 'L4.5',
    shortName: 'Plantel',
    color: 'text-purple-600',
    desc: 'L4 × valor de mercado + top-5 ligas',
    how: 'Calcula un score de fortaleza por equipo: 60% valor de mercado de transfermarkt + 40% jugadores en top-5 ligas europeas. Ajusta los goles esperados de L4 en escala logarítmica. Diferencias extremas (p.ej. England vs Haiti) saturan al máximo boost.',
  },
  'Goles + contexto reciente': {
    tier: 'L5',
    shortName: 'Contexto',
    color: 'text-orange-500',
    desc: 'L4 + disponibilidad de jugadores',
    how: 'Toma los goles esperados de L4 y aplica descuentos por bajas: si hay impacto por rol (delantero estrella fuera = -20% goles), lo aplica directamente. Si no hay datos de roles, aplica -2% por baja genérica.',
  },
  'Momentum del Mundial': {
    tier: 'L6',
    shortName: 'Momentum',
    color: 'text-wc-gold',
    desc: 'L4 + inflación WC + momentum en torneo',
    how: 'Fase 1: escala goles según el ritmo goleador del Mundial actual vs histórico. Fase 2: agrega push de momentum basado en forma dentro del torneo (victorias, goles, bonus por sorpresas). La racha diaria fue desactivada — con la cantidad de partidos por día en grupos, el umbral de 3 días consecutivos raramente confirma.',
  },
  'Elo del Torneo': {
    tier: 'L2.5',
    shortName: 'EloWC',
    color: 'text-blue-500',
    desc: 'Elo actualizado partido a partido dentro del torneo',
    how: 'Toma el Elo pre-torneo de cada equipo y lo ajusta con K=32 tras cada partido del Mundial jugado. Converge en ~4-5 partidos: un equipo que ganó dos partidos importante sube ~60 puntos sobre su rating base.',
  },
  'Patrón de Grupo': {
    tier: 'L6.5',
    shortName: 'Grupo',
    color: 'text-emerald-600',
    desc: 'L4 + inflación WC + contexto de fase de grupos',
    how: 'Detecta el día de partido (MD1/2/3) y la posición del equipo en el grupo. Si ambos clasifican con empate (MD3), comprime las lambdas hacia el promedio. Si un equipo necesita ganar, aumenta 14% su ataque. En partidos sin consecuencias, reduce la intensidad global. Degradado en knockout.',
  },
  'Estilo de Juego': {
    tier: 'L7',
    shortName: 'Táctico',
    color: 'text-gray-400',
    desc: '[Archivado] Ajuste por perfil táctico y matchup de estilos',
    how: 'Removido del ensemble activo: perfiles estáticos sin validación empírica. Los deltas tácticos fijos no mejoraron la calibración en datos históricos de Copa del Mundo.',
  },
};
