// =============================================================================
// Oloráculo — live-scores Edge Function  (v7)
// Primary source:  ESPN unofficial scoreboard (geo-blocked → proxied here)
// Fallback source: SofaScore unofficial API (no key, server-side only)
//   SofaScore fills gaps when ESPN hasn't reported a match yet.
//   It provides: score, match minute, goals (scorer + minute) AND cards.
// =============================================================================

const ESPN_URL  = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SOFA_BASE = 'https://api.sofascore.com/api/v1';

// SofaScore requires browser-like headers to avoid 403
const SOFA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer':    'https://www.sofascore.com/',
  'Accept':     'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

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
  source:          'espn' | 'sofascore';
}

// ---------------------------------------------------------------------------
// ─── ESPN ───────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
function mapEspnStatus(name: string, period: number): LiveStatus {
  switch (name) {
    case 'STATUS_SCHEDULED':
    case 'STATUS_PREGAME':      return 'SCHEDULED';
    case 'STATUS_RAIN_DELAY':   return 'SUSPENDED';
    case 'STATUS_DELAYED':      return 'POSTPONED';
    case 'STATUS_CANCELED':
    case 'STATUS_ABANDONED':    return 'CANCELLED';
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_FIRST_HALF':
    case 'STATUS_SECOND_HALF':
    case 'STATUS_EXTRA_TIME':
    case 'STATUS_ET_FIRST_HALF':
    case 'STATUS_ET_SECOND_HALF':
    case 'STATUS_SHOOTOUT':     return 'IN_PLAY';
    case 'STATUS_HALFTIME':
    case 'STATUS_BREAK':
    case 'STATUS_ET_BREAK':     return 'PAUSED';
    case 'STATUS_FINAL':
    case 'STATUS_FULL_TIME':
    case 'STATUS_FINAL_AET':
    case 'STATUS_FINAL_PEN':
    case 'STATUS_POST_GAME':    return 'FINISHED';
    default: return period > 0 ? 'IN_PLAY' : 'SCHEDULED';
  }
}

