// =============================================================================
// SCF — Heuristic evaluator functions
// Each function receives SCFMatchContext and returns a HeuristicSignal.
// direction: +1 = home advantage, -1 = away advantage, 0 = neutral.
// strength: 0 = barely applies, 1 = maximally applies.
// Heuristic IDs must match those seeded in scf_heuristics Supabase table.
// =============================================================================

import type { HeuristicSignal, SCFMatchContext } from '../../types/scf';

const DEFENDING_CHAMPION = 'argentina';
const HOST_NATIONS = new Set(['usa', 'united-states', 'mexico', 'canada']);

const UEFA_TEAMS = new Set([
  'germany', 'france', 'spain', 'england', 'italy', 'portugal', 'netherlands',
  'belgium', 'croatia', 'serbia', 'austria', 'denmark', 'switzerland', 'poland',
  'czechia', 'ukraine', 'hungary', 'slovakia', 'scotland', 'turkey', 'albania',
  'romania', 'slovenia', 'wales', 'northern-ireland', 'ireland', 'greece',
  'norway', 'sweden', 'finland', 'iceland',
]);

const CAF_TEAMS = new Set([
  'morocco', 'senegal', 'nigeria', 'cameroon', 'ivory-coast', 'ghana',
  'algeria', 'south-africa', 'mali', 'tunisia', 'egypt', 'tanzania',
  'benin', 'congo-dr', 'guinea', 'zambia', 'zimbabwe', 'cape-verde',
  'equatorial-guinea', 'mozambique', 'namibia', 'burkina-faso', 'ethiopia',
  'kenya', 'angola', 'rwanda',
]);

const BIG_JERSEY_TEAMS = new Set([
  'brazil', 'argentina', 'germany', 'france', 'spain', 'england', 'italy', 'portugal',
]);

const null_signal: HeuristicSignal = { applies: false, direction: 0, strength: 0, note: '' };

// ---------------------------------------------------------------------------
// HISTORIA
// ---------------------------------------------------------------------------

export function eval_h_defending_champ_falls(ctx: SCFMatchContext): HeuristicSignal {
  const homeIsChamp = ctx.homeTeam.id === DEFENDING_CHAMPION || ctx.isDefendingChampion.home;
  const awayIsChamp = ctx.awayTeam.id === DEFENDING_CHAMPION || ctx.isDefendingChampion.away;
  if (!homeIsChamp && !awayIsChamp) return null_signal;
  // Champ has target on back; slight disadvantage
  const direction = homeIsChamp ? -0.35 : 0.35;
  const team = homeIsChamp ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.6,
    note: `${team} es el campeón defensor — blanco preferido del resto del mundo`,
  };
}

export function eval_h_big_dont_fail_twice(ctx: SCFMatchContext): HeuristicSignal {
  const homeIsBig = BIG_JERSEY_TEAMS.has(ctx.homeTeam.id);
  const awayIsBig = BIG_JERSEY_TEAMS.has(ctx.awayTeam.id);
  if (!homeIsBig && !awayIsBig) return null_signal;
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  // Big team with no wins yet (dropped points) — history says they respond
  const homeDropped = homeIsBig && homeGames >= 1 && ctx.homeWCWins === 0;
  const awayDropped = awayIsBig && awayGames >= 1 && ctx.awayWCWins === 0;
  if (!homeDropped && !awayDropped) return null_signal;
  const direction = homeDropped && !awayDropped ? 0.3
                  : awayDropped && !homeDropped ? -0.3
                  : 0;
  if (direction === 0) return null_signal;
  const team = direction > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.55,
    note: `${team} (grande) aún sin ganar — las selecciones históricas responden cuando están contra la pared`,
  };
}

