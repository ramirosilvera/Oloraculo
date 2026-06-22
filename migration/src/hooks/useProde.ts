// Computes the Prode standings across all played WC matches.
// Shares the ['scf-heuristics'] React Query cache with useSCFForFixture.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadSCFHeuristics } from '../services/scf-service';
import { buildSCFContext } from '../engine/scf/context-builder';
import { computeSCFScore, STATIC_HEURISTICS } from '../engine/scf/engine';
import { computeProdeStandings, PRODE_PLAYERS } from '../engine/scf/prode';
import type { Fixture, Rating, Team, WcActualResult, SquadStrengthEntry } from '../types/domain';
import type { ProdeStanding } from '../types/scf';

interface UseProdeStandingsOptions {
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  teamMap: Map<string, Team>;
  ratings: Rating[];
  squadStrengthData: Record<string, SquadStrengthEntry>;
  enabled?: boolean;
}

export function useProdeStandings({
  allFixtures,
  wcResults,
  teamMap,
  ratings,
  squadStrengthData,
  enabled = true,
}: UseProdeStandingsOptions): { standings: ProdeStanding[]; leadingPlayer: ProdeStanding | null } {
  const { data: heuristics } = useQuery({
    queryKey: ['scf-heuristics'],
    queryFn: loadSCFHeuristics,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const fixtureById = useMemo(
    () => new Map(allFixtures.map(f => [f.id, f])),
    [allFixtures],
  );

  const standings = useMemo<ProdeStanding[]>(() => {
    if (!enabled) return PRODE_PLAYERS.map(p => ({ player: p, correct: 0, total: 0 }));

    const h = heuristics ?? STATIC_HEURISTICS;

    const playedData: Array<{
      fixtureId: string;
      outcome: { homeWin: number; draw: number; awayWin: number };
      actual: 'Home' | 'Draw' | 'Away';
    }> = [];

    for (const r of wcResults) {
      const fixture = fixtureById.get(r.fixture_id);
      if (!fixture) continue;
      const homeTeam = teamMap.get(fixture.home_team_id);
      const awayTeam = teamMap.get(fixture.away_team_id);
      if (!homeTeam || !awayTeam) continue;

      const ctx = buildSCFContext(
        fixture, homeTeam, awayTeam, ratings, allFixtures, wcResults, squadStrengthData,
      );
      const scfResult = computeSCFScore(ctx, h);
      if (scfResult.degraded) continue;

      const actual: 'Home' | 'Draw' | 'Away' =
        r.home_goals > r.away_goals ? 'Home'
        : r.home_goals === r.away_goals ? 'Draw'
        : 'Away';

      playedData.push({ fixtureId: r.fixture_id, outcome: scfResult.outcome, actual });
    }

    return computeProdeStandings(playedData);
  }, [enabled, wcResults, fixtureById, teamMap, ratings, allFixtures, squadStrengthData, heuristics]);

  const leadingPlayer = standings.length > 0 && standings[0].total > 0 ? standings[0] : null;

  return { standings, leadingPlayer };
}
