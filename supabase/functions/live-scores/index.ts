// =============================================================================
// Oloráculo — live-scores Edge Function  (v4)
// Proxies the ESPN unofficial scoreboard API so the client never exposes keys
// and avoids geo-blocks (ESPN blocks non-US IPs).
//
// ESPN quirks:
//   • status.clock counts DOWN (seconds remaining in period), not up.
//   • status.period: 1 = first half, 2 = second half, 3 = ET1, 4 = ET2.
//   • competitions[0].details[] holds goals, cards, etc.
//   • detail.clock.displayValue is already human-readable ("22:00" → trim to "22'").
// =============================================================================

const ESPN_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Status mapping — ESPN status.type.name → our LiveStatus
// ---------------------------------------------------------------------------
type LiveStatus =
  | 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED'
  | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED' | 'TIMED';

function mapStatus(espnName: string, period: number): LiveStatus {
  switch (espnName) {
    // Pre-match
    case 'STATUS_SCHEDULED':
    case 'STATUS_PREGAME':
      return 'SCHEDULED';
    case 'STATUS_RAIN_DELAY':
      return 'SUSPENDED';
    case 'STATUS_DELAYED':
      return 'POSTPONED';
    case 'STATUS_CANCELED':
    case 'STATUS_ABANDONED':
      return 'CANCELLED';

    // In progress
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_FIRST_HALF':
    case 'STATUS_SECOND_HALF':
    case 'STATUS_EXTRA_TIME':
    case 'STATUS_ET_FIRST_HALF':
    case 'STATUS_ET_SECOND_HALF':
    case 'STATUS_SHOOTOUT':
      return 'IN_PLAY';
    case 'STATUS_HALFTIME':
    case 'STATUS_BREAK':
    case 'STATUS_ET_BREAK':
      return 'PAUSED';

    // Final
    case 'STATUS_FINAL':
    case 'STATUS_FULL_TIME':
    case 'STATUS_FINAL_AET':
    case 'STATUS_FINAL_PEN':
    case 'STATUS_POST_GAME':
      return 'FINISHED';

    default:
      // If ESPN gives us an unknown status but the match has started (period > 0),
      // treat it as in-play rather than silently hiding it.
      return period > 0 ? 'IN_PLAY' : 'SCHEDULED';
  }
}

// ---------------------------------------------------------------------------
// Minute calculation.
//
// Primary: parse ESPN's own `status.type.shortDetail` which already contains
// the display minute ("72'", "45+2'", "HT", "FT", etc.).
// This is the most reliable source — ESPN computes it for us.
//
// Fallback: compute from `status.clock` (seconds remaining, counts DOWN)
// and `status.period`. Used when shortDetail is absent or unparseable.
// ---------------------------------------------------------------------------
function parseMinuteFromShortDetail(shortDetail: string | undefined): number | null {
  if (!shortDetail) return null;
  // "72'" → 72 | "45+2'" → 47 | "HT" / "FT" / anything else → null
  const m = shortDetail.match(/^(\d+)(?:\+(\d+))?'/);
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
}

function parseMinuteFromClock(clock: number, period: number): number | null {
  if (period === 0) return null;
  // ESPN clock counts DOWN (seconds remaining in the period).
  const halfDur = period <= 2 ? 2700 : 900;
  const elapsed  = Math.floor((halfDur - clock) / 60);
  const base     = period === 2 ? 45 : period === 3 ? 90 : period === 4 ? 105 : 0;
  const cap      = base + (period <= 2 ? 45 : 15);
  return Math.max(base, Math.min(base + elapsed, cap));
}

// ---------------------------------------------------------------------------
// Event minute — prefer the human-readable displayValue ESPN already provides.
// ---------------------------------------------------------------------------
function eventMinute(
  clock: { value: number; displayValue?: string } | undefined,
  evPeriod: number,
): string {
  if (clock?.displayValue) {
    // Trim seconds part: "22:00" → "22'"
    return clock.displayValue.replace(/:\d+$/, "'");
  }
  if (clock?.value != null) {
    const base = evPeriod === 2 ? 45 : evPeriod === 3 ? 90 : evPeriod === 4 ? 105 : 0;
    return `${base + Math.floor(clock.value / 60)}'`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
}

// ---------------------------------------------------------------------------
// ESPN detail → LiveEvent
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDetail(d: any, homeTeamId: string): LiveEvent | null {
  const typeText: string = (d.type?.text ?? '').toLowerCase();
  const athleteName: string = d.athletesInvolved?.[0]?.displayName ?? '';
  const clock = d.clock as { value: number; displayValue?: string } | undefined;
  const period: number = d.period?.number ?? 0;

  let eventType: LiveEventType;
  if      (/own\s*goal/.test(typeText))             eventType = 'own_goal';
  else if (/penalty\s+goal|penalty/.test(typeText)) eventType = 'penalty';
  else if (/goal/.test(typeText))                   eventType = 'goal';
  else if (/yellow[-\s]red|second\s+yellow/.test(typeText)) eventType = 'yellow_red';
  else if (/red\s*card/.test(typeText))             eventType = 'red_card';
  else if (/yellow\s*card/.test(typeText))          eventType = 'yellow_card';
  else return null;

  // Determine which side scored/committed the event
  const teamId: string = d.team?.id ?? '';
  const side: 'home' | 'away' | null = teamId
    ? (teamId === homeTeamId ? 'home' : 'away')
    : null;

  return {
    type:       eventType,
    minute:     eventMinute(clock, period),
    playerName: athleteName,
    side,
  };
}

// ---------------------------------------------------------------------------
// Team-ID → local slug lookup built from ESPN competitor shortDisplayName.
// We can't reliably map ESPN team IDs to our local slugs without a lookup
// table — instead we pass through the ESPN team IDs and rely on the client's
// team data to reconcile them. The `homeLocalId`/`awayLocalId` fields hold
// the ESPN competitor IDs so the client can match against its own map.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const res = await fetch(ESPN_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Oloraculo/1.0)' },
    });

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: 'rate-limit' }), {
        status: 429,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `espn-${res.status}` }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = body.events ?? [];

    const matches: LiveMatch[] = events.map((ev) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comp: any   = ev.competitions?.[0] ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status: any = ev.status ?? {};
      const period: number = status.period ?? 0;
      const clock: number  = status.clock  ?? 0;

      const espnStatusName: string  = status.type?.name ?? '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shortDetail: string | undefined = (status.type as any)?.shortDetail;
      const liveStatus = mapStatus(espnStatusName, period);

      // Debug: log raw status fields so we can verify ESPN clock direction
      console.log(`[live-scores] id=${ev.id} status=${espnStatusName} period=${period} clock=${clock} shortDetail=${shortDetail ?? 'n/a'}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const competitors: any[] = comp.competitors ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const home: any = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0] ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const away: any = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1] ?? {};

      const homeTeamEspnId: string = home.team?.id ?? '';

      // Parse match events (goals, cards)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details: any[] = comp.details ?? [];
      const liveEvents: LiveEvent[] = details
        .map((d) => parseDetail(d, homeTeamEspnId))
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
      } satisfies LiveMatch;
    });

    return new Response(JSON.stringify(matches), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[live-scores] unexpected error:', err);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
