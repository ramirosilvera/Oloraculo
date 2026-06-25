// =============================================================================
// Oloráculo — Knockout bracket generator
//
// ACTIVATION CHECKLIST (run when all 48 group matches are played):
//   1. Call generateR32Fixtures(groupFixtures, thirdPlaceAssignments)
//   2. Write output to public/data/knockout-fixtures.json
//   3. Commit & push
//
// thirdPlaceAssignments: map the 8 best third-place team IDs to their R32 match slots.
// FIFA publishes the slot table after groups end — check:
//   https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026
// =============================================================================

import type { Fixture } from '../types/domain';
import {
  calculateGroupStandings,
  getGroupWinner,
  getGroupRunnerUp,
  rankThirdPlaceTeams,
} from './standings';

// R32 fixed crossings confirmed from FIFA schedule (source: search Jun 2026)
// Format: [homeSlot, awaySlot, matchId, kickoffUTC, venue, city]
const FIXED_R32_SLOTS = [
  ['1A', '2B', 'ko:r32:m73', '2026-06-28T23:00:00Z', 'Gillette Stadium',        'Foxborough'    ],
  ['1B', '2A', 'ko:r32:m74', '2026-06-29T02:00:00Z', 'AT&T Stadium',             'Arlington'     ],
  ['1C', '2D', 'ko:r32:m75', '2026-06-29T19:00:00Z', 'Estadio BBVA',             'Monterrey'     ],
  ['1D', '2C', 'ko:r32:m76', '2026-06-30T02:00:00Z', 'NRG Stadium',              'Houston'       ],
  ['1E', '2F', 'ko:r32:m77', '2026-06-30T19:00:00Z', 'Estadio Azteca',           'Ciudad de México'],
  ['1F', '2E', 'ko:r32:m78', '2026-07-01T02:00:00Z', 'Mercedes-Benz Stadium',    'Atlanta'       ],
  ['1G', '2I', 'ko:r32:m79', '2026-07-01T19:00:00Z', "Levi's Stadium",           'Santa Clara'   ],
  ['1I', '2G', 'ko:r32:m80', '2026-07-02T02:00:00Z', 'Lumen Field',              'Seattle'       ],
  ['1H', '2J', 'ko:r32:m81', '2026-07-02T19:00:00Z', 'BMO Field',                'Toronto'       ],
  ['1J', '2H', 'ko:r32:m82', '2026-07-03T02:00:00Z', 'Hard Rock Stadium',        'Miami Gardens' ],
  ['1K', '2L', 'ko:r32:m83', '2026-07-03T19:00:00Z', 'Arrowhead Stadium',        'Kansas City'   ],
  ['1L', '2K', 'ko:r32:m84', '2026-07-04T02:00:00Z', 'SoFi Stadium',             'Inglewood'     ],
] as const;

// R16 pairings: determined by which R32 match winners face each other.
// Bracket side: Left (M73-M80) vs Right (M81-M88)
// Pattern: winner of M73 faces winner of M74, etc.
const R16_PAIRINGS = [
  ['ko:r16:m89', 'ko:r32:m73', 'ko:r32:m74', '2026-07-05T23:00:00Z'],
  ['ko:r16:m90', 'ko:r32:m75', 'ko:r32:m76', '2026-07-06T02:00:00Z'],
  ['ko:r16:m91', 'ko:r32:m77', 'ko:r32:m78', '2026-07-06T23:00:00Z'],
  ['ko:r16:m92', 'ko:r32:m79', 'ko:r32:m80', '2026-07-07T02:00:00Z'],
  ['ko:r16:m93', 'ko:r32:m81', 'ko:r32:m82', '2026-07-07T23:00:00Z'],
  ['ko:r16:m94', 'ko:r32:m83', 'ko:r32:m84', '2026-07-08T02:00:00Z'],
  ['ko:r16:m95', 'ko:r32:m85', 'ko:r32:m86', '2026-07-08T23:00:00Z'],
  ['ko:r16:m96', 'ko:r32:m87', 'ko:r32:m88', '2026-07-09T02:00:00Z'],
] as const;

