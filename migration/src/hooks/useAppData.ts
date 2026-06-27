// Central data hook — static data from JSON files, mutable data from Supabase.

import { useQuery } from '@tanstack/react-query';
import {
  loadStaticTeams,
  loadStaticGroups,
  loadStaticFixtures,
  loadStaticKnockoutFixtures,
  loadStaticRatings,
  loadStaticResults,
  loadStaticFixtureContexts,
  loadStaticSquads,
  loadStaticSquadStrength,
  loadStaticTacticalProfiles,
} from '../services/static-data';
import { loadAllFixtureContexts, loadWcActualResults, loadAllMatchGoals, loadEvaluations } from '../services/supabase-client';
import { PredictionEngine } from '../engine/prediction-engine';
import type { FixtureContext, Rating, Team, WcActualResult } from '../types/domain';
import { useMemo } from 'react';

const FOREVER = Infinity;

export function useAppData() {
  const teams          = useQuery({ queryKey: ['teams'],           queryFn: loadStaticTeams,            staleTime: FOREVER });
  const groups         = useQuery({ queryKey: ['groups'],          queryFn: loadStaticGroups,           staleTime: FOREVER });
  const fixtures       = useQuery({ queryKey: ['fixtures'],        queryFn: loadStaticFixtures,         staleTime: FOREVER });
  const knockoutFx     = useQuery({ queryKey: ['knockout-fixtures'], queryFn: loadStaticKnockoutFixtures, staleTime: FOREVER });
  const results        = useQuery({ queryKey: ['results'],         queryFn: loadStaticResults,          staleTime: FOREVER });
  const ratings        = useQuery({ queryKey: ['ratings'],         queryFn: loadStaticRatings,          staleTime: FOREVER });
  // Auto-generated at build time from ESPN + OpenFootball (scripts/build-context.mjs)
  const staticContexts  = useQuery({ queryKey: ['static-contexts'],   queryFn: loadStaticFixtureContexts,  staleTime: FOREVER });
  const squads             = useQuery({ queryKey: ['squads'],              queryFn: loadStaticSquads,             staleTime: FOREVER });
  const squadStrength      = useQuery({ queryKey: ['squad-strength'],      queryFn: loadStaticSquadStrength,      staleTime: FOREVER });
  const tacticalProfiles   = useQuery({ queryKey: ['tactical-profiles'],   queryFn: loadStaticTacticalProfiles,   staleTime: FOREVER });
  // Supabase: user-entered manual overrides (re-fetched every 60 s)
  const contexts       = useQuery({ queryKey: ['contexts'],        queryFn: loadAllFixtureContexts,     staleTime: 60_000 });
  // Supabase: manually-entered WC results (override for real-time corrections)
  const supabaseWc     = useQuery({ queryKey: ['wc-results'],      queryFn: loadWcActualResults,        staleTime: 60_000 });
  // Supabase: goal scorers (goleadores card) + evaluation history (ensemble).
  // Loaded here so the initial splash preloads them too — Partidos is then instant.
  const matchGoals     = useQuery({ queryKey: ['match-goals'],     queryFn: loadAllMatchGoals,          staleTime: 60_000 });
  const evaluations    = useQuery({ queryKey: ['evaluations'],     queryFn: loadEvaluations,            staleTime: 60_000 });

  const teamMap = useMemo(
    () => new Map<string, Team>((teams.data ?? []).map(t => [t.id, t])),
    [teams.data],
  );

  const ratingsList = useMemo<Rating[]>(() => ratings.data ?? [], [ratings.data]);

  // Merge auto-generated (ESPN/OpenFootball) with manual (Supabase) contexts.
  // Supabase entries override static so user-entered data always wins.
  const contextMap = useMemo(() => {
    const map = new Map<string, FixtureContext>();
    for (const c of (staticContexts.data ?? [])) map.set(c.fixture_id, c);
    for (const c of (contexts.data ?? []))        map.set(c.fixture_id, c);
    return map;
  }, [staticContexts.data, contexts.data]);

  // All fixtures: group stage + knockout (knockout empty until activation)
  const allFixtures = useMemo(
    () => [...(fixtures.data ?? []), ...(knockoutFx.data ?? [])],
    [fixtures.data, knockoutFx.data],
  );

  // Build wcResults from two sources, merged:
  //   1. fixtures.json + knockout-fixtures.json played matches (source of truth — updated at each deploy)
  //   2. Supabase wc_actual_results (user-entered corrections, overrides static)
  // This ensures momentum/inflation always work even when Supabase is empty.
  const wcResults = useMemo<WcActualResult[]>(() => {
    const map = new Map<string, WcActualResult>();

    for (const f of allFixtures) {
      if (f.is_played && f.home_goals != null && f.away_goals != null) {
        map.set(f.id, {
          id: 0,
          fixture_id: f.id,
          home_goals: f.home_goals,
          away_goals: f.away_goals,
          played_at: f.kickoff_utc ?? new Date().toISOString(),
        });
      }
    }

    for (const r of (supabaseWc.data ?? [])) {
      map.set(r.fixture_id, r);
    }

    return [...map.values()];
  }, [allFixtures, supabaseWc.data]);

  const wcPlayedMap = useMemo(
    () => new Map<string, WcActualResult>(wcResults.map(r => [r.fixture_id, r])),
    [wcResults],
  );

  // Cache the engine in React Query so it's built once per session, not on
  // every page navigation (each new component instance would re-run useMemo).
  // Wait for all three data sources before building — squad/tactical models return
  // degraded results if built with empty maps and staleTime:Infinity prevents a rebuild.
  const engineQuery = useQuery({
    queryKey: ['engine'],
    queryFn: () => new PredictionEngine(results.data!, 8, squadStrength.data!, tacticalProfiles.data!),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: !!results.data && !!squadStrength.data && !!tacticalProfiles.data,
  });
  const engine = engineQuery.data ?? null;

  // The prediction engine (Dixon-Coles fit over the 2.1 MB historical_results.json)
  // is the heaviest piece. It's gated into the splash so it's fully built BEFORE the
  // user can hit "Predecir partido" — otherwise Partidos mounted with engine === null
  // and predictions were computed lazily on navigation, which felt slow.
  // Guard against hanging: if its inputs error or the build throws, stop waiting and
  // let pages degrade (they already handle engine === null).
  const enginePrereqError = !!(results.error || squadStrength.error || tacticalProfiles.error);
  const engineReady = !!engine || engineQuery.isError || enginePrereqError;

  // Page-level loading: blocks on static data (fast, local JSON), the Supabase
  // queries the user expects preloaded (goleadores + evaluations) AND the engine,
  // so once the splash clears every section — including Partidos — is instant.
  // react-query isLoading resolves on error too, so an outage can't freeze the splash.
  // supabaseWc stays out of the gate (it only gates simulation runs).
  const isLoading =
    teams.isLoading || groups.isLoading || fixtures.isLoading || ratings.isLoading ||
    matchGoals.isLoading || evaluations.isLoading ||
    !engineReady;

  // Simulation-level guard: wait for Supabase WC results before allowing a run,
  // so the engine uses up-to-date match corrections, not stale/empty data.
  const isWcResultsLoading = supabaseWc.isLoading;

  const error =
    teams.error ?? groups.error ?? fixtures.error ??
    results.error ?? ratings.error;

  return {
    teams:      teams.data    ?? [],
    groups:     groups.data   ?? [],
    fixtures:   allFixtures,
    results:    results.data  ?? [],
    ratings:    ratingsList,
    contexts:   contexts.data ?? [],
    squads:     squads.data   ?? {},
    squadStrengthData:    squadStrength.data   ?? {},
    tacticalProfilesData: tacticalProfiles.data ?? {},
    teamMap,
    ratingsList,
    contextMap,
    engine,
    wcResults,
    wcPlayedMap,
    isLoading,
    isWcResultsLoading,
    error,
  };
}
