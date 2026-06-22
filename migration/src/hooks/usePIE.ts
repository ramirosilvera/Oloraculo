// PIE hook — computes PIE result for a single fixture.
// Track records (O(N×M)) are cached at module level so they are built once
// across all fixture rows even though each row has its own hook instance.

import { useMemo } from 'react';
import { buildPIETrackRecords, computePIEFromRecords } from '../engine/pie/engine';
import type { Fixture, Rating, WcActualResult } from '../types/domain';
import type { PIEResult, PIETrackRecords } from '../types/pie';

function latestElo(teamId: string, ratings: Rating[]): number {
  let best: Rating | null = null;
  for (const r of ratings) {
    if (r.team_id !== teamId || r.type !== 'elo') continue;
    if (!best || r.as_of > best.as_of) best = r;
  }
  return best?.value ?? 0;
}

// Module-level cache: track records are expensive to build (O(N×M) ≈ 300 ms).
// Key: "wcResults.length:allFixtures.length" — sufficient because results are
// append-only and fixtures are static.
let _recordsCache: { key: string; records: PIETrackRecords } | null = null;

function getCachedRecords(
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
  eloByFixture: Map<string, { home: number; away: number }>,
): PIETrackRecords {
  const key = `${wcResults.length}:${allFixtures.length}`;
  if (_recordsCache?.key === key) return _recordsCache.records;
  const records = buildPIETrackRecords(allFixtures, wcResults, eloByFixture);
  _recordsCache = { key, records };
  return records;
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
    const records = getCachedRecords(allFixtures, wcResults, eloByFixture);
    const homeElo = latestElo(fixture.home_team_id, ratings);
    const awayElo = latestElo(fixture.away_team_id, ratings);
    return computePIEFromRecords(fixture, homeElo, awayElo, wcResults, allFixtures, records);
  }, [enabled, fixture, ratings, allFixtures, wcResults, eloByFixture]);

  return { result };
}