const QF_PAIRINGS = [
  ['ko:qf:m97', 'ko:r16:m89', 'ko:r16:m90', '2026-07-10T23:00:00Z'],
  ['ko:qf:m98', 'ko:r16:m91', 'ko:r16:m92', '2026-07-11T02:00:00Z'],
  ['ko:qf:m99', 'ko:r16:m93', 'ko:r16:m94', '2026-07-11T23:00:00Z'],
  ['ko:qf:m100','ko:r16:m95', 'ko:r16:m96', '2026-07-12T02:00:00Z'],
] as const;

const SF_PAIRINGS = [
  ['ko:sf:m101', 'ko:qf:m97',  'ko:qf:m98',  '2026-07-14T23:00:00Z'],
  ['ko:sf:m102', 'ko:qf:m99',  'ko:qf:m100', '2026-07-15T23:00:00Z'],
] as const;

const FINAL = ['ko:final:m104', 'ko:sf:m101', 'ko:sf:m102', '2026-07-19T23:00:00Z'] as const;
const THIRD_PLACE = ['ko:3rdplace:m103', 'ko:sf:m101', 'ko:sf:m102', '2026-07-18T23:00:00Z'] as const;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface KnockoutFixture extends Omit<Fixture, 'group_name'> {
  group_name: string;           // repurposed: 'R32' | 'R16' | 'QF' | 'SF' | 'FINAL' | '3RDPLACE'
  round: string;                // same value, explicit alias
  home_slot: string;            // e.g. '1A', '2B', '3rd-place-1', 'W(m73)'
  away_slot: string;
}

// thirdPlaceAssignments: ordered list of 8 team IDs (best to worst 3rd-place),
// mapped to slots m85…m88 in pairs: [m85_home, m85_away, m86_home, m86_away, ...]
// FIFA publishes this table after group stage closes.
export type ThirdPlaceAssignments = [string, string, string, string, string, string, string, string];

// ─────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────

/**
 * Generates the complete knockout fixture list ready to write to knockout-fixtures.json.
 *
 * @param groupFixtures  All 72 played group-stage Fixture objects (is_played: true).
 * @param thirdPlaceAssignments  8 team IDs in FIFA-assigned R32 slot order [m85h,m85a,m86h,m86a,m87h,m87a,m88h,m88a].
 *                               Get this from FIFA's official post-group-stage bracket announcement.
 */
