// =============================================================================
// Oloráculo — live-scores Edge Function  (v6)
// Primary source:  ESPN unofficial scoreboard (no auth, geo-blocked → proxied)
// Fallback source: football-data.org v4 (FD_API_KEY secret) for matches that
//                  ESPN hasn't reported yet or returned as SCHEDULED.
// =============================================================================

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const FD_BASE  = 'https://api.football-data.org/v4';
const FD_KEY   = Deno.env.get('FD_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type LiveStatus =
  | 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED'
  | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED' | 'TIMED';

type LiveEventType = 'goal' | 'own_goal' | 'penalty' | 'yellow_card' | 'red_card' | 'yellow_red';

interface LiveEvent {
  type:       LiveEventType;
  minute:     string;
  playerName: string;
  side:       'home' | 'away' | null;
}

interface LiveMatch {
  fdId:            number;
  status:          LiveStatus;
  minute:          number | null;
  homeTeamFdName:  string;
  awayTeamFdName:  string;
  homeGoals:       number | null;
  awayGoals:       number | null;
  utcDate:         string;
  homeLocalId:     string | null;
  awayLocalId:     string | null;
  events:          LiveEvent[];
  source:          'espn' | 'fd';
}

// ---------------------------------------------------------------------------
// ─── ESPN ───────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
function mapEspnStatus(name: string, period: number): LiveStatus {
  switch (name) {
    case 'STATUS_SCHEDULED':
    case 'STATUS_PREGAME':
      return 'SCHEDULED';
    case 'STATUS_RAIN_DELAY':  return 'SUSPENDED';
    case 'STATUS_DELAYED':     return 'POSTPONED';
    case 'STATUS_CANCELED':
    case 'STATUS_ABANDONED':   return 'CANCELLED';
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_FIRST_HALF':
    case 'STATUS_SECOND_HALF':
    case 'STATUS_EXTRA_TIME':
    case 'STATUS_ET_FIRST_HALF':
    case 'STATUS_ET_SECOND_HALF':
    case 'STATUS_SHOOTOUT':    return 'IN_PLAY';
    case 'STATUS_HALFTIME':
    case 'STATUS_BREAK':
    case 'STATUS_ET_BREAK':    return 'PAUSED';
    case 'STATUS_FINAL':
    case 'STATUS_FULL_TIME':
    case 'STATUS_FINAL_AET':
    case 'STATUS_FINAL_PEN':
    case 'STATUS_POST_GAME':   return 'FINISHED';
    default: return period > 0 ? 'IN_PLAY' : 'SCHEDULED';
  }
}

function parseMinuteFromShortDetail(shortDetail: string | undefined): number | null {
  if (!shortDetail) return null;
  const m = shortDetail.match(/^(\d+)(?:\+(\d+))?'/);
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
}

function parseMinuteFromClock(clock: number, period: number): number | null {
  if (period === 0) return null;
  const halfDur = period <= 2 ? 2700 : 900;
  const elapsed  = Math.floor((halfDur - clock) / 60);
  const base     = period === 2 ? 45 : period === 3 ? 90 : period === 4 ? 105 : 0;
  const cap      = base + (period <= 2 ? 45 : 15);
  return Math.max(base, Math.min(base + elapsed, cap));
}

function espnEventMinute(
  clock: { value: number; displayValue?: string } | undefined,
  evPeriod: number,
): string {
  if (clock?.displayValue) return clock.displayValue.replace(/:\d+$/, "'");
  if (clock?.value != null) {
    const base = evPeriod === 2 ? 45 : evPeriod === 3 ? 90 : evPeriod === 4 ? 105 : 0;
    return `${base + Math.floor(clock.value / 60)}'`;
  }
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEspnDetail(d: any, homeTeamId: string): LiveEvent | null {
  const typeText: string     = (d.type?.text ?? '').toLowerCase();
  const athleteName: string  = d.athletesInvolved?.[0]?.displayName ?? '';
  const clock = d.clock as { value: number; displayValue?: string } | undefined;
  const period: number = d.period?.number ?? 0;

  let eventType: LiveEventType;
  if      (/own\s*goal/.test(typeText))                     eventType = 'own_goal';
  else if (/penalty\s+goal|penalty/.test(typeText))         eventType = 'penalty';
  else if (/goal/.test(typeText))                           eventType = 'goal';
  else if (/yellow[-\s]red|second\s+yellow/.test(typeText)) eventType = 'yellow_red';
  else if (/red\s*card/.test(typeText))                     eventType = 'red_card';
  else if (/yellow\s*card/.test(typeText))                  eventType = 'yellow_card';
  else return null;

  const teamId: string = d.team?.id ?? '';
  const side: 'home' | 'away' | null = teamId
    ? (teamId === homeTeamId ? 'home' : 'away')
    : null;

  return { type: eventType, minute: espnEventMinute(clock, period), playerName: athleteName, side };
}

async function fetchEspnMatches(): Promise<LiveMatch[]> {
  const res = await fetch(ESPN_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Oloraculo/1.0)' },
  });
  if (res.status === 429) throw new Error('rate-limit');
  if (!res.ok) throw new Error(`espn-${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = body.events ?? [];

  return events.map((ev) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp: any = ev.competitions?.[0] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status: any = ev.status ?? {};
    const period: number = status.period ?? 0;
    const clock: number  = status.clock  ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shortDetail: string | undefined = (status.type as any)?.shortDetail;
    const espnName: string = status.type?.name ?? '';
    const liveStatus = mapEspnStatus(espnName, period);

    console.log(`[espn] id=${ev.id} status=${espnName} period=${period} clock=${clock} shortDetail=${shortDetail ?? 'n/a'}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const competitors: any[] = comp.competitors ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const home: any = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const away: any = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1] ?? {};
    const homeTeamEspnId: string = home.team?.id ?? '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details: any[] = comp.details ?? [];
    const liveEvents = details
      .map((d) => parseEspnDetail(d, homeTeamEspnId))
      .filter((e): e is LiveEvent => e !== null);

    return {
      fdId:           parseInt(ev.id, 10),
      status:         liveStatus,
      minute:         liveStatus === 'IN_PLAY'
        ? (parseMinuteFromShortDetail(shortDetail) ?? parseMinuteFromClock(clock, period))
        : null,
      homeTeamFdName: home.team?.displayName ?? home.team?.name ?? '',
      awayTeamFdName: away.team?.displayName ?? away.team?.name ?? '',
      homeGoals:      home.score != null ? parseInt(home.score, 10) : null,
      awayGoals:      away.score != null ? parseInt(away.score, 10) : null,
      utcDate:        ev.date ?? '',
      homeLocalId:    homeTeamEspnId || null,
      awayLocalId:    away.team?.id  || null,
      events:         liveEvents,
      source:         'espn' as const,
    } satisfies LiveMatch;
  });
}

