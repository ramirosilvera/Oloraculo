// =============================================================================
// Oloráculo — L6 Tournament Momentum Model ("Momentum del Mundial")
// Uses in-tournament form (WC actual results) to adjust goal expectations.
//
// Goal formula (v3):
//   tournamentBase = base * inflation                (doubles goals when WC is high-scoring)
//   momentumPush   = netDiff * inflation * BOOST     (additive push in actual goal units)
//   homeGoals      = tournamentBase + momentumPush
//   awayGoals      = tournamentBase - momentumPush
//
// The additive push crosses Poisson integer boundaries directly, so the
// displayed "most likely score" changes: 1-1 → 2-2 (inflation) → 3-2 (momentum).
// A multiplicative % adjustment cannot do this reliably (floor(2.53)=floor(2.88)=2).
// =============================================================================

import type { MatchContext, MatchPrediction } from '../../types/domain';
import {
  poissonScoreline,
  scorelineToOutcome,
  mostLikelyScore as getMostLikely,
} from '../probability-helper';
import type { GoalModel } from './goal-model';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// BASE_BOOST: goal push per unit of netDiff × inflation at inflation=1.0.
// Calibrated daily by scripts/calibrate.mjs against actual WC2026 results.
// dynamicBoost = clamp(BASE_BOOST × √inflation, BASE_BOOST, 0.88)
//   → never goes below BASE_BOOST (floor scales with calibrated value)
//   → grows with tournament pace via √inflation
const BASE_BOOST = 0.22;

