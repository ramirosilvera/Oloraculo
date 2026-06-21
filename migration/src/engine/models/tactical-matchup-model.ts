// =============================================================================
// Oloráculo — L7 Tactical Matchup Model ("Estilo de Juego")
// Reads per-team profiles from tactical-profiles.json.
// Computes matchup advantages from 6 tactical rules and adjusts the
// ensemble outcome probabilities. Priority 7 — highest in the ladder.
// =============================================================================

import type { MatchContext, MatchPrediction, OutcomeProbabilities } from '../../types/domain';
import { normalizeOutcome } from '../probability-helper';

export type BuildupStyle = 'possession' | 'direct' | 'counter' | 'hybrid';

export interface TacticalProfile {
  formation: string;
  pressIntensity: number;
  defensiveLine: number;
  buildupStyle: BuildupStyle;
  setPieceQuality: number;
  tempo: number;
  counterAttackThreat: number;
  aerialStrength: number;
  tacticalFlexibility: number;
  pressResistance: number;    // 0-1, ability to play through opponent pressing
  setPieceDefense: number;    // 0-1, quality of defending set pieces
  description: string;
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function computeMatchup(
  home: TacticalProfile,
  away: TacticalProfile,
  neutral: boolean,
): { homeAdj: number; awayAdj: number; drawAdj: number; notes: string[] } {
  let homeAdj = 0, awayAdj = 0, drawAdj = 0;
  const notes: string[] = [];

  // Rule 1 — Press bypass: direct/counter buildup neutralizes high press
  if (away.buildupStyle === 'direct' || away.buildupStyle === 'counter') {
    if (home.pressIntensity > 0.65) {
      const gain = (home.pressIntensity - 0.65) / 0.35 * 0.05;
      awayAdj += gain;
      notes.push(`Presión alta de ${home.formation} neutralizada por juego directo visitante (+${(gain*100).toFixed(1)}% V)`);
    }
  }
  if (home.buildupStyle === 'direct' || home.buildupStyle === 'counter') {
    if (away.pressIntensity > 0.65) {
      const gain = (away.pressIntensity - 0.65) / 0.35 * 0.04;
      homeAdj += gain;
      notes.push(`Presión alta visitante neutralizada por juego directo local (+${(gain*100).toFixed(1)}% L)`);
    }
  }

  // Rule 2 — High line vs counter-attack vulnerability
  const homeVuln = home.defensiveLine * away.counterAttackThreat;
  if (homeVuln > 0.45) {
    const penalty = (homeVuln - 0.45) / 0.55 * 0.07;
    awayAdj += penalty;
    homeAdj -= penalty * 0.4;
    notes.push(`Línea alta local vs contra visitante: vulnerabilidad ${(homeVuln).toFixed(2)} (+${(penalty*100).toFixed(1)}% V)`);
  }
  const awayVuln = away.defensiveLine * home.counterAttackThreat;
  if (awayVuln > 0.45) {
    const gain = (awayVuln - 0.45) / 0.55 * 0.06;
    homeAdj += gain;
    notes.push(`Línea alta visitante vs contra local: vulnerabilidad ${(awayVuln).toFixed(2)} (+${(gain*100).toFixed(1)}% L)`);
  }

  // Rule 3 — Possession vs low block (draw magnetism)
  if (home.buildupStyle === 'possession' && away.defensiveLine < 0.38) {
    drawAdj += 0.04; homeAdj -= 0.025;
    notes.push('Posesión local vs bloque bajo visitante → empate más probable');
  }
  if (away.buildupStyle === 'possession' && home.defensiveLine < 0.38) {
    drawAdj += 0.04; awayAdj -= 0.025;
    notes.push('Posesión visitante vs bloque bajo local → empate más probable');
  }

  // Rule 4 — Set piece quality differential
  const spqDelta = home.setPieceQuality - away.setPieceQuality;
  if (spqDelta >= 0.25) {
    const gain = 0.015 + (spqDelta - 0.25) / 0.75 * 0.03;
    homeAdj += gain;
    notes.push(`Ventaja de pelota parada local (+${(gain*100).toFixed(1)}% L)`);
  } else if (spqDelta <= -0.25) {
    const gain = 0.015 + (-spqDelta - 0.25) / 0.75 * 0.03;
    awayAdj += gain;
    notes.push(`Ventaja de pelota parada visitante (+${(gain*100).toFixed(1)}% V)`);
  }

  // Rule 5 — Tempo mismatch (amplified at home)
  const tempoDelta = home.tempo - away.tempo;
  if (tempoDelta > 0.28 && !neutral) {
    const gain = (tempoDelta - 0.28) / 0.72 * 0.035;
    homeAdj += gain;
    notes.push(`Tempo alto local impone ritmo (+${(gain*100).toFixed(1)}% L)`);
  } else if (tempoDelta < -0.28) {
    const gain = (-tempoDelta - 0.28) / 0.72 * 0.025;
    awayAdj += gain;
    notes.push(`Tempo visitante neutraliza ventaja local (+${(gain*100).toFixed(1)}% V)`);
  }

  // Rule 6 — Aerial mismatch in set-piece contexts
  const aerialDelta = home.aerialStrength - away.aerialStrength;
  if (Math.abs(aerialDelta) > 0.25 && (home.setPieceQuality > 0.60 || away.setPieceQuality > 0.60)) {
    if (aerialDelta > 0.25) {
      const gain = (aerialDelta - 0.25) / 0.75 * 0.025;
      homeAdj += gain;
      notes.push(`Superioridad aérea local + pelota parada (+${(gain*100).toFixed(1)}% L)`);
    } else {
      const gain = (-aerialDelta - 0.25) / 0.75 * 0.025;
      awayAdj += gain;
      notes.push(`Superioridad aérea visitante + pelota parada (+${(gain*100).toFixed(1)}% V)`);
    }
  }

  // Rule 7 — Press dominance vs resistance
  const homePressDom = home.pressIntensity * (1 - away.pressResistance);
  if (homePressDom > 0.40) {
    const gain = (homePressDom - 0.40) / 0.60 * 0.06;
    homeAdj += gain;
    notes.push(`Presión del local domina resistencia visitante (índice ${homePressDom.toFixed(2)}) +${(gain * 100).toFixed(1)}% L`);
  }
  const awayPressDom = away.pressIntensity * (1 - home.pressResistance);
  if (awayPressDom > 0.40) {
    const gain = (awayPressDom - 0.40) / 0.60 * 0.05;
    awayAdj += gain;
    notes.push(`Presión visitante supera resistencia local (índice ${awayPressDom.toFixed(2)}) +${(gain * 100).toFixed(1)}% V`);
  }

  // Rule 8 — Set piece attack vs specific defense quality
  const homeSPA = home.setPieceQuality - away.setPieceDefense;
  if (homeSPA >= 0.18) {
    const gain = 0.012 + (homeSPA - 0.18) / 0.82 * 0.025;
    homeAdj += gain;
    notes.push(`Pelota parada ofensiva local supera defensa estática visitante (+${(gain * 100).toFixed(1)}% L)`);
  }
  const awaySPA = away.setPieceQuality - home.setPieceDefense;
  if (awaySPA >= 0.18) {
    const gain = 0.012 + (awaySPA - 0.18) / 0.82 * 0.025;
    awayAdj += gain;
    notes.push(`Pelota parada ofensiva visitante supera defensa estática local (+${(gain * 100).toFixed(1)}% V)`);
  }

  // Clamp totals
  homeAdj = clamp(homeAdj, -0.12, 0.14);
  awayAdj = clamp(awayAdj, -0.12, 0.14);
  drawAdj = clamp(drawAdj, -0.08, 0.10);

  return { homeAdj, awayAdj, drawAdj, notes };
}

export function buildTacticalMap(raw: Record<string, TacticalProfile>): Map<string, TacticalProfile> {
  return new Map(Object.entries(raw));
}

export function tacticalMatchupPredict(
  ctx: MatchContext,
  basePrediction: MatchPrediction,
  profiles: Map<string, TacticalProfile>,
): MatchPrediction {
  const homeProfile = profiles.get(ctx.homeTeam.id);
  const awayProfile = profiles.get(ctx.awayTeam.id);
  const missingFeatures: string[] = [];
  if (!homeProfile) missingFeatures.push(`perfil táctico de ${ctx.homeTeam.name}`);
  if (!awayProfile) missingFeatures.push(`perfil táctico de ${ctx.awayTeam.name}`);
  const degraded = missingFeatures.length > 0;

  if (degraded) {
    return {
      ...basePrediction,
      predictorName: 'Estilo de Juego',
      predictorPriority: 7,
      degraded: true,
      featuresMissing: missingFeatures,
    };
  }

  const { homeAdj, awayAdj, drawAdj, notes } = computeMatchup(
    homeProfile!, awayProfile!, ctx.fixture.neutral_venue ?? false,
  );

  const raw: OutcomeProbabilities = {
    homeWin: clamp(basePrediction.outcome.homeWin + homeAdj, 0.02, 0.97),
    draw:    clamp(basePrediction.outcome.draw    + drawAdj,  0.02, 0.97),
    awayWin: clamp(basePrediction.outcome.awayWin + awayAdj, 0.02, 0.97),
  };
  const outcome = normalizeOutcome(raw);

  const adjSummary = [
    homeAdj !== 0 ? `L ${homeAdj > 0 ? '+' : ''}${(homeAdj * 100).toFixed(1)}%` : '',
    drawAdj !== 0 ? `E ${drawAdj > 0 ? '+' : ''}${(drawAdj * 100).toFixed(1)}%` : '',
    awayAdj !== 0 ? `V ${awayAdj > 0 ? '+' : ''}${(awayAdj * 100).toFixed(1)}%` : '',
  ].filter(Boolean).join(' · ');

  return {
    ...basePrediction,
    predictorName: 'Estilo de Juego',
    predictorPriority: 7,
    outcome,
    explanation: `${homeProfile!.description.split('.')[0]}. ${awayProfile!.description.split('.')[0]}. Ajuste táctico: ${adjSummary || 'sin sesgo'}.`,
    drivers: [
      `${ctx.homeTeam.name}: ${homeProfile!.formation} · ${homeProfile!.buildupStyle}`,
      `${ctx.awayTeam.name}: ${awayProfile!.formation} · ${awayProfile!.buildupStyle}`,
      ...notes,
    ],
    featuresUsed: ['perfil táctico local', 'perfil táctico visitante', 'reglas de matchup'],
    featuresMissing: [],
    sources: [...(basePrediction.sources ?? []), { name: 'tactical-profiles.json', kind: 'json' }],
    degraded: false,
  };
}
