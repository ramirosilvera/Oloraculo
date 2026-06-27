// =============================================================================
// Oloráculo — update-goal-scorers Edge Function
// Invoked daily by the .github/workflows/update-goal-scorers.yml GitHub Action.
// For every PLAYED fixture (group stage AND knockout), syncs goal scorer data
// to match_goals.
//
// Knockout fixtures (ko:*) are not in wc_fixtures, so their resolved teams +
// kickoff date are passed in the request body as `koFixtures` (the caller reads
// migration/public/data/knockout-fixtures.json — the bracket source of truth).
//
// Source priority (per fixture): ESPN → SofaScore → Serper. A source is only
// considered "enough" when its goal count reaches the KNOWN total
// (home_goals + away_goals); otherwise the next source is tried and the most
// complete result across all sources wins. Writes are monotonic per fixture:
// a run never reduces a fixture's existing coverage.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SOFA_BASE = 'https://api.sofascore.com/api/v1';

const SOFA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer':    'https://www.sofascore.com/',
  'Accept':     'application/json, text/plain, */*',
};

// ----------------------------------------------------------------------------
// Team name lookup (fixture ID slug → search name)
// ----------------------------------------------------------------------------
const TEAM_NAMES: Record<string, string> = {
  'mexico': 'Mexico', 'south-africa': 'South Africa', 'south-korea': 'South Korea',
  'czechia': 'Czech Republic', 'canada': 'Canada', 'qatar': 'Qatar',
  'switzerland': 'Switzerland', 'bosnia-and-herzegovina': 'Bosnia',
  'brazil': 'Brazil', 'morocco': 'Morocco', 'haiti': 'Haiti', 'scotland': 'Scotland',
  'united-states': 'USA', 'paraguay': 'Paraguay', 'australia': 'Australia',
  'turkey': 'Turkey', 'germany': 'Germany', 'curacao': 'Curacao',
  'netherlands': 'Netherlands', 'nigeria': 'Nigeria', 'spain': 'Spain',
  'ivory-coast': 'Ivory Coast', 'france': 'France', 'belgium': 'Belgium',
  'argentina': 'Argentina', 'jordan': 'Jordan', 'portugal': 'Portugal',
  'colombia': 'Colombia', 'england': 'England', 'panama': 'Panama',
  'japan': 'Japan', 'senegal': 'Senegal', 'norway': 'Norway', 'algeria': 'Algeria',
  'egypt': 'Egypt', 'new-zealand': 'New Zealand', 'uruguay': 'Uruguay',
  'cape-verde': 'Cape Verde', 'saudi-arabia': 'Saudi Arabia', 'ecuador': 'Ecuador',
  'tunisia': 'Tunisia', 'croatia': 'Croatia', 'iran': 'Iran', 'venezuela': 'Venezuela',
  'sweden': 'Sweden', 'ghana': 'Ghana', 'congo-dr': 'DR Congo',
  'iraq': 'Iraq', 'uzbekistan': 'Uzbekistan',
  'austria': 'Austria', 'chile': 'Chile', 'peru': 'Peru', 'costa-rica': 'Costa Rica',
};

// Feed-specific name variants that plain substring matching would miss.
const TEAM_ALIASES: Record<string, string[]> = {
  'turkey':       ['turkiye'],
  'ivory-coast':  ['cote divoire', 'cote d ivoire'],
  'czechia':      ['czech republic'],
  'congo-dr':     ['congo dr', 'democratic republic congo'],
  'cape-verde':   ['cabo verde'],
  'south-korea':  ['korea republic', 'korea south'],
  'united-states':['usa', 'united states of america'],
};

// Generic tokens that collide across teams (south-korea/south-africa,
// new-zealand/new-caledonia, …). Dropped so matching relies on the
// discriminating token (korea, africa, zealand, …).
const GENERIC = new Set([
  'south', 'north', 'new', 'united', 'republic', 'democratic',
  'and', 'the', 'of', 'costa', 'saudi',
]);

