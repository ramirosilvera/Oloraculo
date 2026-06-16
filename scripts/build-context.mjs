#!/usr/bin/env node
/**
 * build-context.mjs — pre-builds fixture-contexts.json for the React app.
 *
 * Source: API-Football (api-sports.io) — has national-team injuries,
 * suspensions and squads with positions for the World Cup.
 *
 * Requires an API key in the API_FOOTBALL_KEY env var (free tier is enough:
 * this script makes ~2 + N requests where N = teams with injuries).
 * Get a key at https://www.api-football.com/ (or via RapidAPI).
 *
 * Tunable via env:
 *   API_FOOTBALL_KEY        (required) your api-sports.io key
 *   API_FOOTBALL_LEAGUE_ID  (default 1 = FIFA World Cup)
 *   API_FOOTBALL_SEASON     (default 2026)
 *   API_FOOTBALL_HOST       (default v3.football.api-sports.io)
 *
 * The position-impact table mirrors AvailabilityNewsService.cs:
 *   Attacker   → −3.5% goals scored
 *   Midfielder → −1.5% goals scored, −1.0% goals conceded
 *   Defender   → −0.4% goals scored, −2.5% goals conceded
 *   Goalkeeper → −5.0% goals conceded
 *
 * Outputs:
 *   migration/public/data/fixture-contexts.json  (per-fixture impacts)
 *   migration/public/data/squads.json            (team → players with positions)
 *
 * If no API key is set, or the API is unreachable, the script writes empty
 * files (preserving existing ones) and exits 0 so the deploy never breaks.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const API_KEY   = process.env.API_FOOTBALL_KEY ?? '';
const API_HOST  = process.env.API_FOOTBALL_HOST ?? 'v3.football.api-sports.io';
const LEAGUE_ID = process.env.API_FOOTBALL_LEAGUE_ID ?? '1';   // 1 = FIFA World Cup
const SEASON    = process.env.API_FOOTBALL_SEASON ?? '2026';

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
function slugify(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// API-Football already returns positions as full words; this just guards typos.
function normalizePosition(pos) {
  const p = (pos ?? '').trim().toLowerCase();
  if (p.startsWith('goalkeeper') || p === 'gk')   return 'Goalkeeper';
  if (p.startsWith('defen'))                        return 'Defender';
  if (p.startsWith('midfield'))                     return 'Midfielder';
  if (p.startsWith('attack') || p.startsWith('forward')) return 'Attacker';
  return 'Unknown';
}

// API-Football team names → our fixture slugs, where slugify alone would differ.
const TEAM_NAME_OVERRIDES = {
  'usa':                'united-states',
  'united-states':      'united-states',
  'korea-republic':     'south-korea',
  'republic-of-korea':  'south-korea',
  'south-korea':        'south-korea',
  'ir-iran':            'iran',
  'iran':               'iran',
  'china-pr':           'china',
  'cote-divoire':       'ivory-coast',
  'ivory-coast':        'ivory-coast',
  'dr-congo':           'congo-dr',
  'czech-republic':     'czechia',
  'czechia':            'czechia',
  'bosnia-and-herzegovina': 'bosnia-and-herzegovina',
  'trinidad-and-tobago':    'trinidad-and-tobago',
  'cape-verde':         'cape-verde',
};

function resolveTeamId(name) {
  const slug = slugify(name);
  return TEAM_NAME_OVERRIDES[slug] ?? slug;
}

// ── API-Football fetch helper ─────────────────────────────────────────────────
async function apiFootball(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://${API_HOST}/${path}`, {
      headers: { 'x-apisports-key': API_KEY },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length)) {
      console.warn(`  ⚠ API-Football errors for ${path}: ${JSON.stringify(json.errors)}`);
    }
    return json.response ?? [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const outContexts = resolve(__dirname, '../migration/public/data/fixture-contexts.json');
  const outSquads   = resolve(__dirname, '../migration/public/data/squads.json');

  if (!API_KEY) {
    console.log('No API_FOOTBALL_KEY set — skipping fetch, leaving context files untouched.');
    writeEmptyIfMissing();
    return;
  }

  // Load fixture list to know which team IDs we need
  const fixturesPath = resolve(__dirname, '../migration/public/data/fixtures.json');
  const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
  const allTeamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  console.log(`Working with ${fixtures.length} fixtures / ${allTeamIds.length} teams`);
  console.log(`Using API-Football league=${LEAGUE_ID} season=${SEASON}`);

  // ── 1. Teams: API-Football team ID → our slug ──────────────────────────────
  console.log('\n[1/3] Fetching tournament teams...');
  const apiIdToSlug = new Map();   // API-Football numeric team id → our slug
  try {
    const teams = await apiFootball(`teams?league=${LEAGUE_ID}&season=${SEASON}`);
    for (const entry of teams) {
      const t = entry.team ?? entry;
      if (t?.id) apiIdToSlug.set(t.id, resolveTeamId(t.name));
    }
    console.log(`  ✓ Mapped ${apiIdToSlug.size} teams`);
  } catch (e) {
    console.warn(`  ⚠ Teams fetch failed: ${e.message}`);
  }

  // ── 2. Injuries: one call for the whole tournament ─────────────────────────
  console.log('\n[2/3] Fetching injuries + suspensions...');
  // Map: our slug → Map<playerId, {name, reason, type, apiTeamId}>  (dedup per player)
  const injuredByTeam = new Map();
  try {
    const injuries = await apiFootball(`injuries?league=${LEAGUE_ID}&season=${SEASON}`);
    for (const inj of injuries) {
      const apiTeamId = inj.team?.id;
      const slug = apiIdToSlug.get(apiTeamId) ?? resolveTeamId(inj.team?.name);
      if (!allTeamIds.includes(slug)) continue; // not a team we care about
      const playerId = inj.player?.id;
      if (!playerId) continue;
      if (!injuredByTeam.has(slug)) injuredByTeam.set(slug, new Map());
      // Keep the most "definitive" record per player ("Missing Fixture" > "Questionable")
      const existing = injuredByTeam.get(slug).get(playerId);
      const isDefinitive = (inj.type ?? '').toLowerCase().includes('missing');
      if (!existing || isDefinitive) {
        injuredByTeam.get(slug).set(playerId, {
          name:      inj.player?.name ?? 'Desconocido',
          reason:    inj.reason ?? inj.type ?? 'Unknown',
          type:      inj.type ?? '',
          apiTeamId,
        });
      }
    }
    const totalPlayers = [...injuredByTeam.values()].reduce((n, m) => n + m.size, 0);
    console.log(`  ✓ ${totalPlayers} unavailable player(s) across ${injuredByTeam.size} team(s)`);
  } catch (e) {
    console.warn(`  ⚠ Injuries fetch failed: ${e.message}`);
  }

  // ── 3. Squads: only for teams that actually have injuries (saves quota) ─────
  console.log('\n[3/3] Fetching squads for affected teams (for positions)...');
  const squadsByTeamId = new Map();   // our slug → [{name, pos, playerId}]
  const positionByPlayer = new Map(); // playerId → normalized position
  for (const [slug, players] of injuredByTeam) {
    const apiTeamId = [...players.values()][0]?.apiTeamId;
    if (!apiTeamId) continue;
    try {
      const squads = await apiFootball(`players/squads?team=${apiTeamId}`);
      const roster = squads?.[0]?.players ?? [];
      const mapped = roster.map(p => ({
        name:     p.name,
        pos:      normalizePosition(p.position),
        playerId: p.id,
      }));
      squadsByTeamId.set(slug, mapped);
      for (const p of mapped) positionByPlayer.set(p.playerId, p.pos);
      await new Promise(r => setTimeout(r, 150)); // be polite to the API
    } catch (e) {
      console.warn(`  ⚠ Squad fetch failed for ${slug}: ${e.message}`);
    }
  }
  console.log(`  ✓ Loaded squads for ${squadsByTeamId.size} team(s)`);

  // ── 4. Build fixture-contexts.json ────────────────────────────────────────
  console.log('\nBuilding fixture contexts...');
  const now = new Date().toISOString();
  const contexts = [];

  // Resolve a team's unavailable players into {name, pos, reason}
  function resolveUnavailable(slug) {
    const players = injuredByTeam.get(slug);
    if (!players) return [];
    return [...players.entries()].map(([playerId, info]) => ({
      playerName: info.name,
      pos:        positionByPlayer.get(playerId) ?? 'Unknown',
      reason:     info.reason,
    }));
  }

  for (const fixture of fixtures) {
    if (fixture.is_played) continue;

    const home = resolveUnavailable(fixture.home_team_id);
    const away = resolveUnavailable(fixture.away_team_id);
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

  // ── 5. Save squads.json (positions per player) for fetched teams ───────────
  const squadsOut = {};
  for (const [teamId, players] of squadsByTeamId) {
    squadsOut[teamId] = players.map(p => ({ name: p.name, pos: p.pos }));
  }
  writeFileSync(outSquads, JSON.stringify(squadsOut, null, 2));
  console.log(`✓ Wrote squads for ${Object.keys(squadsOut).length} team(s) → ${outSquads}`);
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