export function tournamentMomentumPredict(
  ctx: MatchContext,
  goalModel: GoalModel,
): MatchPrediction {
  const { home: baseHome, away: baseAway, degraded: goalDegraded } = goalModel.expectedGoals(ctx);

  const homeTF = ctx.homeTournamentForm;
  const awayTF = ctx.awayTournamentForm;

  const bothNull = homeTF === null && awayTF === null;
  const hasInflation = ctx.tournamentGoalInflation !== null;
  // L6 is usable whenever the goal model is ok and there is any tournament signal
  // (either team form OR a computed inflation factor from WC actual results)
  const degraded = goalDegraded || (bothNull && !hasInflation);

  // upsetBonus accumulates eloDiff/1000 for each upset win in the tournament.
  // Scale by 0.5 so a single major upset (+0.4 bonus) adds ~0.2 to effective momentum.
  // Capped at 0.35 to prevent multiple upsets from dominating the signal.
  const homeBonus = clamp((homeTF?.upsetBonus ?? 0) * 0.5, 0, 0.35);
  const awayBonus = clamp((awayTF?.upsetBonus ?? 0) * 0.5, 0, 0.35);
  const homeTMS = clamp((homeTF?.momentumScore ?? 0) + homeBonus, -1, 1);
  const awayTMS = clamp((awayTF?.momentumScore ?? 0) + awayBonus, -1, 1);
  const netDiff = clamp(homeTMS - awayTMS, -1, 1);
  const inflation = clamp(ctx.tournamentGoalInflation ?? 1.0, 0.5, 3.0);

  // Phase 1: apply tournament inflation to the base goal model
  // Cap inflation × goalMod compounding at 1.7× to avoid unrealistic λ
  const tournamentHome = baseHome * inflation;
  const tournamentAway = baseAway * inflation;

  // Phase 2: additive momentum push in actual goal units.
  // Blend form-based netDiff (50%) with in-tournament goals-per-game ratio (50%).
  // The goals blend anchors the push to observed scoring pace — a team averaging
  // 4 goals/game pushes significantly more than one averaging 1 goal/game, even
  // if both won their matches.
  const homeAvgGoals = homeTF && homeTF.played > 0 ? homeTF.goalsFor / homeTF.played : baseHome;
  const awayAvgGoals = awayTF && awayTF.played > 0 ? awayTF.goalsFor / awayTF.played : baseAway;
  const goalRatioPush = clamp((homeAvgGoals - awayAvgGoals) / 2.5, -1, 1);
  const blendedDiff = clamp(netDiff * 0.5 + goalRatioPush * 0.5, -1, 1);

  const dynamicBoost = clamp(BASE_BOOST * Math.sqrt(inflation), BASE_BOOST, 0.88);
  const momentumPush = blendedDiff * inflation * dynamicBoost;

  // Phase 3 (pre-player): apply confirmed daily scoring streak modifiers.
  // goalModifier scales overall goal volume; pushModifier amplifies directional spread.
  const ps = ctx.dailyPatternSignal;
  const rawGoalMod = ps?.isConfirmed ? ps.goalModifier : 1.0;
  const pushMod = ps?.isConfirmed ? ps.pushModifier : 1.0;
  // Cap the daily-streak amplification so inflation × goalMod stays ≤ 1.7×,
  // but never let goalMod drop below 1.0 — the streak only amplifies; it must
  // not silently shrink the legitimate tournament inflation factor.
  const goalMod = Math.min(rawGoalMod, Math.max(1.0, 1.7 / inflation));

  let homeGoals = tournamentHome * goalMod + momentumPush * pushMod;
  let awayGoals = tournamentAway * goalMod - momentumPush * pushMod;

  // Phase 4: player context (unavailability) applied after momentum + streak
  const fc = ctx.fixtureContext;
  let appliedContext = false;
  if (fc) {
    const hasRoleImpact =
      fc.unavailable_home_attack_impact > 0 || fc.unavailable_home_defense_impact > 0 ||
      fc.unavailable_away_attack_impact > 0 || fc.unavailable_away_defense_impact > 0;
    if (hasRoleImpact) {
      homeGoals *= Math.max(0.82, 1 - fc.unavailable_home_attack_impact);
      awayGoals *= Math.max(0.82, 1 - fc.unavailable_away_attack_impact);
      homeGoals *= 1 + fc.unavailable_away_defense_impact;
      awayGoals *= 1 + fc.unavailable_home_defense_impact;
      appliedContext = true;
    } else if (fc.unavailable_home_players > 0 || fc.unavailable_away_players > 0) {
      homeGoals *= Math.max(0.86, 1 - fc.unavailable_home_players * 0.02);
      awayGoals *= Math.max(0.86, 1 - fc.unavailable_away_players * 0.02);
      appliedContext = true;
    }
  }

  homeGoals = Math.max(0.3, homeGoals);
  awayGoals = Math.max(0.3, awayGoals);

  // Use maxGoals=10; rho=-0.08 (more aggressive than L4's -0.03) to reduce
  // over-weighting of 0-0 and 1-1 and improve exact score calibration.
  const scoreline = poissonScoreline(homeGoals, awayGoals, 10, -0.08);

  // Most-likely score = argmax of the joint Dixon-Coles matrix (the true MLE
  // scoreline, maximizing exact-hit rate). This unifies the score shown in the
  // consolidated card with the score measured by exact_score_correct — both now
  // read from the same scoreline distribution rather than a Math.round heuristic.
  const best = getMostLikely(scoreline);

  const pushSign = momentumPush >= 0 ? '+' : '';
  const drivers: string[] = [
    `Inflación goleadora: ×${inflation.toFixed(2)} (base: ${baseHome.toFixed(2)}-${baseAway.toFixed(2)} → torneo: ${tournamentHome.toFixed(2)}-${tournamentAway.toFixed(2)})`,
    `Momentum: diff forma ${netDiff.toFixed(2)} · diff goles/partido ${goalRatioPush.toFixed(2)} → blend ${blendedDiff.toFixed(2)} → push ${pushSign}${momentumPush.toFixed(2)} goles [boost ×${dynamicBoost.toFixed(2)}]`,
  ];

  if (ps?.isConfirmed) {
    drivers.push(`Racha diaria (${ps.streakDays}d): ${ps.currentStreak} → goles ×${goalMod.toFixed(2)}, push ×${pushMod.toFixed(2)}`);
  }

  if (appliedContext && fc) {
    const hasRoleImpact = fc.unavailable_home_attack_impact > 0 || fc.unavailable_away_attack_impact > 0;
    if (hasRoleImpact) {
      drivers.push(`Bajas: ataque ${ctx.homeTeam.name} -${(fc.unavailable_home_attack_impact * 100).toFixed(0)}%, ${ctx.awayTeam.name} -${(fc.unavailable_away_attack_impact * 100).toFixed(0)}%`);
    } else {
      drivers.push(`Bajas: ${ctx.homeTeam.name} ${fc.unavailable_home_players}, ${ctx.awayTeam.name} ${fc.unavailable_away_players}`);
    }
  }

  if (homeTF && homeTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.homeTeam.name}): +${homeTF.upsetBonus.toFixed(3)}`);
  }
  if (awayTF && awayTF.upsetBonus > 0) {
    drivers.push(`Bonus por sorpresa (${ctx.awayTeam.name}): +${awayTF.upsetBonus.toFixed(3)}`);
  }

  const featuresUsed: string[] = ['Modelo de goles', `Inflación goleadora ×${inflation.toFixed(2)}`];
  const featuresMissing: string[] = [];

  if (homeTF !== null) {
    featuresUsed.push(`Forma en torneo (${ctx.homeTeam.name}: ${homeTF.played} partidos)`);
  } else {
    featuresMissing.push(`forma en torneo de ${ctx.homeTeam.name}`);
  }
  if (awayTF !== null) {
    featuresUsed.push(`Forma en torneo (${ctx.awayTeam.name}: ${awayTF.played} partidos)`);
  } else {
    featuresMissing.push(`forma en torneo de ${ctx.awayTeam.name}`);
  }
  if (appliedContext) featuresUsed.push('Disponibilidad de jugadores');
  if (ps?.isConfirmed) {
    featuresUsed.push(`Racha diaria: ${ps.currentStreak} ×${ps.streakDays}d`);
  } else {
    featuresMissing.push('racha diaria confirmada (mínimo 2 días consecutivos)');
  }
  if (goalDegraded) featuresMissing.push('datos requeridos por el modelo de goles');

  const pushNote = momentumPush !== 0
    ? ` · ${ctx.homeTeam.name} ${pushSign}${momentumPush.toFixed(2)} goles por momentum`
    : '';
  const contextNote = appliedContext ? ' · ajustado por bajas' : '';
  const explanation = bothNull && !hasInflation
    ? `Sin datos de torneo disponibles. Goles base: ${ctx.homeTeam.name} ${baseHome.toFixed(2)} - ${baseAway.toFixed(2)} ${ctx.awayTeam.name}.`
    : `×${inflation.toFixed(2)} inflación goleadora${pushNote}${contextNote}. Goles finales: ${ctx.homeTeam.name} ${homeGoals.toFixed(2)} - ${awayGoals.toFixed(2)} ${ctx.awayTeam.name}.`;

  return {
    predictorName: 'Momentum del Mundial',
    predictorPriority: 6,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome: scorelineToOutcome(scoreline),
    expectedHomeGoals: Math.round(homeGoals * 100) / 100,
    expectedAwayGoals: Math.round(awayGoals * 100) / 100,
    scoreline,
    mostLikelyScore: best,
    explanation,
    drivers,
    featuresUsed,
    featuresMissing,
    sources: [
      { name: 'historical_results.csv', kind: 'csv' },
      { name: 'wc_actual_results', kind: 'db' },
    ],
    degraded,
  };
}