// Accent/case fold: "Türkiye" → "turkiye", "Curaçao" → "curacao".
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function teamName(id: string): string {
  return TEAM_NAMES[id] ?? id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Discriminating, accent-folded match tokens for a team id.
function teamWords(id: string): string[] {
  const display = TEAM_NAMES[id] ?? id.replace(/-/g, ' ');
  const parts = [id.replace(/-/g, ' '), display, ...(TEAM_ALIASES[id] ?? [])].join(' ');
  return [...new Set(fold(parts).split(/\s+/))].filter(w => w.length > 2 && !GENERIC.has(w));
}

// Shift a YYYYMMDD date string by `delta` days (UTC).
function shiftDate(d: string, delta: number): string {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + delta));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
interface GoalEntry {
  fixture_id:  string;
  team_id:     string;
  player_name: string;
  minute:      number | null;
  goal_type:   'normal' | 'penalty' | 'own_goal';
}

interface SerperGoal { player?: string; team?: string; minute?: string | number; type?: string; }
interface SerperGame { homeTeam?: { name?: string }; awayTeam?: { name?: string }; goals?: SerperGoal[]; }
interface SerperResponse {
  sportsResults?: { games?: SerperGame[] };
  answerBox?: { snippet?: string; answer?: string };
  organic?: Array<{ snippet?: string }>;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function detectGoalType(raw: string): 'normal' | 'penalty' | 'own_goal' {
  const s = raw.toLowerCase();
  if (/pen(al(ty)?)?|p\.k\.|penal|\(p\)/.test(s))  return 'penalty';
  if (/own.?goal|og\b|autogol|\(ag\)|\(og\)/.test(s)) return 'own_goal';
  return 'normal';
}

function parseMinute(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Order-agnostic attribution: pick our team id whose words match a folded name.
function attributeTeam(name: string, homeId: string, homeWords: string[], awayId: string, awayWords: string[]): string {
  const n = fold(name);
  if (homeWords.some(w => n.includes(w))) return homeId;
  if (awayWords.some(w => n.includes(w))) return awayId;
  return homeId; // last-resort fallback
}

// ----------------------------------------------------------------------------
// SOURCE 1 — ESPN scoreboard (per date, ±1 day to absorb UTC boundary skew)
// ----------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEspnGoals(
  comp: any, fixtureId: string, homeId: string, awayId: string, homeWords: string[], awayWords: string[],
): GoalEntry[] {
  // Map ESPN competitor id → folded display name, so we attribute by NAME
  // (robust to home/away order differing from our fixture_id).
  const espnName = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (comp.competitors ?? [])) espnName.set(c.team?.id ?? '', fold(c.team?.displayName ?? c.team?.name ?? ''));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const details: any[] = comp.details ?? [];

  return details.flatMap((d: any): GoalEntry[] => {
    const typeText: string = (d.type?.text ?? '').toLowerCase();
    let goal_type: 'normal' | 'penalty' | 'own_goal';
    if      (/own\s*goal/.test(typeText))           goal_type = 'own_goal';
    else if (/penalty/.test(typeText))              goal_type = 'penalty';
    else if (/goal/.test(typeText))                 goal_type = 'normal';
    else return [];

    const player_name: string = d.athletesInvolved?.[0]?.displayName ?? '';
    if (!player_name) return [];

    const clockDisplay: string | undefined = d.clock?.displayValue;
    const period: number = d.period?.number ?? 0;
    let minuteStr = clockDisplay?.replace(/:\d+$/, "'") ?? '';
    if (!minuteStr && d.clock?.value != null) {
      const base = period === 2 ? 45 : period === 3 ? 90 : period === 4 ? 105 : 0;
      minuteStr = `${base + Math.floor(d.clock.value / 60)}'`;
    }

    const espnTeamId: string = d.team?.id ?? '';
    // Own goals count for the OTHER team; ESPN already attributes the event team.
    const team_id = attributeTeam(espnName.get(espnTeamId) ?? '', homeId, homeWords, awayId, awayWords);

    return [{ fixture_id: fixtureId, team_id, player_name, minute: parseMinute(minuteStr), goal_type }];
  });
}