export function eval_h_no_wc_without_scare(ctx: SCFMatchContext): HeuristicSignal {
  const eloDiff = ctx.homeElo - ctx.awayElo;
  const gap = Math.abs(eloDiff);
  if (gap < 100) return null_signal;
  const direction = eloDiff > 0 ? -0.15 : 0.15;
  const underdog = eloDiff > 0 ? ctx.awayTeam.name : ctx.homeTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.55, (gap - 100) / 300),
    note: `En todo Mundial hay sustos — ${underdog} puede ser el scare`,
  };
}

export function eval_h_weight_of_jersey(ctx: SCFMatchContext): HeuristicSignal {
  const homeIsBig = BIG_JERSEY_TEAMS.has(ctx.homeTeam.id);
  const awayIsBig = BIG_JERSEY_TEAMS.has(ctx.awayTeam.id);
  if (!homeIsBig && !awayIsBig) return null_signal;
  // Over-rated jerseys tend to disappoint → bias signal, down-weighted externally
  const direction = homeIsBig && !awayIsBig ? -0.2 : awayIsBig && !homeIsBig ? 0.2 : 0;
  if (direction === 0) return null_signal;
  const bigTeam = direction < 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.4,
    note: `${bigTeam} carga el peso histórico de la camiseta — sesgo de sobreestimación`,
  };
}

export function eval_h_subchampion_curse(_ctx: SCFMatchContext): HeuristicSignal {
  return null_signal; // needs prior-WC runner-up data
}

// ---------------------------------------------------------------------------
// FORMA
// ---------------------------------------------------------------------------

export function eval_h_tournament_streak(ctx: SCFMatchContext): HeuristicSignal {
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  if (homeGames < 1 && awayGames < 1) return null_signal;

  const homePts = homeGames > 0 ? (ctx.homeWCWins * 3 + ctx.homeWCDraws) / (homeGames * 3) : 0.33;
  const awayPts = awayGames > 0 ? (ctx.awayWCWins * 3 + ctx.awayWCDraws) / (awayGames * 3) : 0.33;

  // Include goal differential as tiebreaker: a 3-0 win is not the same as 1-0
  const homeGD = homeGames > 0 ? Math.max(-4, Math.min(4, (ctx.homeWCGoalsFor - ctx.homeWCGoalsAgainst) / homeGames)) / 8 : 0;
  const awayGD = awayGames > 0 ? Math.max(-4, Math.min(4, (ctx.awayWCGoalsFor - ctx.awayWCGoalsAgainst) / awayGames)) / 8 : 0;

  // 70% points rate, 30% goal differential
  const homeComp = homePts * 0.70 + homeGD * 0.30;
  const awayComp = awayPts * 0.70 + awayGD * 0.30;
  const gap = homeComp - awayComp;
  if (Math.abs(gap) < 0.10) return null_signal;

  const direction = Math.max(-0.6, Math.min(0.6, gap * 1.2));
  const team = gap > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.85, Math.abs(gap) * 2.0),
    note: `${team} viene en mejor forma dentro del torneo (puntos + diferencia de goles)`,
  };
}

export function eval_h_blowout_bounce(ctx: SCFMatchContext): HeuristicSignal {
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  if (homeGames < 1 || awayGames < 1) return null_signal;

  const homeAvgConceded = homeGames > 0 ? ctx.homeWCGoalsAgainst / homeGames : 0;
  const awayAvgConceded = awayGames > 0 ? ctx.awayWCGoalsAgainst / awayGames : 0;

  // Team that conceded a lot but is still in tournament often reacts
  const homeReacts = homeAvgConceded >= 2 && ctx.homeWCLosses >= 1;
  const awayReacts = awayAvgConceded >= 2 && ctx.awayWCLosses >= 1;
  if (!homeReacts && !awayReacts) return null_signal;

  // Hard to predict direction — slight towards the team that got beaten badly (bounce back)
  const direction = homeReacts && !awayReacts ? 0.25 : !homeReacts && awayReacts ? -0.25 : 0;
  if (direction === 0) return null_signal;

  const team = direction > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.4,
    note: `${team} viene de encajar muchos goles — el rebote emocional puede activarse`,
  };
}

