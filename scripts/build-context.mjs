#!/usr/bin/env node
/**
 * build-context.mjs — pre-builds fixture-contexts.json for the React app.
 *
 * Pipeline (mirrors the original AvailabilityNewsService.cs design):
 *   1. Serper.dev (Google Search) → recent injury/suspension news per team
 *   2. Gemini LLM                 → extract structured availability claims
 *      from the search snippets (player, position, status, reason)
 *   3. Position-impact table      → per-fixture goal adjustments
 *
 * Required env:
 *   SERPER_API_KEY        Serper.dev key (https://serper.dev — 2500 free queries)
 *   GEMINI_API_KEY        Google AI Studio key (https://aistudio.google.com/apikey)
 * Optional env:
 *   GEMINI_MODEL          default gemini-2.5-flash
 *   GEMINI_BASE_URL       default https://generativelanguage.googleapis.com/v1beta/
 *   CONTEXT_QUERY_DATE    e.g. "June 2026" — biases the search to recent news
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
const QUERY_DATE     = process.env.CONTEXT_QUERY_DATE ?? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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

const LLM_SYSTEM_PROMPT = `You extract football player availability claims from search snippets about a national team.
Return JSON only, shape: {"claims":[{"player":"","position":"","status":"","reason":"","supportingText":""}]}
- position: one of Goalkeeper, Defender, Midfielder, Attacker (best guess from your knowledge if not stated; else "Unknown").
- status: one of ConfirmedOutInjury, ConfirmedOutIllness, ConfirmedOutSuspension, ConfirmedOutOther, Doubtful, Available, NotRelevant.
- Use ConfirmedOut* only for clearly ruled out / withdrawn / will miss / suspended / unavailable players.
- Use Doubtful for race-to-be-fit / major doubt / fitness concern. Use NotRelevant for anything not about availability.
- Only include players for the team named by the user. Do not invent players. If nothing relevant, return {"claims":[]}.`;

async function geminiExtract(teamName, snippets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const url = `${GEMINI_BASE}models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
        contents: [
          { role: 'user', parts: [{ text: `Team: ${teamName}\nSearch snippets (${QUERY_DATE}):\n${snippets}` }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          // Disable "thinking" — extraction is a simple task and thinking
          // adds large latency/cost per call (gemini-2.5-flash defaults on).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    const content = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '{}';
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : (parsed.claims ?? []);
  } finally {
    clearTimeout(timer);
  }
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

  // Only teams that still have an unplayed fixture
  const upcomingTeamIds = [...new Set(
    fixtures.filter(f => !f.is_played).flatMap(f => [f.home_team_id, f.away_team_id]),
  )];
  console.log(`Working with ${fixtures.length} fixtures; ${upcomingTeamIds.length} teams with upcoming matches`);
  console.log(`LLM model: ${GEMINI_MODEL}; query date bias: ${QUERY_DATE}`);

  // ── Per team: Serper search → LLM extraction → unavailable players ─────────
  const unavailableByTeam = new Map(); // slug → [{playerName, pos, reason, status}]
  for (const teamId of upcomingTeamIds) {
    const teamName = nameById.get(teamId) ?? teamId;
    try {
      const serper = await serperSearch(
        `${teamName} national football team injury suspension doubtful players ${QUERY_DATE} World Cup`,
      );
      const snippets = snippetsFromSerper(serper);
      if (!snippets) { console.log(`    ${teamId}: no snippets`); continue; }

      const claims = await geminiExtract(teamName, snippets);
      // Keep confirmed-out players, dedup by normalized name
      const seen = new Map();
      for (const c of claims) {
        if (!c.player || !isConfirmedOut(c.status)) continue;
        const key = normalizePlayerKey(c.player);
        if (!key || seen.has(key)) continue;
        seen.set(key, {
          playerName: String(c.player).trim(),
          pos:        normalizePosition(c.position),
          reason:     (c.reason ?? c.status ?? '').toString().trim(),
          status:     c.status,
        });
      }
      if (seen.size > 0) {
        unavailableByTeam.set(teamId, [...seen.values()]);
        console.log(`    ${teamId}: ${seen.size} out — ${[...seen.values()].map(p => p.playerName).join(', ')}`);
      } else {
        console.log(`    ${teamId}: none confirmed out`);
      }
      await new Promise(r => setTimeout(r, 200)); // be polite
    } catch (e) {
      console.warn(`    ⚠ ${teamId}: ${e.message}`);
    }
  }

  // ── Build fixture-contexts.json ────────────────────────────────────────────
  console.log('\nBuilding fixture contexts...');
  const now = new Date().toISOString();
  const contexts = [];

  for (const fixture of fixtures) {
    if (fixture.is_played) continue;
    const home = unavailableByTeam.get(fixture.home_team_id) ?? [];
    const away = unavailableByTeam.get(fixture.away_team_id) ?? [];
    if (home.length === 0 && away.length === 0) continue;

    const homeImpact = sumImpacts(home.map(p => p.pos));
    const awayImpact = sumImpacts(away.map(p => p.pos));

    const fmt = (players) =>
      players.map(p => `${p.playerName}${p.reason ? ` (${p.reason})` : ''}`).join(', ');
    const notesParts = [
      home.length > 0 ? `${fixture.home_team_id}: ${fmt(home)}` : null,
      away.length > 0 ? `${fixture.away_team_id}: ${fmt(away)}` : null,
    ].filter(Boolean);

    contexts.push({
      fixture_id:                       fixture.id,
      unavailable_home_players:         home.length,
      unavailable_home_attack_impact:   homeImpact.attack,
      unavailable_home_defense_impact:  homeImpact.defense,
      unavailable_away_players:         away.length,
      unavailable_away_attack_impact:   awayImpact.attack,
      unavailable_away_defense_impact:  awayImpact.defense,
      has_lineups:             false,
      has_odds:                false,
      has_availability_news:   true,
      notes:                   notesParts.join(' | ') || null,
      updated_at:              now,
    });
  }

  writeFileSync(outContexts, JSON.stringify(contexts, null, 2));
  console.log(`✓ Wrote ${contexts.length} fixture contexts → ${outContexts}`);
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