async function fetchGoalsFromESPN(
  fixturesByDate: Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>,
): Promise<Map<string, GoalEntry[]>> {
  const result = new Map<string, GoalEntry[]>();

  for (const [date, fixtures] of fixturesByDate) {
    try {
      // ±1 day range to catch matches ESPN files under a neighbouring UTC date.
      const range = `${shiftDate(date, -1)}-${shiftDate(date, 1)}`;
      const res = await fetch(`${ESPN_BASE}?dates=${range}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Oloraculo/1.0)' },
      });
      if (!res.ok) { console.warn(`[espn] HTTP ${res.status} for ${range}`); continue; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = body.events ?? [];

      for (const { fixtureId, homeId, awayId } of fixtures) {
        const homeWords = teamWords(homeId);
        const awayWords = teamWords(awayId);

        // Order-agnostic: home matches one competitor, away the other.
        const ev = events.find(e => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comps: any[] = e.competitions?.[0]?.competitors ?? [];
          if (comps.length < 2) return false;
          const n0 = fold(comps[0]?.team?.displayName ?? comps[0]?.team?.name ?? '');
          const n1 = fold(comps[1]?.team?.displayName ?? comps[1]?.team?.name ?? '');
          const h0 = homeWords.some(w => n0.includes(w)), h1 = homeWords.some(w => n1.includes(w));
          const a0 = awayWords.some(w => n0.includes(w)), a1 = awayWords.some(w => n1.includes(w));
          return (h0 && a1) || (h1 && a0);
        });

        if (!ev) { console.log(`[espn] no match for ${fixtureId} in ${range}`); continue; }

        const stType = ev.status?.type ?? {};
        const done = stType.completed === true || /FINAL|FULL_TIME|POST/.test(stType.name ?? '');
        if (!done) { console.log(`[espn] ${fixtureId} not finished (${stType.name})`); continue; }

        const comp = ev.competitions?.[0] ?? {};
        const goals = parseEspnGoals(comp, fixtureId, homeId, awayId, homeWords, awayWords);
        console.log(`[espn] ${fixtureId}: ${goals.length} goals`);
        if (goals.length > 0) result.set(fixtureId, goals);
      }
    } catch (e) {
      console.error(`[espn] error for date ${date}:`, e);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return result;
}

// ----------------------------------------------------------------------------
// SOURCE 2 — SofaScore (incidents by event search)
// ----------------------------------------------------------------------------

async function fetchGoalsFromSofa(
  fixturesByDate: Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>,
): Promise<Map<string, GoalEntry[]>> {
  const result = new Map<string, GoalEntry[]>();

  for (const [date, fixtures] of fixturesByDate) {
    const sofaDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    try {
      const res = await fetch(`${SOFA_BASE}/sport/football/scheduled-events/${sofaDate}`, { headers: SOFA_HEADERS });
      if (!res.ok) { console.warn(`[sofa] HTTP ${res.status} for date ${sofaDate}`); continue; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = data.events ?? [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wcEvents = events.filter((ev: any) => {
        const tName = (
          ev.tournament?.uniqueTournament?.name ??
          ev.tournament?.name ??
          ev.season?.name ?? ''
        ).toLowerCase();
        return tName.includes('world cup') || tName.includes('mundial');
      });

      for (const { fixtureId, homeId, awayId } of fixtures) {
        const homeWords = teamWords(homeId);
        const awayWords = teamWords(awayId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ev = wcEvents.find((e: any) => {
          const hn = fold(e.homeTeam?.name ?? ''), an = fold(e.awayTeam?.name ?? '');
          const hH = homeWords.some(w => hn.includes(w)), hA = homeWords.some(w => an.includes(w));
          const aH = awayWords.some(w => hn.includes(w)), aA = awayWords.some(w => an.includes(w));
          return (hH && aA) || (hA && aH);
        });

        if (!ev) { console.log(`[sofa] no match for ${fixtureId} on ${sofaDate}`); continue; }
        if (ev.status?.type !== 'finished') { console.log(`[sofa] ${fixtureId} not finished`); continue; }

        // Does Sofa's "home" correspond to OUR homeId? Used to map inc.isHome.
        const sofaHomeIsOurHome = homeWords.some(w => fold(ev.homeTeam?.name ?? '').includes(w));

        try {
          const incRes = await fetch(`${SOFA_BASE}/event/${ev.id}/incidents`, { headers: SOFA_HEADERS });
          if (!incRes.ok) continue;
          const incData = await incRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const incidents: any[] = incData.incidents ?? [];

          const goals: GoalEntry[] = incidents.flatMap((inc: any): GoalEntry[] => {
            const iType  = (inc.incidentType ?? '').toLowerCase();
            const iClass = (inc.incidentClass ?? '').toLowerCase();
            if (iType !== 'goal') return [];

            let goal_type: 'normal' | 'penalty' | 'own_goal';
            if      (iClass === 'owngoal' || iClass === 'own_goal' || iClass === 'owngoal') goal_type = 'own_goal';
            else if (iClass === 'penalty')                                                  goal_type = 'penalty';
            else                                                                            goal_type = 'normal';

            const player_name: string = inc.player?.name ?? inc.playerName ?? '';
            if (!player_name) return [];

            const addedTime: number | null = inc.addedTime ?? null;
            const minuteStr = `${inc.time ?? '?'}${addedTime ? '+' + addedTime : ''}'`;
            const incIsHome = inc.isHome ?? true;
            // Map Sofa's home/away to our ids accounting for venue order.
            const team_id = incIsHome === sofaHomeIsOurHome ? homeId : awayId;

            return [{ fixture_id: fixtureId, team_id, player_name, minute: parseMinute(minuteStr), goal_type }];
          });

          console.log(`[sofa] ${fixtureId}: ${goals.length} goals`);
          if (goals.length > 0) result.set(fixtureId, goals);
        } catch (e) {
          console.error(`[sofa] incidents error for ${fixtureId}:`, e);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.error(`[sofa] error for date ${sofaDate}:`, e);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return result;
}

// ----------------------------------------------------------------------------
// SOURCE 3 — Serper (Google search fallback)
// ----------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStructuredGoals(
  goals: SerperGoal[], fixtureId: string, homeId: string, awayId: string, homeWords: string[], awayWords: string[],
): GoalEntry[] {
  return goals.flatMap(g => {
    const raw = g.player ?? '';
    if (!raw.trim()) return [];
    const min = typeof g.minute === 'number' ? g.minute
              : typeof g.minute === 'string' ? parseInt(g.minute, 10) || null : null;
    const goal_type = g.type ? detectGoalType(g.type) : 'normal';
    const team_id = attributeTeam(g.team ?? '', homeId, homeWords, awayId, awayWords);
    return [{ fixture_id: fixtureId, team_id, player_name: raw.trim(), minute: min ?? null, goal_type }];
  });
}