// ---------------------------------------------------------------------------
// ─── football-data.org ──────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
function mapFdStatus(s: string): LiveStatus {
  switch (s) {
    case 'IN_PLAY':   return 'IN_PLAY';
    case 'PAUSED':    return 'PAUSED';
    case 'FINISHED':  return 'FINISHED';
    case 'POSTPONED': return 'POSTPONED';
    case 'CANCELLED': return 'CANCELLED';
    case 'SUSPENDED': return 'SUSPENDED';
    case 'AWARDED':   return 'AWARDED';
    case 'TIMED':     return 'TIMED';
    default:          return 'SCHEDULED';
  }
}

function mapFdGoalType(t: string): LiveEventType {
  if (t === 'PENALTY')  return 'penalty';
  if (t === 'OWN_GOAL') return 'own_goal';
  return 'goal';
}

interface FdGoal {
  minute:      number;
  injuryTime?: number | null;
  type:        string;
  team:        { id: number; name: string };
  scorer:      { id: number; name: string };
}

interface FdRawMatch {
  id:       number;
  utcDate:  string;
  status:   string;
  minute?:  number | null;
  homeTeam: { id: number; name: string; shortName: string };
  awayTeam: { id: number; name: string; shortName: string };
  score: {
    fullTime: { home: number | null; away: number | null };
  };
  goals?: FdGoal[];
}

async function fetchFdMatches(): Promise<LiveMatch[]> {
  if (!FD_KEY) {
    console.warn('[fd] FD_API_KEY secret not set — skipping football-data.org fallback');
    return [];
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(
      `${FD_BASE}/competitions/WC/matches?dateFrom=${today}&dateTo=${today}`,
      { headers: { 'X-Auth-Token': FD_KEY } },
    );
    if (!r.ok) {
      console.warn(`[fd] HTTP ${r.status}`);
      return [];
    }
    const data = await r.json();
    const raw: FdRawMatch[] = data.matches ?? [];

    return raw.map((m) => {
      const status = mapFdStatus(m.status);
      const goals  = m.goals ?? [];

      const events: LiveEvent[] = goals.map((g) => {
        const min = g.injuryTime ? `${g.minute}+${g.injuryTime}'` : `${g.minute}'`;
        const isHome = g.team.id === m.homeTeam.id;
        return {
          type:       mapFdGoalType(g.type),
          minute:     min,
          playerName: g.scorer?.name ?? '',
          side:       isHome ? 'home' : 'away',
        };
      });

      console.log(`[fd] id=${m.id} status=${m.status} home=${m.homeTeam.name} away=${m.awayTeam.name} goals=${goals.length}`);

      return {
        fdId:           m.id,
        status,
        minute:         status === 'IN_PLAY' ? (m.minute ?? null) : null,
        homeTeamFdName: m.homeTeam.name,
        awayTeamFdName: m.awayTeam.name,
        homeGoals:      m.score.fullTime.home,
        awayGoals:      m.score.fullTime.away,
        utcDate:        m.utcDate,
        homeLocalId:    null, // resolved client-side by name via resolveLocalId()
        awayLocalId:    null,
        events,
        source:         'fd' as const,
      } satisfies LiveMatch;
    });
  } catch (e) {
    console.warn('[fd] fetch error:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Merge ESPN (primary) + FD (fallback for missing matches).
// A match is "covered by ESPN" if the home+away names match case-insensitively.
// FD matches whose status is SCHEDULED or FINISHED are excluded from fallback.
// ---------------------------------------------------------------------------
function mergeMatches(espn: LiveMatch[], fd: LiveMatch[]): LiveMatch[] {
  const espnNames = new Set(
    espn.map(m => `${m.homeTeamFdName.toLowerCase()}:${m.awayTeamFdName.toLowerCase()}`),
  );

  const fdFallback = fd.filter(m => {
    const key = `${m.homeTeamFdName.toLowerCase()}:${m.awayTeamFdName.toLowerCase()}`;
    if (espnNames.has(key)) return false; // already have ESPN data
    // Only include if live or paused (not scheduled/finished)
    return m.status === 'IN_PLAY' || m.status === 'PAUSED';
  });

  return [...espn, ...fdFallback];
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    // Fetch both sources concurrently; FD failure never breaks ESPN response.
    const [espnMatches, fdMatches] = await Promise.all([
      fetchEspnMatches(),
      fetchFdMatches(),
    ]);

    const merged = mergeMatches(espnMatches, fdMatches);

    return new Response(JSON.stringify(merged), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'internal';
    if (msg === 'rate-limit') {
      return new Response(JSON.stringify({ error: 'rate-limit' }), {
        status: 429,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    console.error('[live-scores] unexpected error:', err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
