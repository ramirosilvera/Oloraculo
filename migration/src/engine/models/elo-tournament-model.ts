// =============================================================================
// Oloráculo — L2.5 Tournament Elo Model ("Elo del Torneo")
// Runs a live Elo simulation through all past WC matches with K=32.
// Unlike static Elo (L2, pre-tournament ratings), this updates after each
// match and reflects the team's actual performance in this specific tournament.
// =============================================================================

import type { MatchContext, MatchPrediction } from '../../types/domain';
import { UNIFORM_OUTCOME } from '../../types/domain';
import { eloExpectation, outcomeFromExpectation } from '../probability-helper';

export function eloTournamentPredict(ctx: MatchContext): MatchPrediction {
  const homeElo = ctx.homeTournamentElo;
  const awayElo = ctx.awayTournamentElo;

  if (homeElo == null || awayElo == null) {
    return {
      predictorName: 'Elo del Torneo',
      predictorPriority: 2.5,
      fixtureId: ctx.fixture.id,
      homeTeamId: ctx.homeTeam.id,
      awayTeamId: ctx.awayTeam.id,
      outcome: { ...UNIFORM_OUTCOME },
      expectedHomeGoals: null,
      expectedAwayGoals: null,
      scoreline: null,
      mostLikelyScore: null,
      explanation: 'Sin datos de Elo de torneo disponibles.',
      drivers: [],
      featuresUsed: [],
      featuresMissing: ['ratings Elo base'],
      sources: [],
      degraded: true,
    };
  }

  const baseHomeElo = ctx.homeElo?.value ?? homeElo;
  const baseAwayElo = ctx.awayElo?.value ?? awayElo;
  const homeDelta = Math.round(homeElo - baseHomeElo);
  const awayDelta = Math.round(awayElo - baseAwayElo);

  const expected = eloExpectation(homeElo, awayElo);
  const diff = homeElo - awayElo;
  const outcome = outcomeFromExpectation(expected, diff);

  return {
    predictorName: 'Elo del Torneo',
    predictorPriority: 2.5,
    fixtureId: ctx.fixture.id,
    homeTeamId: ctx.homeTeam.id,
    awayTeamId: ctx.awayTeam.id,
    outcome,
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    scoreline: null,
    mostLikelyScore: null,
    explanation: `Elo de torneo (K=32): ${ctx.homeTeam.name} ${Math.round(homeElo)} (${homeDelta >= 0 ? '+' : ''}${homeDelta}) vs ${ctx.awayTeam.name} ${Math.round(awayElo)} (${awayDelta >= 0 ? '+' : ''}${awayDelta}).`,
    drivers: [
      `Elo torneo ${ctx.homeTeam.name}: ${Math.round(homeElo)} (base ${Math.round(baseHomeElo)}, Δ${homeDelta >= 0 ? '+' : ''}${homeDelta})`,
      `Elo torneo ${ctx.awayTeam.name}: ${Math.round(awayElo)} (base ${Math.round(baseAwayElo)}, Δ${awayDelta >= 0 ? '+' : ''}${awayDelta})`,
    ],
    featuresUsed: ['Elo de torneo (simulación K=32)', 'Resultados WC actuales'],
    featuresMissing: [],
    sources: [
      { name: 'elo_snapshot.csv', kind: 'csv' },
      { name: 'wc_actual_results', kind: 'db' },
    ],
    degraded: false,
  };
}
