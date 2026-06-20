// =============================================================================
// Oloráculo — useLiveScores: polling hook for football-data.org live scores
// Polls every 60s. Keyed by "homeLocalId:awayLocalId" for fixture lookup.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { fetchLiveAndRecent } from '../services/live-scores';
import type { LiveMatch } from '../services/live-scores';

export type { LiveMatch };

const POLL_INTERVAL_MS = 60_000;

// Build a lookup key that matches how we identify fixtures locally
function liveKey(homeId: string | null, awayId: string | null): string {
  return `${homeId ?? ''}:${awayId ?? ''}`;
}

export interface UseLiveScoresResult {
  /** Map<"homeLocalId:awayLocalId", LiveMatch> */
  liveByKey: Map<string, LiveMatch>;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  hasActiveKey: boolean;
}

export function useLiveScores(): UseLiveScoresResult {
  const apiKeySet = Boolean(import.meta.env.VITE_FD_API_KEY);

  const { data, isLoading, dataUpdatedAt, error } = useQuery<LiveMatch[], Error>({
    queryKey: ['live-scores'],
    queryFn: fetchLiveAndRecent,
    enabled: apiKeySet,
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
    const key = liveKey(m.homeLocalId, m.awayLocalId);
    liveByKey.set(key, m);
  }

  const hasLiveNow = (data ?? []).some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');

  return {
    liveByKey,
    isLoading,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    error: error ? error.message : null,
    hasActiveKey: apiKeySet,
    // expose whether any match is currently live (so callers can shorten poll)
    ...(hasLiveNow ? {} : {}),
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