function parseMinuteFromShortDetail(sd: string | undefined): number | null {
  if (!sd) return null;
  const m = sd.match(/^(\d+)(?:\+(\d+))?'/);
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
  const typeText: string    = (d.type?.text ?? '').toLowerCase();
  const playerName: string  = d.athletesInvolved?.[0]?.displayName ?? '';
  const clock = d.clock as { value: number; displayValue?: string } | undefined;
  const period: number = d.period?.number ?? 0;

  let type: LiveEventType;
  if      (/own\s*goal/.test(typeText))                     type = 'own_goal';
  else if (/penalty\s+goal|penalty/.test(typeText))         type = 'penalty';
  else if (/goal/.test(typeText))                           type = 'goal';
  else if (/yellow[-\s]red|second\s+yellow/.test(typeText)) type = 'yellow_red';
  else if (/red\s*card/.test(typeText))                     type = 'red_card';
  else if (/yellow\s*card/.test(typeText))                  type = 'yellow_card';
  else return null;

  const teamId: string = d.team?.id ?? '';
  const side: 'home' | 'away' | null = teamId ? (teamId === homeTeamId ? 'home' : 'away') : null;

  return { type, minute: espnEventMinute(clock, period), playerName, side };
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
    const comp: any   = ev.competitions?.[0] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status: any = ev.status ?? {};
    const period: number = status.period ?? 0;
    const clock: number  = status.clock  ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shortDetail: string | undefined = (status.type as any)?.shortDetail;
    const liveStatus = mapEspnStatus(status.type?.name ?? '', period);

    console.log(`[espn] id=${ev.id} status=${status.type?.name} period=${period} clock=${clock} sd=${shortDetail ?? 'n/a'}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const competitors: any[] = comp.competitors ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const home: any = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const away: any = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1] ?? {};
    const homeId: string = home.team?.id ?? '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveEvents = (comp.details ?? [] as any[])
      .map((d: any) => parseEspnDetail(d, homeId))
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
      homeLocalId:    homeId || null,
      awayLocalId:    away.team?.id || null,
      events:         liveEvents,
      source:         'espn' as const,
    } satisfies LiveMatch;
  });
}

// ---------------------------------------------------------------------------
// ─── SofaScore ──────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
function mapSofaStatus(type: string, desc: string): LiveStatus {
  const d = desc.toLowerCase();
  if (d.includes('halftime') || d.includes('half time') || type === 'halftime') return 'PAUSED';
  switch (type) {
    case 'inprogress': return 'IN_PLAY';
    case 'finished':   return 'FINISHED';
    case 'postponed':  return 'POSTPONED';
    case 'cancelled':  return 'CANCELLED';
    case 'suspended':  return 'SUSPENDED';
    default:           return 'SCHEDULED';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sofaMinute(ev: any): number | null {
  if ((ev.status?.type ?? '') !== 'inprogress') return null;
  const periodStart: number | undefined = ev.time?.currentPeriodStart;
  if (!periodStart) return null;

  const elapsed = Math.max(0, Math.floor((Date.now() / 1000 - periodStart) / 60));
  const desc    = (ev.status?.description ?? '').toLowerCase();
  const base    = desc.includes('2nd extra') || desc.includes('et2') ? 105
                : desc.includes('extra')  || desc.includes('overtime') ? 90
                : desc.includes('2nd')   || desc.includes('second') ? 45
                : 0;
  const cap = base + (base >= 90 ? 15 : 45);
  return Math.min(base + elapsed, cap);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sofaIncidentToEvent(inc: any): LiveEvent | null {
  const iType: string  = (inc.incidentType ?? '').toLowerCase();
  const iClass: string = (inc.incidentClass ?? '').toLowerCase();
  const isHome: boolean = inc.isHome ?? true;
  const playerName: string = inc.player?.name ?? inc.playerName ?? '';
  const addedTime: number | null = inc.addedTime ?? null;
  const minute = `${inc.time ?? '?'}${addedTime ? '+' + addedTime : ''}'`;

  let type: LiveEventType;
  if (iType === 'goal') {
    if (iClass === 'owngoal' || iClass === 'own_goal' || iClass === 'ownGoal') type = 'own_goal';
    else if (iClass === 'penalty')                                              type = 'penalty';
    else                                                                        type = 'goal';
  } else if (iType === 'card') {
    if (iClass === 'yellow')                                                    type = 'yellow_card';
    else if (iClass === 'red')                                                  type = 'red_card';
    else if (iClass === 'yellowred' || iClass === 'yellow_red')                 type = 'yellow_red';
    else return null;
  } else {
    return null; // substitution, period markers, etc.
  }

  return { type, minute, playerName, side: isHome ? 'home' : 'away' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSofaIncidents(eventId: number): Promise<any[]> {
  try {
    const r = await fetch(`${SOFA_BASE}/event/${eventId}/incidents`, { headers: SOFA_HEADERS });
    if (!r.ok) return [];
    const data = await r.json();
    return data.incidents ?? [];
  } catch {
    return [];
  }
}

async function fetchSofaMatches(): Promise<LiveMatch[]> {
  try {
    // Get all live football events from SofaScore
    const r = await fetch(`${SOFA_BASE}/sport/football/events/live`, { headers: SOFA_HEADERS });
    if (!r.ok) {
      console.warn(`[sofa] live events HTTP ${r.status}`);
      return [];
    }
    const data = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = data.events ?? [];

    // Filter for FIFA World Cup matches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wcEvents = events.filter((ev: any) => {
      const tName = (
        ev.tournament?.uniqueTournament?.name ??
        ev.tournament?.name ??
        ev.season?.name ?? ''
      ).toLowerCase();
      return tName.includes('world cup') || tName.includes('mundial') || tName.includes('fifa wc');
    });

    if (wcEvents.length === 0) return [];

    // Fetch incidents for each WC match concurrently
    const results = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wcEvents.map(async (ev: any) => {
        const incidents = await fetchSofaIncidents(ev.id);
        const status = mapSofaStatus(ev.status?.type ?? '', ev.status?.description ?? '');
        const events: LiveEvent[] = incidents
          .map(sofaIncidentToEvent)
          .filter((e): e is LiveEvent => e !== null);

        console.log(`[sofa] id=${ev.id} home=${ev.homeTeam?.name} away=${ev.awayTeam?.name} status=${ev.status?.type} events=${events.length}`);

        return {
          fdId:           ev.id,
          status,
          minute:         sofaMinute(ev),
          homeTeamFdName: ev.homeTeam?.name ?? '',
          awayTeamFdName: ev.awayTeam?.name ?? '',
          homeGoals:      ev.homeScore?.current ?? null,
          awayGoals:      ev.awayScore?.current ?? null,
          utcDate:        ev.startTimestamp
            ? new Date(ev.startTimestamp * 1000).toISOString()
            : '',
          homeLocalId:    null, // resolved client-side by name via resolveLocalId()
          awayLocalId:    null,
          events,
          source:         'sofascore' as const,
        } satisfies LiveMatch;
      }),
    );

    return results;
  } catch (e) {
    console.warn('[sofa] fetch error:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Merge ESPN (primary) + SofaScore (fallback for matches ESPN doesn't cover).
// Dedup by lowercased home:away name pair. SofaScore SCHEDULED/FINISHED excluded.
// ---------------------------------------------------------------------------
function mergeMatches(espn: LiveMatch[], sofa: LiveMatch[]): LiveMatch[] {
  const espnNames = new Set(
    espn.map(m => `${m.homeTeamFdName.toLowerCase()}:${m.awayTeamFdName.toLowerCase()}`),
  );
  const sofaFallback = sofa.filter(m => {
    const key = `${m.homeTeamFdName.toLowerCase()}:${m.awayTeamFdName.toLowerCase()}`;
    return !espnNames.has(key) && (m.status === 'IN_PLAY' || m.status === 'PAUSED');
  });
  return [...espn, ...sofaFallback];
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    // Fetch both sources concurrently; SofaScore failure never breaks ESPN.
    const [espnMatches, sofaMatches] = await Promise.all([
      fetchEspnMatches(),
      fetchSofaMatches(),
    ]);

    const merged = mergeMatches(espnMatches, sofaMatches);

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