export function eval_h_after_loss_unpredictable(ctx: SCFMatchContext): HeuristicSignal {
  const homeLost = ctx.homeWCLosses >= 1;
  const awayLost = ctx.awayWCLosses >= 1;
  if (!homeLost && !awayLost) return null_signal;
  // After a loss, outcomes become less predictable — slight push toward draw
  return {
    applies: true,
    direction: 0,
    strength: 0.3,
    note: 'Equipo(s) con derrota previa → imprevisibilidad aumenta',
  };
}

export function eval_h_dry_team_keeps_dry(ctx: SCFMatchContext): HeuristicSignal {
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  if (homeGames < 1 || awayGames < 1) return null_signal;

  const homeAvgFor = ctx.homeWCGoalsFor / homeGames;
  const awayAvgFor = ctx.awayWCGoalsFor / awayGames;
  const bothLowScoring = homeAvgFor < 1.2 && awayAvgFor < 1.2;
  if (!bothLowScoring) return null_signal;

  return {
    applies: true,
    direction: 0,   // draw-leaning (captured in outcome conversion)
    strength: 0.5,
    note: `Ambos equipos vienen con pocas anotaciones — patrón bajo de goles esperado`,
  };
}

// ---------------------------------------------------------------------------
// PLANTEL
// ---------------------------------------------------------------------------

export function eval_h_star_player_matters(ctx: SCFMatchContext): HeuristicSignal {
  // Use squad value differential as proxy for star presence — marked as bias
  const diff = ctx.homeSquadStrength - ctx.awaySquadStrength;
  if (Math.abs(diff) < 0.1) return null_signal;
  const direction = Math.max(-0.3, Math.min(0.3, diff * 0.8));
  const team = diff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.abs(diff),
    note: `${team} tiene mayor concentración de estrellas según valor de mercado (sesgo)`,
  };
}

export function eval_h_squad_depth_matters(ctx: SCFMatchContext): HeuristicSignal {
  const diff = ctx.homeSquadStrength - ctx.awaySquadStrength;
  if (Math.abs(diff) < 0.15) return null_signal;
  const direction = Math.max(-0.55, Math.min(0.55, diff * 1.1));
  const team = diff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.9, Math.abs(diff) * 1.5),
    note: `${team} con mayor profundidad de plantel (valor de mercado + ligas top-5)`,
  };
}

export function eval_h_africans_surprise_groups(ctx: SCFMatchContext): HeuristicSignal {
  if (ctx.isKnockout) return null_signal;
  const homeCAF = CAF_TEAMS.has(ctx.homeTeam.id);
  const awayCAF = CAF_TEAMS.has(ctx.awayTeam.id);
  if (!homeCAF && !awayCAF) return null_signal;
  // African teams historically surprise in group stage — slight uplift if underdog on Elo
  const eloDiff = ctx.homeElo - ctx.awayElo;
  const africaIsUnderdog = (homeCAF && eloDiff < -50) || (awayCAF && eloDiff > 50);
  if (!africaIsUnderdog) return null_signal;
  const direction = homeCAF ? 0.2 : -0.2;
  const team = homeCAF ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.35,
    note: `${team} (CAF) tiende a sorprender en fase de grupos — patrón observado históricamente (sesgo)`,
  };
}

export function eval_h_europeans_grow_knockouts(ctx: SCFMatchContext): HeuristicSignal {
  if (!ctx.isKnockout) return null_signal;
  const homeUEFA = UEFA_TEAMS.has(ctx.homeTeam.id);
  const awayUEFA = UEFA_TEAMS.has(ctx.awayTeam.id);
  if (!homeUEFA && !awayUEFA) return null_signal;
  const direction = homeUEFA && !awayUEFA ? 0.3 : !homeUEFA && awayUEFA ? -0.3 : 0;
  if (direction === 0) return null_signal;
  const team = direction > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.55,
    note: `${team} (UEFA) mejora en fase eliminatoria — experiencia europea en torneos de alta exigencia`,
  };
}

