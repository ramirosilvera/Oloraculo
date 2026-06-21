// SCF hook — computes and caches SCF score for a single fixture.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadSCFHeuristics } from '../services/scf-service';
import { buildSCFContext } from '../engine/scf/context-builder';
import { computeSCFScore } from '../engine/scf/engine';
import type { Fixture, Rating, Team, WcActualResult } from '../types/domain';
import type { SquadStrengthEntry } from '../types/domain';
import type { SCFResult } from '../types/scf';

interface UseSCFOptions {
  fixture: Fixture;
  homeTeam: Team | undefined;
  awayTeam: Team | undefined;
  ratings: Rating[];
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  squadStrengthData: Record<string, SquadStrengthEntry>;
  enabled?: boolean;
}

export function useSCFForFixture({
  fixture,
  homeTeam,
  awayTeam,
  ratings,
  allFixtures,
  wcResults,
  squadStrengthData,
  enabled = true,
}: UseSCFOptions): { result: SCFResult | null; isLoading: boolean } {
  const { data: heuristics, isLoading } = useQuery({
    queryKey: ['scf-heuristics'],
    queryFn: loadSCFHeuristics,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const result = useMemo<SCFResult | null>(() => {
    if (!enabled || !homeTeam || !awayTeam || !heuristics) return null;
    const ctx = buildSCFContext(
      fixture,
      homeTeam,
      awayTeam,
      ratings,
      allFixtures,
      wcResults,
      squadStrengthData,
    );
    return computeSCFScore(ctx, heuristics);
  }, [enabled, fixture, homeTeam, awayTeam, ratings, allFixtures, wcResults, squadStrengthData, heuristics]);

  return { result, isLoading };
}
