// =============================================================================
// Oloráculo — useLiveScores: polling hook for ESPN live scores (via Edge Fn)
// Polls every 60s. Keyed by "homeLocalId:awayLocalId" for fixture lookup.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { fetchLiveAndRecent } from '../services/live-scores';
import type { LiveMatch, LiveEvent } from '../services/live-scores';

export type { LiveMatch, LiveEvent };

const POLL_INTERVAL_MS = 60_000;

export interface UseLiveScoresResult {
  /** Map<"homeLocalId:awayLocalId", LiveMatch> */
  liveByKey: Map<string, LiveMatch>;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

export function useLiveScores(): UseLiveScoresResult {
  const { data, isLoading, dataUpdatedAt, error } = useQuery<LiveMatch[], Error>({
    queryKey: ['live-scores'],
    queryFn: fetchLiveAndRecent,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS - 5_000,
    retry: (count, err) => {
      if ((err as Error).message === 'rate-limit') return false;
      return count < 2;
    },
  });

  const liveByKey = new Map<string, LiveMatch>();
  for (const m of data ?? []) {
    liveByKey.set(`${m.homeLocalId ?? ''}:${m.awayLocalId ?? ''}`, m);
  }

  return {
    liveByKey,
    isLoading,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    error: error ? error.message : null,
  };
}

/** Get a LiveMatch for a specific fixture by its home/away local IDs */
export function getLiveForFixture(
  liveByKey: Map<string, LiveMatch>,
  homeId: string,
  awayId: string,
): LiveMatch | undefined {
  return liveByKey.get(`${homeId}:${awayId}`);
}