export function generateKnockoutFixtures(
  groupFixtures: Fixture[],
  thirdPlaceAssignments: ThirdPlaceAssignments,
): KnockoutFixture[] {
  const standings = calculateGroupStandings(groupFixtures);
  const fixtures: KnockoutFixture[] = [];

  // Helper: resolve slot label → team ID
  function resolveSlot(slot: string): string {
    const m = slot.match(/^([12])([A-L])$/);
    if (m) {
      return m[1] === '1'
        ? getGroupWinner(standings, m[2])
        : getGroupRunnerUp(standings, m[2]);
    }
    return slot; // unknown — caller must patch
  }

  // ── R32 fixed matches (12) ──────────────────────────────────
  for (const [homeSlot, awaySlot, id, kickoff, venue, city] of FIXED_R32_SLOTS) {
    fixtures.push({
      id,
      group_name: 'R32',
      round: 'R32',
      home_slot: homeSlot,
      away_slot: awaySlot,
      home_team_id: resolveSlot(homeSlot),
      away_team_id: resolveSlot(awaySlot),
      neutral_venue: true,
      kickoff_utc: kickoff,
      venue,
      city,
      is_played: false,
      home_goals: null,
      away_goals: null,
    });
  }

  // ── R32 variable matches (4): 8 best 3rd-place teams ────────
  // thirdPlaceAssignments order follows FIFA's official post-group slot table.
  // Verify against: https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026
  const [t1h, t1a, t2h, t2a, t3h, t3a, t4h, t4a] = thirdPlaceAssignments;
  const variableR32 = [
    ['ko:r32:m85', t1h, t1a, '3rd-place-1', '3rd-place-2', '2026-07-01T23:00:00Z', 'TBD', 'TBD'],
    ['ko:r32:m86', t2h, t2a, '3rd-place-3', '3rd-place-4', '2026-07-02T23:00:00Z', 'TBD', 'TBD'],
    ['ko:r32:m87', t3h, t3a, '3rd-place-5', '3rd-place-6', '2026-07-03T23:00:00Z', 'TBD', 'TBD'],
    ['ko:r32:m88', t4h, t4a, '3rd-place-7', '3rd-place-8', '2026-07-04T23:00:00Z', 'TBD', 'TBD'],
  ];
  for (const [id, homeTeam, awayTeam, hSlot, aSlot, kickoff, venue, city] of variableR32) {
    fixtures.push({
      id, group_name: 'R32', round: 'R32',
      home_slot: hSlot, away_slot: aSlot,
      home_team_id: homeTeam, away_team_id: awayTeam,
      neutral_venue: true, kickoff_utc: kickoff, venue, city,
      is_played: false, home_goals: null, away_goals: null,
    });
  }

  // ── R16 (8) ──────────────────────────────────────────────────
  for (const [id, homeSource, awaySource, kickoff] of R16_PAIRINGS) {
    fixtures.push({
      id, group_name: 'R16', round: 'R16',
      home_slot: `W(${homeSource})`, away_slot: `W(${awaySource})`,
      home_team_id: '', away_team_id: '',
      neutral_venue: true, kickoff_utc: kickoff, venue: 'TBD', city: 'TBD',
      is_played: false, home_goals: null, away_goals: null,
    });
  }

  // ── Quarterfinals (4) ─────────────────────────────────────────
  for (const [id, homeSource, awaySource, kickoff] of QF_PAIRINGS) {
    fixtures.push({
      id, group_name: 'QF', round: 'QF',
      home_slot: `W(${homeSource})`, away_slot: `W(${awaySource})`,
      home_team_id: '', away_team_id: '',
      neutral_venue: true, kickoff_utc: kickoff, venue: 'TBD', city: 'TBD',
      is_played: false, home_goals: null, away_goals: null,
    });
  }

  // ── Semifinals (2) ────────────────────────────────────────────
  for (const [id, homeSource, awaySource, kickoff] of SF_PAIRINGS) {
    fixtures.push({
      id, group_name: 'SF', round: 'SF',
      home_slot: `W(${homeSource})`, away_slot: `W(${awaySource})`,
      home_team_id: '', away_team_id: '',
      neutral_venue: true, kickoff_utc: kickoff, venue: 'TBD', city: 'TBD',
      is_played: false, home_goals: null, away_goals: null,
    });
  }

  // ── 3rd place (1) ─────────────────────────────────────────────
  fixtures.push({
    id: THIRD_PLACE[0], group_name: '3RDPLACE', round: '3RDPLACE',
    home_slot: `L(${THIRD_PLACE[1]})`, away_slot: `L(${THIRD_PLACE[2]})`,
    home_team_id: '', away_team_id: '',
    neutral_venue: true, kickoff_utc: THIRD_PLACE[3], venue: 'TBD', city: 'TBD',
    is_played: false, home_goals: null, away_goals: null,
  });

  // ── Final (1) ─────────────────────────────────────────────────
  fixtures.push({
    id: FINAL[0], group_name: 'FINAL', round: 'FINAL',
    home_slot: `W(${FINAL[1]})`, away_slot: `W(${FINAL[2]})`,
    home_team_id: '', away_team_id: '',
    neutral_venue: true, kickoff_utc: FINAL[3],
    venue: 'MetLife Stadium', city: 'East Rutherford',
    is_played: false, home_goals: null, away_goals: null,
  });

  return fixtures;
}

// ─────────────────────────────────────────────────────────────
// Quick standings summary — useful for activation console log
// ─────────────────────────────────────────────────────────────

export function printBracketSummary(groupFixtures: Fixture[]): void {
  const standings = calculateGroupStandings(groupFixtures);
  const thirds = rankThirdPlaceTeams(standings, 8);

  console.log('\n=== WC 2026 R32 QUALIFIERS ===');
  for (const group of 'ABCDEFGHIJKL'.split('')) {
    const s = standings[group];
    if (!s) continue;
    console.log(`Group ${group}: 1st=${s[0]?.teamId} 2nd=${s[1]?.teamId} 3rd=${s[2]?.teamId}(${s[2]?.points}pts)`);
  }
  console.log('\n=== BEST 8 THIRD-PLACE ===');
  thirds.forEach((t, i) => console.log(`  ${i + 1}. ${t.teamId} (Grp ${t.groupName}) — ${t.points}pts ${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}GD ${t.goalsFor}GF`));
  console.log('\nNow check FIFA slot table and call generateKnockoutFixtures() with thirdPlaceAssignments.');
}
