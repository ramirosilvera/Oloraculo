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
// Source priority (per fixture):
//   1. ESPN scoreboard (?dates=YYYYMMDD) — free, no key, rich events
//   2. SofaScore incidents           — free, no key, server-side only
//   3. Serper Google search          — fallback, key required
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

// ─────────────────────────────────────────────────────────────────────────────
// Team name lookup (fixture ID slug → search name)
// ─────────────────────────────────────────────────────────────────────────────
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
  'new-caledonia': 'New Caledonia', 'vietnam': 'Vietnam',
  'austria': 'Austria', 'chile': 'Chile', 'peru': 'Peru', 'costa-rica': 'Costa Rica',
};

function teamName(id: string): string {
  return TEAM_NAMES[id] ?? id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Normalize a display name to a slug for reverse lookup.
// "Ivory Coast" → "ivory-coast", "Saudi Arabia" → "saudi-arabia"
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// Build reverse map: slugified display name → our team ID
const SLUG_TO_ID: Record<string, string> = {};
for (const [id, display] of Object.entries(TEAM_NAMES)) {
  SLUG_TO_ID[slugify(display)] = id;
}

function resolveTeamId(displayName: string): string | null {
  // Try exact slugify match first
  const slug = slugify(displayName);
  if (SLUG_TO_ID[slug]) return SLUG_TO_ID[slug];
  // Try partial match on first word (e.g., "Ivory" → "ivory-coast")
  const firstWord = displayName.split(' ')[0].toLowerCase();
  for (const [id, name] of Object.entries(TEAM_NAMES)) {
    if (id.startsWith(firstWord) || name.toLowerCase().startsWith(firstWord)) return id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 1 — ESPN scoreboard (per date)
// ─────────────────────────────────────────────────────────────────────────────

interface EspnGoalResult {
  fixtureKey: string; // "homeTeamId:awayTeamId"
  goals: GoalEntry[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEspnGoals(comp: any, fixtureId: string, homeId: string, awayId: string): GoalEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const homeEspnId: string = (comp.competitors ?? []).find((c: any) => c.homeAway === 'home')?.team?.id ?? '';
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
    const team_id = espnTeamId
      ? (espnTeamId === homeEspnId ? homeId : awayId)
      : homeId;

    return [{ fixture_id: fixtureId, team_id, player_name, minute: parseMinute(minuteStr), goal_type }];
  });
}

async function fetchGoalsFromESPN(
  fixturesByDate: Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>,
): Promise<Map<string, GoalEntry[]>> {
  const result = new Map<string, GoalEntry[]>();

  for (const [date, fixtures] of fixturesByDate) {
    try {
      const res = await fetch(`${ESPN_BASE}?dates=${date}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Oloraculo/1.0)' },
      });
      if (!res.ok) { console.warn(`[espn] HTTP ${res.status} for date ${date}`); continue; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = body.events ?? [];

      for (const { fixtureId, homeId, awayId } of fixtures) {
        const homeName = teamName(homeId).toLowerCase();
        const awayName = teamName(awayId).toLowerCase();

        // Match event by home+away team name
        // Build word lists from both slug and display name for robust matching
        // e.g. 'cape-verde' + 'Cape Verde' → ['cape','verde'] catches 'Cabo Verde' via 'verde'
        const homeWords = [...homeId.split('-'), ...homeName.split(' ')].map(w => w.toLowerCase()).filter(w => w.length > 2);
        const awayWords = [...awayId.split('-'), ...awayName.split(' ')].map(w => w.toLowerCase()).filter(w => w.length > 2);

        const ev = events.find(e => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comps: any[] = e.competitions?.[0]?.competitors ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const h = comps.find((c: any) => c.homeAway === 'home');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = comps.find((c: any) => c.homeAway === 'away');
          const hn = (h?.team?.displayName ?? h?.team?.name ?? '').toLowerCase();
          const an = (a?.team?.displayName ?? a?.team?.name ?? '').toLowerCase();
          return homeWords.some(w => hn.includes(w)) && awayWords.some(w => an.includes(w));
        });

        if (!ev) { console.log(`[espn] no match found for ${fixtureId} on ${date}`); continue; }

        const statusName: string = ev.status?.type?.name ?? '';
        if (!statusName.includes('FINAL') && !statusName.includes('FULL_TIME') && !statusName.includes('POST')) {
          console.log(`[espn] ${fixtureId} not finished yet (${statusName})`);
          continue;
        }

        const comp = ev.competitions?.[0] ?? {};
        const goals = parseEspnGoals(comp, fixtureId, homeId, awayId);
        console.log(`[espn] ${fixtureId}: ${goals.length} goals`);
        // Only mark covered if we got actual goal events; otherwise fall through to SofaScore/Serper
        if (goals.length > 0) result.set(fixtureId, goals);
      }
    } catch (e) {
      console.error(`[espn] error for date ${date}:`, e);
    }
    // Small delay between date requests
    await new Promise(r => setTimeout(r, 300));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 2 — SofaScore (incidents by event search)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGoalsFromSofa(
  fixturesByDate: Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>,
): Promise<Map<string, GoalEntry[]>> {
  const result = new Map<string, GoalEntry[]>();

  for (const [date, fixtures] of fixturesByDate) {
    // date is YYYYMMDD, SofaScore wants YYYY-MM-DD
    const sofaDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    try {
      const res = await fetch(`${SOFA_BASE}/sport/football/scheduled-events/${sofaDate}`, { headers: SOFA_HEADERS });
      if (!res.ok) { console.warn(`[sofa] HTTP ${res.status} for date ${sofaDate}`); continue; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = data.events ?? [];

      // Filter FIFA World Cup events
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
        const homeName = teamName(homeId).toLowerCase();
        const awayName = teamName(awayId).toLowerCase();

        const homeWordsSofa = [...homeId.split('-'), ...homeName.split(' ')].map(w => w.toLowerCase()).filter(w => w.length > 2);
        const awayWordsSofa = [...awayId.split('-'), ...awayName.split(' ')].map(w => w.toLowerCase()).filter(w => w.length > 2);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ev = wcEvents.find((e: any) => {
          const hn = (e.homeTeam?.name ?? '').toLowerCase();
          const an = (e.awayTeam?.name ?? '').toLowerCase();
          return homeWordsSofa.some(w => hn.includes(w)) && awayWordsSofa.some(w => an.includes(w));
        });

        if (!ev) { console.log(`[sofa] no match for ${fixtureId} on ${sofaDate}`); continue; }
        if (ev.status?.type !== 'finished') { console.log(`[sofa] ${fixtureId} not finished`); continue; }

        // Fetch incidents for this event
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
            if      (iClass === 'owngoal' || iClass === 'own_goal' || iClass === 'ownGoal') goal_type = 'own_goal';
            else if (iClass === 'penalty')                                                  goal_type = 'penalty';
            else                                                                            goal_type = 'normal';

            const player_name: string = inc.player?.name ?? inc.playerName ?? '';
            if (!player_name) return [];

            const addedTime: number | null = inc.addedTime ?? null;
            const minuteStr = `${inc.time ?? '?'}${addedTime ? '+' + addedTime : ''}'`;
            const team_id = (inc.isHome ?? true) ? homeId : awayId;

            return [{ fixture_id: fixtureId, team_id, player_name, minute: parseMinute(minuteStr), goal_type }];
          });

          console.log(`[sofa] ${fixtureId}: ${goals.length} goals`);
          // Only mark covered if we got actual goal events; otherwise fall through to Serper
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

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 3 — Serper (Google search fallback)
// ─────────────────────────────────────────────────────────────────────────────

function parseStructuredGoals(
  goals: SerperGoal[], fixtureId: string, homeId: string, awayId: string, homeName: string, awayName: string,
): GoalEntry[] {
  return goals.flatMap(g => {
    const raw = g.player ?? '';
    if (!raw.trim()) return [];
    const min = typeof g.minute === 'number' ? g.minute
              : typeof g.minute === 'string' ? parseInt(g.minute, 10) || null : null;
    const goal_type = g.type ? detectGoalType(g.type) : 'normal';
    const gTeam = (g.team ?? '').toLowerCase();
    const team_id = gTeam.includes(homeName.toLowerCase().split(' ')[0]) ? homeId
                  : gTeam.includes(awayName.toLowerCase().split(' ')[0]) ? awayId : homeId;
    return [{ fixture_id: fixtureId, team_id, player_name: raw.trim(), minute: min ?? null, goal_type }];
  });
}

function parseSnippetGoals(
  snippet: string, fixtureId: string, homeId: string, awayId: string, homeName: string, awayName: string,
): GoalEntry[] {
  const results: GoalEntry[] = [];
  if (!snippet) return results;
  const text = snippet.replace(/’|‘/g, "'");
  let currentTeamId = homeId;
  const homeWords = homeName.toLowerCase().split(' ');
  const awayWords = awayName.toLowerCase().split(' ');
  const goalRe = /([A-ZÀ-Ž][a-zà-ž]+(?:\s+[A-ZÀ-Ž][a-zà-ž']+)*)\s+(\d{1,3})'?(?:\s*[\+\+]\d+)?(?:\s*\(([^)]+)\))?/g;
  const teamLabelRe = new RegExp(`(${homeName}|${awayName}|${homeWords[0]}|${awayWords[0]})\\s*[:\\-]`, 'gi');
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
    const parsed = parseStructuredGoals(game.goals, fixtureId, homeId, awayId, home, away);
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

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
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

  // Organize fixtures by date for ESPN/SofaScore batching.
  // Use dbHome/dbAway (the real venue order) so ESPN/SofaScore home-team detection is correct.
  // Resolve a played fixture to { date, teams }: knockout via koById (request
  // body), group stage via the team-pair key (its id order can differ from
  // wc_fixtures, so a direct id lookup would miss ~30% of group fixtures).
  function resolveFixture(fixtureId: string): { date: string; dbHome: string; dbAway: string } | null {
    if (fixtureId.startsWith('ko:')) return koById.get(fixtureId) ?? null;
    const parts = fixtureId.split(':');
    if (parts.length < 4) return null;
    return fixtureByKey.get(`${parts[2]}:${parts[3]}`) ?? null;
  }

  const fixturesByDate = new Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>();
  for (const r of playedResults) {
    const info = resolveFixture(r.fixture_id);
    if (!info) { console.warn(`[init] no fixture mapping for ${r.fixture_id}`); continue; }
    const existing = fixturesByDate.get(info.date) ?? [];
    existing.push({ fixtureId: r.fixture_id, homeId: info.dbHome, awayId: info.dbAway });
    fixturesByDate.set(info.date, existing);
  }

  // ── SOURCE 1: ESPN ─────────────────────────────────────────────────────────
  const espnGoals = await fetchGoalsFromESPN(fixturesByDate);

  // Identify what ESPN didn't cover (fixtures with goals that still have no data)
  const stillMissingForSofa = new Map<string, Array<{ fixtureId: string; homeId: string; awayId: string }>>();
  for (const [date, fixtures] of fixturesByDate) {
    const missing = fixtures.filter(f => {
      if (espnGoals.has(f.fixtureId)) return false;
      // 0-0 matches: no goals to find
      const r = playedResults.find(gr => gr.fixture_id === f.fixtureId);
      return r && (r.home_goals + r.away_goals) > 0;
    });
    if (missing.length > 0) stillMissingForSofa.set(date, missing);
  }

  // ── SOURCE 2: SofaScore ────────────────────────────────────────────────────
  const sofaGoals = stillMissingForSofa.size > 0
    ? await fetchGoalsFromSofa(stillMissingForSofa)
    : new Map<string, GoalEntry[]>();

  // ── SOURCE 3: Serper (fallback for still-missing fixtures with goals) ──────
  const stillMissingForSerper = playedResults.filter(r => {
    if (r.home_goals + r.away_goals === 0) return false; // 0-0, skip
    if (espnGoals.has(r.fixture_id)) return false;
    if (sofaGoals.has(r.fixture_id)) return false;
    return true;
  });

  const serperGoals = new Map<string, GoalEntry[]>();
  if (stillMissingForSerper.length > 0 && SERPER_KEY) {
    for (const r of stillMissingForSerper) {
      // Resolved teams (correct attribution): KO via bracket body, group via
      // wc_fixtures; group falls back to the fixture_id team slugs if unmapped.
      const info = resolveFixture(r.fixture_id);
      let homeId: string, awayId: string;
      if (info) {
        homeId = info.dbHome; awayId = info.dbAway;
      } else if (!r.fixture_id.startsWith('ko:')) {
        const parts = r.fixture_id.split(':');
        if (parts.length < 4) continue;
        homeId = parts[2]; awayId = parts[3];
      } else {
        continue; // knockout fixture with no bracket mapping → can't attribute
      }
      const goals = await fetchGoalScorersFromSerper(r.fixture_id, homeId, awayId, SERPER_KEY);
      if (goals.length > 0) serperGoals.set(r.fixture_id, goals);
      await new Promise(res => setTimeout(res, 1200));
    }
  }

  // ── Merge & upsert ─────────────────────────────────────────────────────────
  const allGoalsByFixture = new Map<string, GoalEntry[]>([
    ...espnGoals,
    ...sofaGoals,
    ...serperGoals,
  ]);

  const updatedFixtures = [...allGoalsByFixture.keys()];
  const allGoals = [...allGoalsByFixture.values()].flat();

  if (updatedFixtures.length > 0) {
    await supabase.from('match_goals').delete().in('fixture_id', updatedFixtures);
    if (allGoals.length > 0) {
      const { error: insErr } = await supabase.from('match_goals').insert(allGoals);
      if (insErr) console.error('[update-goal-scorers] insert error:', insErr);
    }
  }

  const summary = {
    processedFixtures: playedResults.length,
    knockoutResolved:  koById.size,
    updatedFromEspn:   espnGoals.size,
    updatedFromSofa:   sofaGoals.size,
    updatedFromSerper: serperGoals.size,
    totalGoals:        allGoals.length,
    skippedNoData:     playedResults.filter(r => r.home_goals + r.away_goals > 0 && !allGoalsByFixture.has(r.fixture_id)).length,
  };
  console.log('[update-goal-scorers] done', summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
