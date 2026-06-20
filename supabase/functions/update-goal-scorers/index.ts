// =============================================================================
// Oloráculo — update-goal-scorers Edge Function
// Runs daily at 08:00 UTC via pg_cron.
// For every played fixture, searches Serper for goal scorer data and
// upserts into the match_goals table.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERPER_KEY          = Deno.env.get('SERPER_API_KEY')!;
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─────────────────────────────────────────────────────────────────────────────
// Team name lookup (fixture ID slug → English search name)
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
};

function teamName(id: string): string {
  return TEAM_NAMES[id] ?? id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
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

interface SerperGoal {
  player?: string;
  team?:   string;
  minute?: string | number;
  type?:   string;
}

interface SerperGame {
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  goals?:    SerperGoal[];
}

interface SerperResponse {
  sportsResults?: { games?: SerperGame[] };
  answerBox?:     { snippet?: string; answer?: string };
  organic?:       Array<{ snippet?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal-type detection
// ─────────────────────────────────────────────────────────────────────────────
function detectGoalType(raw: string): 'normal' | 'penalty' | 'own_goal' {
  const s = raw.toLowerCase();
  if (/pen(al(ty)?)?|p\.k\.|penal|\(p\)/.test(s)) return 'penalty';
  if (/own.?goal|og\b|autogol|\(ag\)|\(og\)/.test(s)) return 'own_goal';
  return 'normal';
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse Serper structured sports results
// ─────────────────────────────────────────────────────────────────────────────
function parseStructuredGoals(
  goals: SerperGoal[],
  fixtureId: string,
  homeId: string,
  awayId: string,
  homeName: string,
  awayName: string,
): GoalEntry[] {
  return goals.flatMap(g => {
    const raw    = g.player ?? '';
    if (!raw.trim()) return [];
    const min    = typeof g.minute === 'number' ? g.minute
                 : typeof g.minute === 'string' ? parseInt(g.minute, 10) || null
                 : null;
    const type   = g.type ? detectGoalType(g.type) : 'normal';
    // Determine team from goal entry
    const gTeam  = (g.team ?? '').toLowerCase();
    const teamId = gTeam.includes(homeName.toLowerCase().split(' ')[0]) ? homeId
                 : gTeam.includes(awayName.toLowerCase().split(' ')[0]) ? awayId
                 : homeId; // fallback
    return [{ fixture_id: fixtureId, team_id: teamId, player_name: raw.trim(), minute: min ?? null, goal_type: type }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse goal scorers from a freetext snippet
// Handles patterns like:
//   "Goals: Mbappe 23', Giroud 67' (pen), Neuer 89' (og)"
//   "France: Mbappe (23) | Germany: Mueller (78)"
//   "Goles: Mbappe 23, Giroud 67 (P)"
// ─────────────────────────────────────────────────────────────────────────────
function parseSnippetGoals(
  snippet: string,
  fixtureId: string,
  homeId: string,
  awayId: string,
  homeName: string,
  awayName: string,
): GoalEntry[] {
  const results: GoalEntry[] = [];
  if (!snippet) return results;

  // Normalize separators
  const text = snippet.replace(/’|'/g, "'");

  // Determine team context from surrounding label
  let currentTeamId = homeId;
  const homeWords = homeName.toLowerCase().split(' ');
  const awayWords = awayName.toLowerCase().split(' ');

  // Pattern: "Name Surname 23'" or "Name 23, 67 (pen)"
  // We scan for "<Word(s)> <minute>" patterns
  const goalRe = /([A-ZÀ-Ž][a-zà-ž]+(?:\s+[A-ZÀ-Ž][a-zà-ž']+)*)\s+(\d{1,3})'?(?:\s*[\+\+]\d+)?(?:\s*\(([^)]+)\))?/g;
  // Team label switching: "France:" or "France -"
  const teamLabelRe = new RegExp(`(${homeName}|${awayName}|${homeWords[0]}|${awayWords[0]})\\s*[:\\-]`, 'gi');

  // Split on team labels first
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
      // Skip obvious non-player tokens
      if (['goals', 'goles', 'goal', 'score', 'result', 'world', 'group', 'match'].includes(player.toLowerCase())) continue;
      if (minute < 1 || minute > 130) continue;
      results.push({
        fixture_id:  fixtureId,
        team_id:     seg.teamId,
        player_name: player,
        minute,
        goal_type:   detectGoalType(qualifier),
      });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serper search + parse
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGoalScorers(
  fixtureId: string,
  homeId: string,
  awayId: string,
): Promise<GoalEntry[]> {
  const home = teamName(homeId);
  const away = teamName(awayId);
  const query = `${home} ${away} goals scorers FIFA World Cup 2026`;

  let res: Response;
  try {
    res = await fetch('https://google.serper.dev/search', {
      method:  'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 5 }),
    });
  } catch (e) {
    console.error(`[serper] fetch error for ${fixtureId}:`, e);
    return [];
  }

  if (!res.ok) {
    console.error(`[serper] HTTP ${res.status} for ${fixtureId}`);
    return [];
  }

  const data: SerperResponse = await res.json();

  // 1. Try structured sports results
  const game = data.sportsResults?.games?.[0];
  if (game?.goals && game.goals.length > 0) {
    const parsed = parseStructuredGoals(game.goals, fixtureId, homeId, awayId, home, away);
    if (parsed.length > 0) {
      console.log(`[serper] ${fixtureId}: ${parsed.length} goals from sportsResults`);
      return parsed;
    }
  }

  // 2. Fall back to answer box / first organic snippet
  const snippet = data.answerBox?.snippet
    ?? data.answerBox?.answer
    ?? data.organic?.[0]?.snippet
    ?? '';

  const parsed = parseSnippetGoals(snippet, fixtureId, homeId, awayId, home, away);
  console.log(`[serper] ${fixtureId}: ${parsed.length} goals from snippet`);
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (_req) => {
  if (!SERPER_KEY) {
    return new Response(JSON.stringify({ error: 'SERPER_API_KEY not set' }), { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch all played fixtures (from wc_actual_results — these are confirmed played)
  const { data: results, error: rErr } = await supabase
    .from('wc_actual_results')
    .select('fixture_id');

  if (rErr) {
    return new Response(JSON.stringify({ error: rErr.message }), { status: 500 });
  }

  const fixtureIds = (results ?? []).map(r => r.fixture_id as string);
  // Only process group stage (knockout IDs start with "ko:")
  const groupIds = fixtureIds.filter(id => !id.startsWith('ko:'));

  const allGoals: GoalEntry[] = [];
  const updatedFixtures: string[] = [];
  const failedFixtures: string[] = [];

  for (const fixtureId of groupIds) {
    // Parse team IDs from fixture_id: "grp:A:mexico:south-africa"
    const parts = fixtureId.split(':');
    if (parts.length < 4) continue;
    const homeId = parts[2];
    const awayId = parts[3];

    try {
      const goals = await fetchGoalScorers(fixtureId, homeId, awayId);
      if (goals.length > 0) {
        allGoals.push(...goals);
        updatedFixtures.push(fixtureId);
      }
    } catch (e) {
      console.error(`[update-goal-scorers] error on ${fixtureId}:`, e);
      failedFixtures.push(fixtureId);
    }

    // Respect Serper rate limit (~100 req/day free tier → throttle)
    await new Promise(r => setTimeout(r, 1200));
  }

  // Upsert: clear per-fixture goals then re-insert (idempotent)
  if (updatedFixtures.length > 0) {
    await supabase.from('match_goals').delete().in('fixture_id', updatedFixtures);
    if (allGoals.length > 0) {
      const { error: insErr } = await supabase.from('match_goals').insert(allGoals);
      if (insErr) console.error('[update-goal-scorers] insert error:', insErr);
    }
  }

  const summary = {
    processedFixtures: groupIds.length,
    updatedFixtures:   updatedFixtures.length,
    totalGoals:        allGoals.length,
    failedFixtures,
  };
  console.log('[update-goal-scorers] done', summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