// ---------------------------------------------------------------------------
// TORNEO
// ---------------------------------------------------------------------------

export function eval_h_host_advantage(ctx: SCFMatchContext): HeuristicSignal {
  const homeIsHost = ctx.isHostNation.home;
  const awayIsHost = ctx.isHostNation.away;
  if (!homeIsHost && !awayIsHost) return null_signal;
  const direction = homeIsHost ? 0.55 : -0.55;
  const team = homeIsHost ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.85,
    note: `${team} juega como sede local — ventaja histórica del anfitrión (78% de efectividad)`,
  };
}

export function eval_h_knockout_upset_window(ctx: SCFMatchContext): HeuristicSignal {
  if (!ctx.isKnockout) return null_signal;
  const eloDiff = ctx.homeElo - ctx.awayElo;
  const gap = Math.abs(eloDiff);
  if (gap < 100) return null_signal;
  // In knockouts, favorites are more vulnerable than rating suggests
  const direction = eloDiff > 0 ? -0.2 : 0.2; // toward underdog
  const underdog = eloDiff > 0 ? ctx.awayTeam.name : ctx.homeTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.6, (gap - 100) / 300),
    note: `Eliminatorias: ventana de sorpresa para ${underdog} — el favorito es más vulnerable`,
  };
}

export function eval_h_eliminated_plays_free(ctx: SCFMatchContext): HeuristicSignal {
  // Team already eliminated (0 pts after 2 matches, cannot qualify)
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  if (ctx.isKnockout || homeGames < 2 || awayGames < 2) return null_signal;

  const homeElim = ctx.homeWCWins === 0 && ctx.homeWCDraws === 0; // 0 pts after 2
  const awayElim = ctx.awayWCWins === 0 && ctx.awayWCDraws === 0;
  if (!homeElim && !awayElim) return null_signal;

  // Eliminated team plays without pressure — slight upset potential
  const direction = homeElim ? 0.2 : -0.2;
  const team = homeElim ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: 0.4,
    note: `${team} ya eliminado — juega libre de presión, potencial de sorpresa`,
  };
}

// ---------------------------------------------------------------------------
// LOCALIA
// ---------------------------------------------------------------------------

export function eval_h_climate_latin_advantage(_ctx: SCFMatchContext): HeuristicSignal {
  return null_signal; // no weather data available
}

export function eval_h_long_travel_fatigue(_ctx: SCFMatchContext): HeuristicSignal {
  return null_signal; // no travel distance data available
}

// ---------------------------------------------------------------------------
// PSICOLOGIA
// ---------------------------------------------------------------------------

export function eval_h_revenge_factor(ctx: SCFMatchContext): HeuristicSignal {
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  if (homeGames < 1 || awayGames < 1) return null_signal;

  const homeGPG = ctx.homeWCGoalsFor / homeGames;
  const awayGPG = ctx.awayWCGoalsFor / awayGames;
  const goalGap = homeGPG - awayGPG;

  // One team clearly more clinical — psychological edge in front of goal
  if (Math.abs(goalGap) < 1.2) return null_signal;

  const direction = Math.max(-0.4, Math.min(0.4, goalGap * 0.22));
  const team = goalGap > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.65, Math.abs(goalGap) * 0.3),
    note: `${team} llega con mayor olfato goleador en el torneo — el equipo que anota se siente invencible`,
  };
}

export function eval_h_overconfidence_kills(ctx: SCFMatchContext): HeuristicSignal {
  const eloDiff = ctx.homeElo - ctx.awayElo;
  const gap = Math.abs(eloDiff);
  if (gap < 150) return null_signal;
  const direction = eloDiff > 0 ? -0.25 : 0.25;
  const fav = eloDiff > 0 ? ctx.homeTeam.name : ctx.awayTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.7, (gap - 150) / 250),
    note: `${fav} como gran favorito — sobreconfianza históricamente la castiga (68% se cumple)`,
  };
}

