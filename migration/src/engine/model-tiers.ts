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
    color: 'text-blue-500',
    desc: 'Puntos FIFA como proxy de calidad',
    how: 'Aplica la fórmula Elo a los puntos FIFA de ambos equipos. La diferencia de puntos determina la probabilidad de victoria.',
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
    desc: 'L4 × valor de mercado, top-5, UCL',
    how: 'Calcula un score de fortaleza por equipo: 50% valor de mercado + 35% jugadores en top-5 ligas + 15% jugadores con UCL. Ajusta los goles esperados de L4 hasta ±10% según la diferencia de scores.',
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
    desc: 'L4 + inflación WC + momentum en torneo + racha diaria',
    how: 'Fase 1: escala goles según el ritmo goleador del Mundial actual vs histórico. Fase 2: agrega push de momentum basado en forma dentro del torneo (con bonus por victorias sorpresa). Fase 3: aplica modificador si hay racha de 3+ días con el mismo patrón (muchas goleadas, muchos empates, etc.).',
  },
};
