// =============================================================================
// useAppData — loads all static data once per session from Supabase
// Replaces: all OnInitializedAsync() DB calls across Blazor pages
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import {
  loadAllTeams,
  loadAllGroups,
  loadAllFixtures,
  loadAllResults,
  loadAllRatings,
  loadAllFixtureContexts,
} from '../services/supabase-client';
import { PredictionEngine } from '../engine/prediction-engine';
import type { FixtureContext, Rating, Team } from '../types/domain';
import { useMemo } from 'react';

export function useAppData() {
  const teams = useQuery({ queryKey: ['teams'], queryFn: loadAllTeams });
  const groups = useQuery({ queryKey: ['groups'], queryFn: loadAllGroups });
  const fixtures = useQuery({ queryKey: ['fixtures'], queryFn: loadAllFixtures });
  const results = useQuery({ queryKey: ['results'], queryFn: loadAllResults });
  const ratings = useQuery({ queryKey: ['ratings'], queryFn: loadAllRatings });
  const contexts = useQuery({ queryKey: ['contexts'], queryFn: loadAllFixtureContexts });

  const teamMap = useMemo(
    () => new Map<string, Team>((teams.data ?? []).map(t => [t.id, t])),
    [teams.data],
  );

  const ratingsList = useMemo<Rating[]>(() => ratings.data ?? [], [ratings.data]);

  const contextMap = useMemo(
    () => new Map<string, FixtureContext>((contexts.data ?? []).map(c => [c.fixture_id, c])),
    [contexts.data],
  );

  const engine = useMemo(
    () => (results.data ? new PredictionEngine(results.data) : null),
    [results.data],
  );

  const isLoading =
    teams.isLoading || groups.isLoading || fixtures.isLoading ||
    results.isLoading || ratings.isLoading || contexts.isLoading;

  const error =
    teams.error ?? groups.error ?? fixtures.error ??
    results.error ?? ratings.error ?? contexts.error;

  return {
    teams: teams.data ?? [],
    groups: groups.data ?? [],
    fixtures: fixtures.data ?? [],
    results: results.data ?? [],
    ratings: ratingsList,
    contexts: contexts.data ?? [],
    teamMap,
    ratingsList,
    contextMap,
    engine,
    isLoading,
    error,
  };
}