function parseSnippetGoals(
  snippet: string, fixtureId: string, homeId: string, awayId: string, homeName: string, awayName: string,
): GoalEntry[] {
  const results: GoalEntry[] = [];
  if (!snippet) return results;
  const text = snippet.replace(/[\u2018\u2019]/g, "'");
  let currentTeamId = homeId;
  const homeWords = homeName.toLowerCase().split(' ');
  const awayWords = awayName.toLowerCase().split(' ');
  const goalRe = /([A-Z\u00c0-\u017d][a-z\u00e0-\u017e]+(?:\s+[A-Z\u00c0-\u017d][a-z\u00e0-\u017e']+)*)\s+(\d{1,3})'?(?:\s*[\+\+]\d+)?(?:\s*\(([^)]+)\))?/g;
  const teamLabelRe = new RegExp(`(${escapeRe(homeName)}|${escapeRe(awayName)}|${escapeRe(homeWords[0])}|${escapeRe(awayWords[0])})\\s*[:\\-]`, 'gi');
  const segments: Array<{ teamId: string; text: string }> = [];
  let lastIndex = 0;
  let teamLabelMatch: RegExpExecArray | null;
  teamLabelRe.lastIndex = 0;
  while ((teamLabelMatch = teamLabelRe.exec(text)) !== null) {
    if (lastIndex < teamLabelMatch.index) {
      segments.push({ teamId: currentTeamId, text: text.slice(lastIndex, teamLabelMatch.index) });
    }
    const label = teamLabelMatch[1].toLowerCase();
    currentTeamId = homeWords.some(w => label.includes(w)) ? homeId : awayId;
    lastIndex = teamLabelRe.lastIndex;
  }
  segments.push({ teamId: currentTeamId, text: text.slice(lastIndex) });
  for (const seg of segments) {
    goalRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = goalRe.exec(seg.text)) !== null) {
      const player = m[1].trim();
      const minute = parseInt(m[2], 10);
      const qualifier = m[3] ?? '';
      if (['goals', 'goles', 'goal', 'score', 'result', 'world', 'group', 'match'].includes(player.toLowerCase())) continue;
      if (minute < 1 || minute > 130) continue;
      results.push({ fixture_id: fixtureId, team_id: seg.teamId, player_name: player, minute, goal_type: detectGoalType(qualifier) });
    }
  }
  return results;
}

