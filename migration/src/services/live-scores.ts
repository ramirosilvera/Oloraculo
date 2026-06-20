// =============================================================================
// Oloráculo — ESPN live scores via Supabase Edge Function
// Edge Function: /functions/v1/live-scores  (no auth required)
// Polls every 60s. Keyed by "homeLocalId:awayLocalId" for fixture lookup.
// =============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const EDGE_FN_URL  = `${SUPABASE_URL}/functions/v1/live-scores`;

export type LiveStatus = 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED' | 'TIMED';

export interface LiveMatch {
  fdId: number;
  status: LiveStatus;
  minute: number | null;
  homeTeamFdName: string;
  awayTeamFdName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  utcDate: string;
  homeLocalId: string | null;
  awayLocalId: string | null;
}

export async function fetchLiveAndRecent(): Promise<LiveMatch[]> {
  const res = await fetch(EDGE_FN_URL);
  if (res.status === 429) throw new Error('rate-limit');
  if (!res.ok) throw new Error(`edge-fn-${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as LiveMatch[];
}