export function eval_h_debut_nerves(ctx: SCFMatchContext): HeuristicSignal {
  const homeGames = ctx.homeWCWins + ctx.homeWCDraws + ctx.homeWCLosses;
  const awayGames = ctx.awayWCWins + ctx.awayWCDraws + ctx.awayWCLosses;
  // Only meaningful when one team has WC 2026 rhythm and the other is playing their opener
  if (homeGames === 0 && awayGames === 0) return null_signal;
  if (homeGames > 0 && awayGames > 0) return null_signal;
  if (homeGames === 0) {
    return {
      applies: true,
      direction: -0.25,
      strength: 0.45,
      note: `${ctx.homeTeam.name} debuta en el torneo — ${ctx.awayTeam.name} ya tiene ritmo competitivo`,
    };
  }
  return {
    applies: true,
    direction: 0.25,
    strength: 0.45,
    note: `${ctx.awayTeam.name} debuta en el torneo — ${ctx.homeTeam.name} llega con rodaje`,
  };
}

export function eval_h_trap_game(ctx: SCFMatchContext): HeuristicSignal {
  const eloDiff = ctx.homeElo - ctx.awayElo;
  const gap = Math.abs(eloDiff);
  if (gap < 150 || !ctx.isKnockout) return null_signal;
  // Strong team overconfident vs weaker opponent in knockout — underdog gets slight lift
  const direction = eloDiff > 0 ? -0.2 : 0.2;
  const underdog = eloDiff > 0 ? ctx.awayTeam.name : ctx.homeTeam.name;
  return {
    applies: true,
    direction,
    strength: Math.min(0.5, (gap - 150) / 350),
    note: `"Trap game": ${underdog} puede sorprender al favorito confiado en eliminatoria`,
  };
}

// ---------------------------------------------------------------------------
// Evaluator registry — maps heuristic IDs to evaluator functions
// ---------------------------------------------------------------------------

type EvaluatorFn = (ctx: SCFMatchContext) => HeuristicSignal;

export const EVALUATORS: Record<string, EvaluatorFn> = {
  h_defending_champ_falls:     eval_h_defending_champ_falls,
  h_big_dont_fail_twice:       eval_h_big_dont_fail_twice,
  h_no_wc_without_scare:       eval_h_no_wc_without_scare,
  h_weight_of_jersey:          eval_h_weight_of_jersey,
  h_subchampion_curse:         eval_h_subchampion_curse,
  h_tournament_streak:         eval_h_tournament_streak,
  h_blowout_bounce:            eval_h_blowout_bounce,
  h_after_loss_unpredictable:  eval_h_after_loss_unpredictable,
  h_dry_team_keeps_dry:        eval_h_dry_team_keeps_dry,
  h_star_player_matters:       eval_h_star_player_matters,
  h_squad_depth_matters:       eval_h_squad_depth_matters,
  h_africans_surprise_groups:  eval_h_africans_surprise_groups,
  h_europeans_grow_knockouts:  eval_h_europeans_grow_knockouts,
  h_host_advantage:            eval_h_host_advantage,
  h_knockout_upset_window:     eval_h_knockout_upset_window,
  h_eliminated_plays_free:     eval_h_eliminated_plays_free,
  h_climate_latin_advantage:   eval_h_climate_latin_advantage,
  h_long_travel_fatigue:       eval_h_long_travel_fatigue,
  h_revenge_factor:            eval_h_revenge_factor,
  h_overconfidence_kills:      eval_h_overconfidence_kills,
  h_debut_nerves:              eval_h_debut_nerves,
  h_trap_game:                 eval_h_trap_game,
};