async function fetchGoalScorersFromSerper(
  fixtureId: string, homeId: string, awayId: string, serperKey: string,
): Promise<GoalEntry[]> {
  const home = teamName(homeId);
  const away = teamName(awayId);
  const homeWords = teamWords(homeId);
  const awayWords = teamWords(awayId);
  const query = `${home} ${away} goals scorers FIFA World Cup 2026`;
  let res: Response;
  try {
    res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 5 }),
    });
  } catch (e) {
    console.error(`[serper] fetch error for ${fixtureId}:`, e);
    return [];
  }
  if (!res.ok) { console.error(`[serper] HTTP ${res.status} for ${fixtureId}`); return []; }

  const data: SerperResponse = await res.json();
  const game = data.sportsResults?.games?.[0];
  if (game?.goals && game.goals.length > 0) {
    const parsed = parseStructuredGoals(game.goals, fixtureId, homeId, awayId, homeWords, awayWords);
    if (parsed.length > 0) {
      console.log(`[serper] ${fixtureId}: ${parsed.length} goals from sportsResults`);
      return parsed;
    }
  }
  const snippet = data.answerBox?.snippet ?? data.answerBox?.answer ?? data.organic?.[0]?.snippet ?? '';
  const parsed = parseSnippetGoals(snippet, fixtureId, homeId, awayId, home, away);
  console.log(`[serper] ${fixtureId}: ${parsed.length} goals from snippet`);
  return parsed;
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------
interface KoFixtureInput { id: string; home_team_id: string; away_team_id: string; kickoff_utc: string; }

