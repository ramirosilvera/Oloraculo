/**
 * POST /api/refresh-context
 * Body: { fixture_id: string, home_name: string, away_name: string }
 *
 * Runs a Serper search → Gemini extraction for a single match and returns a
 * FixtureContext object ready to upsert to Supabase.
 *
 * Env vars (set in Cloudflare Pages dashboard):
 *   SERPER_API_KEY
 *   GEMINI_API_KEY
 *   GEMINI_MODEL   (optional, default gemini-2.5-flash)
 */

interface Env {
  SERPER_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

// ── Impact table (mirrors AvailabilityNewsService.cs) ────────────────────────
const IMPACT: Record<string, { attack: number; defense: number }> = {
  Goalkeeper: { attack: 0.000, defense: 0.050 },
  Defender:   { attack: 0.004, defense: 0.025 },
  Midfielder: { attack: 0.015, defense: 0.010 },
  Attacker:   { attack: 0.035, defense: 0.003 },
  Unknown:    { attack: 0.020, defense: 0.000 },
};
const CAP = 0.18;

function sumImpacts(positions: string[]) {
  let a = 0, d = 0;
  for (const pos of positions) {
    const imp = IMPACT[pos] ?? IMPACT.Unknown;
    a += imp.attack;
    d += imp.defense;
  }
  return { attack: +Math.min(CAP, a).toFixed(4), defense: +Math.min(CAP, d).toFixed(4) };
}

function normalizePosition(pos: string): string {
  const p = (pos ?? '').trim().toLowerCase();
  if (p.startsWith('goalkeeper') || p === 'gk') return 'Goalkeeper';
  if (p.startsWith('defen') || p === 'df' || p === 'cb') return 'Defender';
  if (p.startsWith('midfield') || p === 'mf') return 'Midfielder';
  if (p.startsWith('attack') || p.startsWith('forward') || p.startsWith('strik') || p === 'fw') return 'Attacker';
  return 'Unknown';
}

function normalizePlayerKey(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function normalizeText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isConfirmedOut(status: string): boolean {
  return (status ?? '').toLowerCase().startsWith('confirmedout');
}

function nameAppearsIn(name: string, haystack: string): boolean {
  const tokens = normalizeText(name).split(' ').filter(t => t.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.some(t => haystack.includes(t));
}

function snippetsFromSerper(data: any): string {
  const lines: string[] = [];
  for (const r of (data.organic ?? [])) {
    if (r.title || r.snippet) lines.push(`- ${r.title ?? ''}: ${r.snippet ?? ''} (${r.date ?? ''})`);
  }
  for (const r of (data.topStories ?? [])) {
    if (r.title) lines.push(`- [news] ${r.title} (${r.date ?? ''})`);
  }
  if (data.answerBox?.snippet) lines.push(`- [answer] ${data.answerBox.snippet}`);
  return lines.join('\n').slice(0, 6000);
}

function todayLabel(): string {
  const nowART = new Date(Date.now() - 3 * 3600_000);
  return nowART.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildSystemPrompt(homeName: string, awayName: string, dateLabel: string): string {
  return `You are analysing match-day news for the FIFA World Cup 2026 match: ${homeName} vs ${awayName} on ${dateLabel}.

Return JSON ONLY, shape:
{
  "home_claims": [{"player":"","position":"","status":"","reason":"","supportingText":""}],
  "away_claims": [{"player":"","position":"","status":"","reason":"","supportingText":""}]
}

STRICT RULES — no exceptions:
- Use ONLY information explicitly stated in today's snippets. Never draw on training-data knowledge of past squads or previous tournaments.
- Only include players CONFIRMED ABSENT for THIS specific match today. "Confirmed absent" means the snippet explicitly says: ruled out / will miss / suspended / withdrawn / unavailable / won't play / not in squad.
- "supportingText" MUST be a short verbatim quote from the snippets. If you cannot find the quote in the snippets, EXCLUDE the player entirely.
- Discard any player mentioned in pre-2026 context (June window, qualifiers, friendlies) unless the snippet clearly states the player is also absent from the 2026 World Cup.
- status: one of ConfirmedOutInjury | ConfirmedOutIllness | ConfirmedOutSuspension | ConfirmedOutOther.
- position: one of Goalkeeper | Defender | Midfielder | Attacker (infer if not stated; else Unknown).
- home_claims = players ONLY from ${homeName}; away_claims = players ONLY from ${awayName}.
- If no confirmed absences are found, return {"home_claims":[], "away_claims":[]}.`;
}

interface PlayerClaim {
  playerName: string;
  pos: string;
  reason: string;
}

function filterClaims(rawClaims: any[], haystack: string): PlayerClaim[] {
  const seen = new Map<string, PlayerClaim>();
  for (const c of rawClaims) {
    if (!c.player || !isConfirmedOut(c.status)) continue;
    const support = (c.supportingText ?? '').toString().trim();
    if (!support || !nameAppearsIn(c.player, haystack)) continue;
    const key = normalizePlayerKey(c.player);
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      playerName: String(c.player).trim(),
      pos:        normalizePosition(c.position),
      reason:     (c.reason ?? c.status ?? '').toString().trim(),
    });
  }
  return [...seen.values()];
}

function buildNotes(homeName: string, awayName: string, homePlayers: PlayerClaim[], awayPlayers: PlayerClaim[]): string | null {
  const fmt = (ps: PlayerClaim[]) => ps.map(p => `${p.playerName}${p.reason ? ` (${p.reason})` : ''}`).join(', ');
  return [
    homePlayers.length ? `${homeName}: ${fmt(homePlayers)}` : null,
    awayPlayers.length ? `${awayName}: ${fmt(awayPlayers)}` : null,
  ].filter(Boolean).join(' | ') || null;
}

async function serperSearch(query: string, apiKey: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 10 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Serper HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geminiExtract(
  homeName: string,
  awayName: string,
  snippets: string,
  dateLabel: string,
  apiKey: string,
  model: string,
): Promise<{ home: any[]; away: any[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const base = 'https://generativelanguage.googleapis.com/v1beta/';
  try {
    const url = `${base}models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(homeName, awayName, dateLabel) }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Match: ${homeName} (home) vs ${awayName} (away) — ${dateLabel}\n\nSearch snippets:\n${snippets}` }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    const content = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '{}';
    const parsed = JSON.parse(content);
    return {
      home: Array.isArray(parsed) ? [] : (parsed.home_claims ?? []),
      away: Array.isArray(parsed) ? [] : (parsed.away_claims ?? []),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (!env.SERPER_API_KEY || !env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing SERPER_API_KEY or GEMINI_API_KEY on the server.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { fixture_id?: string; home_name?: string; away_name?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const { fixture_id, home_name, away_name } = body;
  if (!fixture_id || !home_name || !away_name) {
    return new Response(
      JSON.stringify({ error: 'Required: fixture_id, home_name, away_name.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const model     = env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const dateLabel = todayLabel();

  try {
    const query   = `"${home_name}" "${away_name}" FIFA World Cup 2026 injury suspension squad available ${dateLabel}`;
    const serper  = await serperSearch(query, env.SERPER_API_KEY);
    const snippets = snippetsFromSerper(serper);

    if (!snippets) {
      return new Response(
        JSON.stringify({ error: 'No snippets returned from Serper.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { home: rawHome, away: rawAway } = await geminiExtract(
      home_name, away_name, snippets, dateLabel, env.GEMINI_API_KEY, model,
    );
    const haystack = normalizeText(snippets);

    const homePlayers = filterClaims(rawHome, haystack);
    const awayPlayers = filterClaims(rawAway, haystack);

    const homeImpact = sumImpacts(homePlayers.map(p => p.pos));
    const awayImpact = sumImpacts(awayPlayers.map(p => p.pos));

    const ctx = {
      fixture_id,
      unavailable_home_players:        homePlayers.length,
      unavailable_home_attack_impact:  homeImpact.attack,
      unavailable_home_defense_impact: homeImpact.defense,
      unavailable_away_players:        awayPlayers.length,
      unavailable_away_attack_impact:  awayImpact.attack,
      unavailable_away_defense_impact: awayImpact.defense,
      has_lineups:          false,
      has_odds:             false,
      has_availability_news: true,
      notes: buildNotes(home_name, away_name, homePlayers, awayPlayers),
      updated_at: new Date().toISOString(),
      // Extra detail for the UI (not part of FixtureContext schema)
      home_players: homePlayers,
      away_players: awayPlayers,
      snippets_used: snippets.slice(0, 500),
    };

    return new Response(JSON.stringify(ctx), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
