// Central data hook — static data from JSON files, mutable data from Supabase.

import { useQuery } from '@tanstack/react-query';
import {
  loadStaticTeams,
  loadStaticGroups,
  loadStaticFixtures,
  loadStaticRatings,
  loadStaticResults,
} from '../services/static-data';
import { loadAllFixtureContexts } from '../services/supabase-client';
import { PredictionEngine } from '../engine/prediction-engine';
import type { FixtureContext, Rating, Team } from '../types/domain';
import { useMemo } from 'react';

const FOREVER = Infinity;

export function useAppData() {
  const teams    = useQuery({ queryKey: ['teams'],    queryFn: loadStaticTeams,    staleTime: FOREVER });
  const groups   = useQuery({ queryKey: ['groups'],   queryFn: loadStaticGroups,   staleTime: FOREVER });
  const fixtures = useQuery({ queryKey: ['fixtures'], queryFn: loadStaticFixtures, staleTime: FOREVER });
  const results  = useQuery({ queryKey: ['results'],  queryFn: loadStaticResults,  staleTime: FOREVER });
  const ratings  = useQuery({ queryKey: ['ratings'],  queryFn: loadStaticRatings,  staleTime: FOREVER });
  const contexts = useQuery({ queryKey: ['contexts'], queryFn: loadAllFixtureContexts, staleTime: 60_000 });

  const teamMap = useMemo(
    () => new Map<string, Team>((teams.data ?? []).map(t => [t.id, t])),
    [teams.data],
  );

  const ratingsList = useMemo<Rating[]>(() => ratings.data ?? [], [ratings.data]);

  const contextMap = useMemo(
    () => new Map<string, FixtureContext>((contexts.data ?? []).map(c => [c.fixture_id, c])),
    [contexts.data],
  );

  // Cache the engine in React Query so it's built once per session, not on
  // every page navigation (each new component instance would re-run useMemo).
  const engineQuery = useQuery({
    queryKey: ['engine'],
    queryFn: () => new PredictionEngine(results.data!),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: !!results.data,
  });
  const engine = engineQuery.data ?? null;

  const isLoading =
    teams.isLoading || groups.isLoading || fixtures.isLoading ||
    results.isLoading || ratings.isLoading;

  const error =
    teams.error ?? groups.error ?? fixtures.error ??
    results.error ?? ratings.error ?? contexts.error;

  return {
    teams:    teams.data    ?? [],
    groups:   groups.data   ?? [],
    fixtures: fixtures.data ?? [],
    results:  results.data  ?? [],
    ratings:  ratingsList,
    contexts: contexts.data ?? [],
    teamMap,
    ratingsList,
    contextMap,
    engine,
    isLoading,
    error,
  };
}