Deno.serve(async (req) => {
  const SERPER_KEY = Deno.env.get('SERPER_API_KEY') || req.headers.get('X-Serper-Key') || '';

  // Knockout bracket (resolved teams + kickoff) comes from the caller's request
  // body, since ko:* fixtures don't exist in wc_fixtures. GET / empty body → [].
  const body = await req.json().catch(() => ({})) as { koFixtures?: KoFixtureInput[] };
  const koFixturesInput = Array.isArray(body.koFixtures) ? body.koFixtures : [];

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Load all played fixtures (group stage + knockout) with their kickoff dates
  const { data: results, error: rErr } = await supabase
    .from('wc_actual_results')
    .select('fixture_id, home_goals, away_goals');
  if (rErr) return new Response(JSON.stringify({ error: rErr.message }), { status: 500 });

  const playedResults = results ?? [];

  // Known goal total per fixture — drives source selection & completeness.
  const expectedByFixture = new Map<string, number>();
  for (const r of playedResults) expectedByFixture.set(r.fixture_id, r.home_goals + r.away_goals);
  const expectedOf = (fid: string) => expectedByFixture.get(fid) ?? 0;
  const lenOf = (m: Map<string, GoalEntry[]>, fid: string) => m.get(fid)?.length ?? 0;

  // Resolve knockout fixtures by id → { date, teams } from the request body.
  const koById = new Map<string, { date: string; dbHome: string; dbAway: string }>();
  for (const f of koFixturesInput) {
    if (!f?.id || !f.home_team_id || !f.away_team_id || !f.kickoff_utc) continue;
    const d = new Date(f.kickoff_utc);
    const dateStr = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    koById.set(f.id, { date: dateStr, dbHome: f.home_team_id, dbAway: f.away_team_id });
  }

  // Get kickoff dates from wc_fixtures for each group result
  const { data: fixtureRows, error: fErr } = await supabase
    .from('wc_fixtures')
    .select('home_team_id, away_team_id, kickoff_utc');
  if (fErr) return new Response(JSON.stringify({ error: fErr.message }), { status: 500 });

  // Build lookup: "teamA:teamB" → { date, dbHome, dbAway }
  // Stored under both orderings so fixture_ids with reversed home/away still match.
  const fixtureByKey = new Map<string, { date: string; dbHome: string; dbAway: string }>();
  for (const f of fixtureRows ?? []) {
    const d = new Date(f.kickoff_utc);
    const dateStr = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const entry = { date: dateStr, dbHome: f.home_team_id, dbAway: f.away_team_id };
    fixtureByKey.set(`${f.home_team_id}:${f.away_team_id}`, entry);
    fixtureByKey.set(`${f.away_team_id}:${f.home_team_id}`, entry); // reverse lookup
  }

  // Resolve a played fixture to { date, teams }: knockout via koById (request
  // body), group stage via the team-pair key (its id order can differ from
  // wc_fixtures, so a direct id lookup would miss ~30% of group fixtures).
  function resolveFixture(fixtureId: string): { date: string; dbHome: string; dbAway: string } | null {
    if (fixtureId.startsWith('ko:')) return koById.get(fixtureId) ?? null;
    const parts = fixtureId.split(':');
    if (parts.length < 4) return null;
    return fixtureByKey.get(`${parts[2]}:${parts[3]}`) ?? null;
  }

  // Organize fixtures by date for ESPN/SofaScore batching.
  // Use dbHome/dbAway (the real venue order) so ESPN/SofaScore home-team detection is correct.
  const fixturesByDate = new Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>();
  for (const r of playedResults) {
    const info = resolveFixture(r.fixture_id);
    if (!info) { console.warn(`[init] no fixture mapping for ${r.fixture_id}`); continue; }
    const existing = fixturesByDate.get(info.date) ?? [];
    existing.push({ fixtureId: r.fixture_id, homeId: info.dbHome, awayId: info.dbAway });
    fixturesByDate.set(info.date, existing);
  }

  // -- SOURCE 1: ESPN ---------------------------------------------------------
  const espnGoals = await fetchGoalsFromESPN(fixturesByDate);

  // SofaScore: any fixture whose ESPN result is still short of the known total.
  const stillMissingForSofa = new Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>();
  for (const [date, fixtures] of fixturesByDate) {
    const missing = fixtures.filter(f => {
      const exp = expectedOf(f.fixtureId);
      if (exp === 0) return false;                          // 0-0: nothing to find
      return lenOf(espnGoals, f.fixtureId) < exp;           // incomplete → try Sofa
    });
    if (missing.length > 0) stillMissingForSofa.set(date, missing);
  }

  // -- SOURCE 2: SofaScore ----------------------------------------------------
  const sofaGoals = stillMissingForSofa.size > 0
    ? await fetchGoalsFromSofa(stillMissingForSofa)
    : new Map<string, GoalEntry[]>();

  // -- SOURCE 3: Serper — fixtures still short after ESPN+Sofa ----------------
  const stillMissingForSerper = playedResults.filter(r => {
    const exp = expectedOf(r.fixture_id);
    if (exp === 0) return false;
    const best = Math.max(lenOf(espnGoals, r.fixture_id), lenOf(sofaGoals, r.fixture_id));
    return best < exp;
  });

  const serperGoals = new Map<string, GoalEntry[]>();
  if (stillMissingForSerper.length > 0 && SERPER_KEY) {
    for (const r of stillMissingForSerper) {
      const info = resolveFixture(r.fixture_id);
      let homeId: string, awayId: string;
      if (info) {
        homeId = info.dbHome; awayId = info.dbAway;
      } else if (!r.fixture_id.startsWith('ko:')) {
        const parts = r.fixture_id.split(':');
        if (parts.length < 4) continue;
        homeId = parts[2]; awayId = parts[3];
      } else {
        continue;
      }
      const goals = await fetchGoalScorersFromSerper(r.fixture_id, homeId, awayId, SERPER_KEY);
      if (goals.length > 0) serperGoals.set(r.fixture_id, goals);
      await new Promise(res => setTimeout(res, 1200));
    }
  }

  // -- Reconcile: per fixture, keep the MOST COMPLETE result across sources ---
  // (prefer a set that hits the expected total exactly, else the largest).
  const allGoalsByFixture = new Map<string, GoalEntry[]>();
  const sourceByFixture: Record<string, string> = {}; // diagnostics: per-source counts + winner
  for (const fid of new Set([...espnGoals.keys(), ...sofaGoals.keys(), ...serperGoals.keys()])) {
    const exp = expectedOf(fid);
    const eN = lenOf(espnGoals, fid), sN = lenOf(sofaGoals, fid), rN = lenOf(serperGoals, fid);
    const cands = [espnGoals.get(fid), sofaGoals.get(fid), serperGoals.get(fid)]
      .filter((g): g is GoalEntry[] => !!g && g.length > 0);
    if (cands.length === 0) continue;
    cands.sort((a, b) => {
      const ae = a.length === exp ? 1 : 0, be = b.length === exp ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.length - a.length;
    });
    const winner = cands[0];
    const src = winner === espnGoals.get(fid) ? 'espn' : winner === sofaGoals.get(fid) ? 'sofa' : 'serper';
    allGoalsByFixture.set(fid, winner);
    sourceByFixture[fid] = `${src} (exp${exp} e${eN}/s${sN}/r${rN})`;
  }

  // -- Monotonic, per-fixture write: never reduce a fixture's coverage --------
  const targetFixtures = [...allGoalsByFixture.keys()];
  const existingCount = new Map<string, number>();
  if (targetFixtures.length > 0) {
    const { data: existingRows } = await supabase
      .from('match_goals').select('fixture_id').in('fixture_id', targetFixtures);
    for (const row of existingRows ?? []) {
      existingCount.set(row.fixture_id, (existingCount.get(row.fixture_id) ?? 0) + 1);
    }
  }

  let written = 0, skippedWorse = 0, insertedGoals = 0;
  for (const [fid, goals] of allGoalsByFixture) {
    const have = existingCount.get(fid) ?? 0;
    const exp = expectedOf(fid);
    if (goals.length < have)                       { skippedWorse++; continue; } // never reduce
    if (have > 0 && exp > 0 && have >= exp)         continue;                     // already complete
    if (goals.length === have && have > 0)          continue;                     // no improvement
    const del = await supabase.from('match_goals').delete().eq('fixture_id', fid);
    if (del.error) { console.error(`[del] ${fid}`, del.error); continue; }
    const ins = await supabase.from('match_goals').insert(goals);
    if (ins.error) { console.error(`[ins] ${fid}`, ins.error); continue; }
    written++; insertedGoals += goals.length;
  }

  // Fixtures that still don't reach their known total after this run.
  const stillIncomplete = playedResults.filter(r => {
    const exp = expectedOf(r.fixture_id);
    if (exp === 0) return false;
    const best = Math.max(existingCount.get(r.fixture_id) ?? 0, lenOf(allGoalsByFixture, r.fixture_id));
    return best < exp;
  }).map(r => r.fixture_id);

  const summary = {
    processedFixtures: playedResults.length,
    knockoutResolved:  koById.size,
    fromEspn:   espnGoals.size,
    fromSofa:   sofaGoals.size,
    fromSerper: serperGoals.size,
    fixturesWritten:   written,
    skippedWorse,
    insertedGoals,
    stillIncompleteCount: stillIncomplete.length,
    stillIncomplete:      stillIncomplete.slice(0, 30),
    sourceByFixture,
  };
  console.log('[update-goal-scorers] done', summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
