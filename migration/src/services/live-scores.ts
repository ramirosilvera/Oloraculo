// =============================================================================
// Oloráculo — football-data.org live scores service
// Free tier: 10 req/min. CORS-enabled. Used in X-Auth-Token header.
// =============================================================================

const FD_API_KEY = import.meta.env.VITE_FD_API_KEY as string | undefined;
const BASE_URL = 'https://api.football-data.org/v4';

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
  // resolved against our local team IDs
  homeLocalId: string | null;
  awayLocalId: string | null;
}

// ──────────────────────────────────────────────────────────
// Name → local-ID mapping
// ──────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Overrides for names that don't normalize cleanly
const FD_NAME_OVERRIDES: Record<string, string> = {
  'cote-divoire':         'ivory-coast',
  'ivory-coast':          'ivory-coast',
  'cote-d-ivoire':        'ivory-coast',
  'dr-congo':             'congo-dr',
  'congo-dr':             'congo-dr',
  'democratic-republic-of-congo': 'congo-dr',
  'czech-republic':       'czechia',
  'czechia':              'czechia',
  'curacao':              'curacao',
  'curvacao':             'curacao',
  'united-states':        'united-states',
  'usa':                  'united-states',
  'south-korea':          'south-korea',
  'korea-republic':       'south-korea',
  'republic-of-korea':    'south-korea',
  'new-zealand':          'new-zealand',
  'new-caledonia':        'new-caledonia',
  'saudi-arabia':         'saudi-arabia',
  'bosnia-Herzegovina':   'bosnia-and-herzegovina',
  'bosnia-and-herzegovina': 'bosnia-and-herzegovina',
  'cape-verde':           'cape-verde',
};

function resolveLocalId(fdName: string): string | null {
  const slug = toSlug(fdName);
  return FD_NAME_OVERRIDES[slug] ?? slug;
}

// ──────────────────────────────────────────────────────────
// API fetch
// ──────────────────────────────────────────────────────────

interface FdScore {
  home: number | null;
  away: number | null;
}

interface FdMatch {
  id: number;
  status: string;
  utcDate: string;
  minute?: number | null;
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  score: { fullTime: FdScore; currentPeriod?: FdScore };
}

interface FdResponse {
  matches: FdMatch[];
  error?: string;
}

function parseMinute(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  return null;
}

function mapMatch(m: FdMatch): LiveMatch {
  const homeGoals = m.score.fullTime.home ?? m.score.currentPeriod?.home ?? null;
  const awayGoals = m.score.fullTime.away ?? m.score.currentPeriod?.away ?? null;
  return {
    fdId: m.id,
    status: m.status as LiveStatus,
    minute: parseMinute(m.minute),
    homeTeamFdName: m.homeTeam.name,
    awayTeamFdName: m.awayTeam.name,
    homeGoals,
    awayGoals,
    utcDate: m.utcDate,
    homeLocalId: resolveLocalId(m.homeTeam.name),
    awayLocalId: resolveLocalId(m.awayTeam.name),
  };
}

export async function fetchWcMatches(statusFilter?: string): Promise<LiveMatch[]> {
  if (!FD_API_KEY) {
    console.warn('[live-scores] VITE_FD_API_KEY not set');
    return [];
  }

  const params = statusFilter ? `?status=${statusFilter}` : '';
  const res = await fetch(`${BASE_URL}/competitions/WC/matches${params}`, {
    headers: { 'X-Auth-Token': FD_API_KEY },
  });

  if (res.status === 429) throw new Error('rate-limit');
  if (!res.ok) throw new Error(`fd-api-${res.status}`);

  const data: FdResponse = await res.json();
  return (data.matches ?? []).map(mapMatch);
}

/** Fetch only live + today's finished matches (minimal quota usage) */
export async function fetchLiveAndRecent(): Promise<LiveMatch[]> {
  // Fetch IN_PLAY + PAUSED in one call, then FINISHED separately for today
  const [live, finished] = await Promise.allSettled([
    fetchWcMatches('IN_PLAY,PAUSED'),
    fetchWcMatches('FINISHED'),
  ]);

  const liveMatches = live.status === 'fulfilled' ? live.value : [];
  const finishedToday = finished.status === 'fulfilled'
    ? finished.value.filter(m => {
        const matchDate = m.utcDate.slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        return matchDate >= yesterday;
      })
    : [];

  // Merge, dedup by fdId
  const seen = new Set<number>();
  const result: LiveMatch[] = [];
  for (const m of [...liveMatches, ...finishedToday]) {
    if (!seen.has(m.fdId)) { seen.add(m.fdId); result.push(m); }
  }
  return result;
}
