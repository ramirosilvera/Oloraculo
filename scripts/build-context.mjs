#!/usr/bin/env node
/**
 * build-context.mjs — pre-builds fixture-contexts.json for the React app.
 *
 * Sources:
 *   OpenFootball (CC0) → squad rosters with player positions
 *   ESPN hidden API    → WC2026 injury data (no key required)
 *
 * The position-impact table mirrors AvailabilityNewsService.cs:
 *   Attacker  → −3.5% goals scored
 *   Midfielder → −1.5% goals scored, −1.0% goals conceded
 *   Defender  → −0.4% goals scored, −2.5% goals conceded
 *   Goalkeeper → −5.0% goals conceded
 *
 * Outputs:
 *   migration/public/data/fixture-contexts.json  (per-fixture impacts)
 *   migration/public/data/squads.json            (team → players with positions)
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function normalizePlayerKey(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

// OpenFootball position abbreviations → normalized labels
function normalizeOFPos(pos) {
  const p = (pos ?? '').trim().toUpperCase();
  if (p === 'GK')                                          return 'Goalkeeper';
  if (['DF', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p)) return 'Defender';
  if (['MF', 'CM', 'DM', 'AM', 'CDM', 'CAM', 'LM', 'RM'].includes(p)) return 'Midfielder';
  if (['FW', 'ST', 'CF', 'LW', 'RW', 'SS', 'ATT'].includes(p)) return 'Attacker';
  return 'Unknown';
}

// ESPN position abbreviations → normalized labels
function normalizeESPNPos(abbr) {
  const p = (abbr ?? '').trim().toUpperCase();
  if (p === 'GK')                           return 'Goalkeeper';
  if (['D', 'CB', 'LB', 'RB', 'DF'].includes(p)) return 'Defender';
  if (['M', 'CM', 'DM', 'AM', 'MF'].includes(p)) return 'Midfielder';
  if (['F', 'ST', 'CF', 'LW', 'RW', 'FW'].includes(p)) return 'Attacker';
  return 'Unknown';
}

// Manual overrides for teams where slug-match would fail
const TEAM_NAME_OVERRIDES = {
  'usa':             'united-states',
  'united-states':   'united-states',
  'us':              'united-states',
  'republic-of-korea': 'south-korea',
  'korea-republic':  'south-korea',
  'ir-iran':         'iran',
  'china-pr':        'china',
  'cote-divoire':    'ivory-coast',
  'ivory-coast':     'ivory-coast',
  'democratic-republic-of-congo': 'congo-dr',
  'dr-congo':        'congo-dr',
  'czechia':         'czechia',
  'czech-republic':  'czechia',
  'bosnia-and-herzegovina': 'bosnia-and-herzegovina',
  'bosnia-herzegovina': 'bosnia-and-herzegovina',
  'trinidad-and-tobago': 'trinidad-and-tobago',
  'new-zealand':     'new-zealand',
  'saudi-arabia':    'saudi-arabia',
  'cape-verde':      'cape-verde',
  'curacao':         'curacao',
};

function resolveTeamId(name) {
  const slug = slugify(name);
  return TEAM_NAME_OVERRIDES[slug] ?? slug;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fuzzy player name match: returns true if two keys share enough characters
function playerNamesMatch(keyA, keyB) {
  if (keyA === keyB) return true;
  // Check if one contains the other (handles short names / abbreviations)
  if (keyA.length > 4 && keyB.includes(keyA)) return true;
  if (keyB.length > 4 && keyA.includes(keyB)) return true;
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const outContexts = resolve(__dirname, '../migration/public/data/fixture-contexts.json');
  const outSquads   = resolve(__dirname, '../migration/public/data/squads.json');

  // Load fixture list to know which team IDs we need
  const fixturesPath = resolve(__dirname, '../migration/public/data/fixtures.json');
  const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
  const allTeamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  console.log(`Working with ${fixtures.length} fixtures / ${allTeamIds.length} teams`);

  // ── 1. OpenFootball squads ─────────────────────────────────────────────────
  // Map: our team ID → [{name, key, pos}]
  const squadsByTeamId = new Map();
  try {
    console.log('\n[1/3] Fetching OpenFootball squads...');
    const data = await fetchJson(
      'https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.squads.json'
    );
    // Format: [{name: "Group A", teams: [{name: "USA", players: [{number, pos, name, ...}]}]}]
    for (const group of (Array.isArray(data) ? data : [])) {
      for (const team of (group.teams ?? [])) {
        const id = resolveTeamId(team.name);
        const players = (team.players ?? []).map(p => ({
          name: p.name,
          key:  normalizePlayerKey(p.name),
          pos:  normalizeOFPos(p.pos),
        }));
        squadsByTeamId.set(id, players);
      }
    }
    console.log(`  ✓ Loaded squads for ${squadsByTeamId.size} teams`);
  } catch (e) {
    console.warn(`  ⚠ OpenFootball fetch failed: ${e.message}`);
  }

  // ── 2. ESPN: team IDs for WC2026 ──────────────────────────────────────────
  // Map: our team ID → ESPN numeric team ID
  const espnTeamIdMap = new Map();
  try {
    console.log('\n[2/3] Fetching ESPN teams for fifa.world...');
    const data = await fetchJson(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?limit=200'
    );
    const teamsList = data.sports?.[0]?.leagues?.[0]?.teams ?? data.teams ?? [];
    for (const entry of teamsList) {
      const t = entry.team ?? entry;
      const displayName = t.displayName ?? t.name ?? '';
      const id = resolveTeamId(displayName);
      if (t.id) espnTeamIdMap.set(id, String(t.id));
    }
    console.log(`  ✓ Mapped ${espnTeamIdMap.size} ESPN team IDs`);
  } catch (e) {
    console.warn(`  ⚠ ESPN teams fetch failed: ${e.message}`);
  }

  // ── 3. ESPN: injuries per team ─────────────────────────────────────────────
  // Map: our team ID → [{playerName, playerKey, pos}] (unavailable players)
  const injuriesByTeam = new Map();
  if (espnTeamIdMap.size > 0) {
    console.log('\n[3/3] Fetching ESPN injuries...');
    for (const teamId of allTeamIds) {
      const espnId = espnTeamIdMap.get(teamId);
      if (!espnId) {
        // Try alternate slugs (ESPN might use different names)
        continue;
      }
      try {
        const data = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${espnId}/injuries`
        );
        const raw = data.injuries ?? data.items ?? [];
        const injuries = raw.map(inj => {
          const athleteName = inj.athlete?.displayName ?? inj.athlete?.fullName ?? inj.displayName ?? '';
          const espnPos     = inj.athlete?.position?.abbreviation ?? '';
          // Try to get position from squad data first, fall back to ESPN position
          const squad = squadsByTeamId.get(teamId) ?? [];
          const pKey = normalizePlayerKey(athleteName);
          const squadPlayer = squad.find(p => playerNamesMatch(p.key, pKey));
          const pos = squadPlayer?.pos ?? normalizeESPNPos(espnPos) ?? 'Unknown';
          return { playerName: athleteName, playerKey: pKey, pos };
        }).filter(inj => inj.playerName);

        if (injuries.length > 0) {
          injuriesByTeam.set(teamId, injuries);
          console.log(`    ${teamId}: ${injuries.length} injury record(s)`);
        }
        await new Promise(r => setTimeout(r, 120)); // be polite
      } catch {
        // Per-team failure is OK — continue
      }
    }
    console.log(`  Injury data for ${injuriesByTeam.size}/${allTeamIds.length} teams`);
  } else {
    console.log('\n[3/3] Skipping ESPN injuries (no team IDs)');
  }

  // ── 4. Build fixture-contexts.json ────────────────────────────────────────
  console.log('\nBuilding fixture contexts...');
  const now = new Date().toISOString();
  const contexts = [];

  for (const fixture of fixtures) {
    if (fixture.is_played) continue; // already played, skip

    const homeInjuries = injuriesByTeam.get(fixture.home_team_id) ?? [];
    const awayInjuries = injuriesByTeam.get(fixture.away_team_id) ?? [];
    if (homeInjuries.length === 0 && awayInjuries.length === 0) continue;

    const homeImpact = sumImpacts(homeInjuries.map(i => i.pos));
    const awayImpact = sumImpacts(awayInjuries.map(i => i.pos));

    const notesParts = [
      homeInjuries.length > 0 ? `${fixture.home_team_id}: ${homeInjuries.map(i => i.playerName).join(', ')}` : null,
      awayInjuries.length > 0 ? `${fixture.away_team_id}: ${awayInjuries.map(i => i.playerName).join(', ')}` : null,
    ].filter(Boolean);

    contexts.push({
      fixture_id:                       fixture.id,
      unavailable_home_players:         homeInjuries.length,
      unavailable_home_attack_impact:   homeImpact.attack,
      unavailable_home_defense_impact:  homeImpact.defense,
      unavailable_away_players:         awayInjuries.length,
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

  // ── 5. Save squads.json for frontend use ──────────────────────────────────
  const squadsOut = {};
  for (const [teamId, players] of squadsByTeamId) squadsOut[teamId] = players;
  writeFileSync(outSquads, JSON.stringify(squadsOut, null, 2));
  console.log(`✓ Wrote squads for ${Object.keys(squadsOut).length} teams → ${outSquads}`);
}

main().catch(e => {
  console.error('build-context failed:', e.message);
  // Always write empty files so the app build doesn't break
  const base = resolve(dirname(fileURLToPath(import.meta.url)), '../migration/public/data');
  for (const [file, val] of [['fixture-contexts.json', '[]'], ['squads.json', '{}']]) {
    const p = `${base}/${file}`;
    if (!existsSync(p)) writeFileSync(p, val);
  }
  process.exit(0); // Don't fail the CI build
});
