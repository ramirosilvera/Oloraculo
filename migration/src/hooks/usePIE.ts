// PIE hook — computes PIE score for a single fixture (pure, no server fetch needed).

import { useMemo } from 'react';
import { computePIEScore } from '../engine/pie/engine';
import type { Fixture, Rating, WcActualResult } from '../types/domain';
import type { PIEResult } from '../types/pie';

function latestElo(teamId: string, ratings: Rating[]): number {
  let best: Rating | null = null;
  for (const r of ratings) {
    if (r.team_id !== teamId || r.type !== 'elo') continue;
    if (!best || r.as_of > best.as_of) best = r;
  }
  return best?.value ?? 0;
}

interface UsePIEOptions {
  fixture: Fixture | null;
  ratings: Rating[];
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  enabled?: boolean;
}

export function usePIEForFixture({
  fixture,
  ratings,
  allFixtures,
  wcResults,
  enabled = true,
}: UsePIEOptions): { result: PIEResult | null } {
  // Build a lookup map so reputation can use per-fixture Elo
  const eloByFixture = useMemo(() => {
    const fixtureById = new Map(allFixtures.map(f => [f.id, f]));
    const map = new Map<string, { home: number; away: number }>();
    for (const r of wcResults) {
      const f = fixtureById.get(r.fixture_id);
      if (!f) continue;
      map.set(r.fixture_id, {
        home: latestElo(f.home_team_id, ratings),
        away: latestElo(f.away_team_id, ratings),
      });
    }
    return map;
  }, [allFixtures, wcResults, ratings]);

  const result = useMemo<PIEResult | null>(() => {
    if (!enabled || !fixture) return null;
    const homeElo = latestElo(fixture.home_team_id, ratings);
    const awayElo = latestElo(fixture.away_team_id, ratings);
    return computePIEScore({ fixture, homeElo, awayElo, allFixtures, wcResults, eloByFixture });
  }, [enabled, fixture, ratings, allFixtures, wcResults, eloByFixture]);

  return { result };
}
