#!/usr/bin/env node
/**
 * build-context.mjs — pre-builds fixture-contexts.json for the React app.
 *
 * Pipeline:
 *   1. Detect TODAY's fixtures (ART timezone, UTC-3)
 *   2. Per fixture: one Serper search ("TeamA" "TeamB" World Cup 2026 injury <date>)
 *   3. One Gemini call per fixture → extracts unavailable players for BOTH teams
 *   4. Grounding filter → drops any claim not verbatim found in snippets
 *   5. Merge into existing fixture-contexts.json (non-today entries preserved)
 *
 * Required env:
 *   SERPER_API_KEY        Serper.dev key (https://serper.dev — 2500 free queries)
 *   GEMINI_API_KEY        Google AI Studio key (https://aistudio.google.com/apikey)
 * Optional env:
 *   GEMINI_MODEL          default gemini-2.5-flash
 *   GEMINI_BASE_URL       default https://generativelanguage.googleapis.com/v1beta/
 *   CONTEXT_QUERY_DATE    override date label e.g. "June 16, 2026" (for testing)
 *
 * The position-impact table mirrors AvailabilityNewsService.cs:
 *   Attacker   → −3.5% goals scored
 *   Midfielder → −1.5% goals scored, −1.0% goals conceded
 *   Defender   → −0.4% goals scored, −2.5% goals conceded
 *   Goalkeeper → −5.0% goals conceded
 *
 * Outputs:
 *   migration/public/data/fixture-contexts.json
 *
 * Without the required keys, or on any failure, the script writes empty files
 * (preserving existing ones) and exits 0 so the deploy never breaks.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const SERPER_API_KEY = process.env.SERPER_API_KEY ?? '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const GEMINI_BASE    = (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/').replace(/\/?$/, '/');

// Today in ART (UTC-3) — used to filter fixtures and bias searches.
// CONTEXT_QUERY_DATE can override (e.g. "June 16 2026") for testing.
const _nowART = new Date(Date.now() - 3 * 3600_000);
const TODAY_ART   = _nowART.toISOString().slice(0, 10);          // "2026-06-16"
const TODAY_LABEL = process.env.CONTEXT_QUERY_DATE
  ?? _nowART.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); // "June 16, 2026"

// ── Impact table ──────────────────────────────────────────────────────────────
const IMPACT = {
  Goalkeeper:  { attack: 0.000, defense: 0.050 },
  Defender:    { attack: 0.004, defense: 0.025 },
  Midfielder:  { attack: 0.015, defense: 0.010 },
  Attacker:    { attack: 0.035, defense: 0.003 },
  Unknown:     { attack: 0.020, defense: 0.000 },
};
const CAP = 0.18;

function sumImpacts(positions) {
  let a = 0, d = 0;
  for (const pos of positions) {
    const { attack, defense } = IMPACT[pos] ?? IMPACT.Unknown;
    a += attack;
    d += defense;
  }
  return { attack: +Math.min(CAP, a).toFixed(4), defense: +Math.min(CAP, d).toFixed(4) };
}

// ── Normalization helpers ─────────────────────────────────────────────────────
function normalizePosition(pos) {
  const p = (pos ?? '').trim().toLowerCase();
  if (p.startsWith('goalkeeper') || p === 'gk')          return 'Goalkeeper';
  if (p.startsWith('defen') || p === 'df' || p === 'cb') return 'Defender';
  if (p.startsWith('midfield') || p === 'mf')            return 'Midfielder';
  if (p.startsWith('attack') || p.startsWith('forward') || p.startsWith('strik') || p === 'fw') return 'Attacker';
  return 'Unknown';
}

function normalizePlayerKey(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

// A claim counts as "unavailable" only when confirmed out.
function isConfirmedOut(status) {
  return (status ?? '').toLowerCase().startsWith('confirmedout');
}

// Normalize free text for grounding checks (accent-free, lowercase, words).
function normalizeText(s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Anti-hallucination guard: keep a claim only if the player is actually
// named in the search snippets we sent. Requires that a meaningful name
// token (>=4 letters, i.e. a surname) appears verbatim in the snippets.
function nameAppearsIn(name, haystack) {
  const tokens = normalizeText(name).split(' ').filter(t => t.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.some(t => haystack.includes(t));
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function serperSearch(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 10 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`serper HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Collapse Serper results into a compact text blob for the LLM.
function snippetsFromSerper(data) {
  const lines = [];
  for (const r of (data.organic ?? [])) {
    if (r.title || r.snippet) lines.push(`- ${r.title ?? ''}: ${r.snippet ?? ''} (${r.date ?? ''})`);
  }
  for (const r of (data.topStories ?? [])) {
    if (r.title) lines.push(`- [news] ${r.title} (${r.date ?? ''})`);
  }
  if (data.answerBox?.snippet) lines.push(`- [answer] ${data.answerBox.snippet}`);
  return lines.join('\n').slice(0, 6000);
}

// Prompt is rendered at call time (TODAY_LABEL injected).
function buildSystemPrompt(homeName, awayName) {
  return `You are analysing match-day news for the FIFA World Cup 2026 match: ${homeName} vs ${awayName} on ${TODAY_LABEL}.

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

async function geminiExtractMatch(homeName, awayName, snippets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const url = `${GEMINI_BASE}models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(homeName, awayName) }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Match: ${homeName} (home) vs ${awayName} (away) — ${TODAY_LABEL}\n\nSearch snippets:\n${snippets}` }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    const content = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '{}';
    const parsed = JSON.parse(content);
    return {
      home: Array.isArray(parsed) ? [] : (parsed.home_claims ?? []),
      away: Array.isArray(parsed) ? [] : (parsed.away_claims ?? []),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns today's date string in ART (UTC-3) — "2026-06-16"
function kickoffDateART(kickoff_utc) {
  return new Date(kickoff_utc).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

// Ground and dedup a raw claims array from the LLM.
function filterClaims(rawClaims, haystack) {
  const seen = new Map();
  let dropped = 0;
  for (const c of rawClaims) {
    if (!c.player || !isConfirmedOut(c.status)) continue;
    const support = (c.supportingText ?? '').toString().trim();
    if (!support || !nameAppearsIn(c.player, haystack)) { dropped++; continue; }
    const key = normalizePlayerKey(c.player);
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      playerName: String(c.player).trim(),
      pos:        normalizePosition(c.position),
      reason:     (c.reason ?? c.status ?? '').toString().trim(),
    });
  }
  return { players: [...seen.values()], dropped };
}

function buildNotes(homeId, awayId, homePlayers, awayPlayers) {
  const fmt = (ps) => ps.map(p => `${p.playerName}${p.reason ? ` (${p.reason})` : ''}`).join(', ');
  return [
    homePlayers.length ? `${homeId}: ${fmt(homePlayers)}` : null,
    awayPlayers.length ? `${awayId}: ${fmt(awayPlayers)}` : null,
  ].filter(Boolean).join(' | ') || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const outContexts = resolve(__dirname, '../migration/public/data/fixture-contexts.json');

  if (!SERPER_API_KEY || !GEMINI_API_KEY) {
    console.log('Missing SERPER_API_KEY and/or GEMINI_API_KEY — skipping fetch, leaving files untouched.');
    writeEmptyIfMissing();
    return;
  }

  const dataDir = resolve(__dirname, '../migration/public/data');
  const fixtures = JSON.parse(readFileSync(`${dataDir}/fixtures.json`, 'utf-8'));
  const teams    = JSON.parse(readFileSync(`${dataDir}/teams.json`, 'utf-8'));
  const nameById = new Map(teams.map(t => [t.id, t.name]));

  // ── Only process fixtures kicking off TODAY (ART timezone) ─────────────────
  const todayFixtures = fixtures.filter(
    f => !f.is_played && f.kickoff_utc && kickoffDateART(f.kickoff_utc) === TODAY_ART,
  );
  console.log(`Today (ART ${TODAY_ART}): ${todayFixtures.length} fixture(s) to process`);
  console.log(`LLM model: ${GEMINI_MODEL} | date label: ${TODAY_LABEL}`);

  if (todayFixtures.length === 0) {
    console.log('No fixtures today — leaving fixture-contexts.json untouched.');
    writeEmptyIfMissing();
    return;
  }

  // ── Load existing contexts so we can merge instead of overwrite ─────────────
  let existingContexts = [];
  if (existsSync(outContexts)) {
    try { existingContexts = JSON.parse(readFileSync(outContexts, 'utf-8')); } catch {}
  }
  // Map: fixture_id → context entry (non-today entries will be preserved)
  const contextMap = new Map(existingContexts.map(c => [c.fixture_id, c]));

  const now = new Date().toISOString();

  // ── Per fixture: one Serper search → one Gemini call (both teams) ──────────
  for (const fixture of todayFixtures) {
    const homeName = nameById.get(fixture.home_team_id) ?? fixture.home_team_id;
    const awayName = nameById.get(fixture.away_team_id) ?? fixture.away_team_id;

    console.log(`\n  ${homeName} vs ${awayName} (${fixture.id})`);
    try {
      // Match-specific query: names + date so results are current and relevant
      const query = `"${homeName}" "${awayName}" FIFA World Cup 2026 injury suspension squad available ${TODAY_LABEL}`;
      const serper   = await serperSearch(query);
      const snippets = snippetsFromSerper(serper);
      if (!snippets) { console.log('    no snippets returned'); continue; }

      const { home: rawHome, away: rawAway } = await geminiExtractMatch(homeName, awayName, snippets);
      const haystack = normalizeText(snippets);

      const { players: homePlayers, dropped: hDrop } = filterClaims(rawHome, haystack);
      const { players: awayPlayers, dropped: aDrop } = filterClaims(rawAway, haystack);

      console.log(`    local  (${homeName}): ${homePlayers.length} out${hDrop ? ` (${hDrop} dropped)` : ''}${homePlayers.length ? ' — ' + homePlayers.map(p => p.playerName).join(', ') : ''}`);
      console.log(`    visita (${awayName}): ${awayPlayers.length} out${aDrop ? ` (${aDrop} dropped)` : ''}${awayPlayers.length ? ' — ' + awayPlayers.map(p => p.playerName).join(', ') : ''}`);

      if (homePlayers.length === 0 && awayPlayers.length === 0) {
        console.log('    → sin bajas confirmadas, sin cambios para este partido');
        continue;
      }

      const homeImpact = sumImpacts(homePlayers.map(p => p.pos));
      const awayImpact = sumImpacts(awayPlayers.map(p => p.pos));

      contextMap.set(fixture.id, {
        fixture_id:                      fixture.id,
        unavailable_home_players:        homePlayers.length,
        unavailable_home_attack_impact:  homeImpact.attack,
        unavailable_home_defense_impact: homeImpact.defense,
        unavailable_away_players:        awayPlayers.length,
        unavailable_away_attack_impact:  awayImpact.attack,
        unavailable_away_defense_impact: awayImpact.defense,
        has_lineups:          false,
        has_odds:             false,
        has_availability_news: true,
        notes:     buildNotes(fixture.home_team_id, fixture.away_team_id, homePlayers, awayPlayers),
        updated_at: now,
      });
    } catch (e) {
      console.warn(`    ⚠ error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 300)); // be polite between fixtures
  }

  // ── Write merged result ────────────────────────────────────────────────────
  const merged = [...contextMap.values()];
  writeFileSync(outContexts, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Wrote ${merged.length} fixture contexts (${todayFixtures.length} today refreshed) → ${outContexts}`);
}

function writeEmptyIfMissing() {
  const base = resolve(__dirname, '../migration/public/data');
  for (const [file, val] of [['fixture-contexts.json', '[]'], ['squads.json', '{}']]) {
    const p = `${base}/${file}`;
    if (!existsSync(p)) writeFileSync(p, val);
  }
}

main().catch(e => {
  console.error('build-context failed:', e.message);
  writeEmptyIfMissing();
  process.exit(0); // Never fail the CI build over context data
});
