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

// R32 confirmed crossings — official FIFA WC 2026 draw
// Format: [homeSlot, awaySlot, matchId, kickoffUTC, venue, city]
// homeSlot/awaySlot: '1X'=winner, '2X'=runner-up, 'T3'=best 3rd (assigned post-groups)
const FIXED_R32_SLOTS = [
  ['2A', '2B', 'ko:r32:m73', '2026-06-28T23:00:00Z', 'Gillette Stadium',     'Foxborough'    ],
  ['1E', 'T3', 'ko:r32:m74', '2026-06-29T02:00:00Z', 'AT&T Stadium',         'Arlington'     ],  // T3 from A/B/C/D/F
  ['1F', '2C', 'ko:r32:m75', '2026-06-29T19:00:00Z', 'Estadio BBVA',         'Monterrey'     ],
  ['1C', '2F', 'ko:r32:m76', '2026-06-30T02:00:00Z', 'NRG Stadium',          'Houston'       ],
  ['1I', 'T3', 'ko:r32:m77', '2026-06-30T19:00:00Z', 'Estadio Azteca',       'Ciudad de México'],  // T3 from C/D/F/G/H
  ['2E', '2I', 'ko:r32:m78', '2026-07-01T02:00:00Z', 'Mercedes-Benz Stadium','Atlanta'       ],
  ['1A', 'T3', 'ko:r32:m79', '2026-07-01T19:00:00Z', "Levi's Stadium",       'Santa Clara'   ],  // T3 from C/E/F/H/I
  ['1L', 'T3', 'ko:r32:m80', '2026-07-02T02:00:00Z', 'Lumen Field',          'Seattle'       ],  // T3 from E/H/I/J/K
  ['1D', 'T3', 'ko:r32:m81', '2026-07-02T19:00:00Z', 'BMO Field',            'Toronto'       ],  // T3 from B/E/F/I/J
  ['1G', 'T3', 'ko:r32:m82', '2026-07-03T02:00:00Z', 'Hard Rock Stadium',    'Miami Gardens' ],  // T3 from A/E/H/I/J
  ['2K', '2L', 'ko:r32:m83', '2026-07-03T19:00:00Z', 'Arrowhead Stadium',    'Kansas City'   ],
  ['1H', '2J', 'ko:r32:m84', '2026-07-04T02:00:00Z', 'SoFi Stadium',         'Inglewood'     ],
  ['1B', 'T3', 'ko:r32:m85', '2026-07-04T19:00:00Z', 'TBD',                  'TBD'           ],  // T3 from E/F/G/I/J
  ['1J', '2H', 'ko:r32:m86', '2026-07-05T02:00:00Z', 'TBD',                  'TBD'           ],
  ['1K', 'T3', 'ko:r32:m87', '2026-07-05T19:00:00Z', 'TBD',                  'TBD'           ],  // T3 from D/E/I/J/L
  ['2D', '2G', 'ko:r32:m88', '2026-07-06T02:00:00Z', 'TBD',                  'TBD'           ],
] as const;

// R16 pairings: confirmed from FIFA schedule (source: worldcupkickofftimes.com, wikipedia)
const R16_PAIRINGS = [
  ['ko:r16:m89', 'ko:r32:m74', 'ko:r32:m77', '2026-07-05T23:00:00Z'],  // W(1E/T3) vs W(1I/T3)
  ['ko:r16:m90', 'ko:r32:m73', 'ko:r32:m75', '2026-07-06T02:00:00Z'],  // W(2A/2B) vs W(1F/2C)
  ['ko:r16:m91', 'ko:r32:m76', 'ko:r32:m78', '2026-07-06T23:00:00Z'],  // W(1C/2F) vs W(2E/2I)
  ['ko:r16:m92', 'ko:r32:m79', 'ko:r32:m80', '2026-07-07T02:00:00Z'],  // W(1A/T3) vs W(1L/T3)
  ['ko:r16:m93', 'ko:r32:m83', 'ko:r32:m84', '2026-07-07T23:00:00Z'],  // W(2K/2L) vs W(1H/2J)
  ['ko:r16:m94', 'ko:r32:m81', 'ko:r32:m82', '2026-07-08T02:00:00Z'],  // W(1D/T3) vs W(1G/T3)
  ['ko:r16:m95', 'ko:r32:m86', 'ko:r32:m88', '2026-07-08T23:00:00Z'],  // W(1J/2H) vs W(2D/2G)
  ['ko:r16:m96', 'ko:r32:m85', 'ko:r32:m87', '2026-07-09T02:00:00Z'],  // W(1B/T3) vs W(1K/T3)
] as const;

const QF_PAIRINGS = [
  ['ko:qf:m97', 'ko:r16:m89', 'ko:r16:m90', '2026-07-10T23:00:00Z'],
  ['ko:qf:m98', 'ko:r16:m91', 'ko:r16:m92', '2026-07-11T02:00:00Z'],
  ['ko:qf:m99', 'ko:r16:m93', 'ko:r16:m94', '2026-07-11T23:00:00Z'],
  ['ko:qf:m100','ko:r16:m95', 'ko:r16:m96', '2026-07-12T02:00:00Z'],
] as const;

const SF_PAIRINGS = [
  ['ko:sf:m101', 'ko:qf:m97',  'ko:qf:m99',  '2026-07-14T23:00:00Z'],  // SF A: left QFs
  ['ko:sf:m102', 'ko:qf:m98',  'ko:qf:m100', '2026-07-15T23:00:00Z'],  // SF B: right QFs
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

// thirdPlaceAssignments: maps each T3 slot match ID → the qualified 3rd-place team ID.
// The 8 T3 slots are: m74, m77, m79, m80, m81, m82, m85, m87 (each faces a group winner).
// FIFA publishes the slot assignments after group stage closes (Annex C of the draw).
export type ThirdPlaceAssignments = {
  m74: string;  // T3 from groups A/B/C/D/F — faces 1E
  m77: string;  // T3 from groups C/D/F/G/H — faces 1I
  m79: string;  // T3 from groups C/E/F/H/I — faces 1A
  m80: string;  // T3 from groups E/H/I/J/K — faces 1L
  m81: string;  // T3 from groups B/E/F/I/J — faces 1D
  m82: string;  // T3 from groups A/E/H/I/J — faces 1G
  m85: string;  // T3 from groups E/F/G/I/J — faces 1B
  m87: string;  // T3 from groups D/E/I/J/L — faces 1K
};

// ─────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────

/**
 * Generates the complete knockout fixture list ready to write to knockout-fixtures.json.
 *
 * @param groupFixtures  All 72 played group-stage Fixture objects (is_played: true).
 * @param thirdPlaceAssignments  Object mapping each T3 slot match key to the qualified 3rd-place team ID.
 *                               Keys: m74, m77, m79, m80, m81, m82, m85, m87 (see ThirdPlaceAssignments type).
 *                               Get slot assignments from FIFA's official post-group-stage Annex C announcement.
 */
export function generateKnockoutFixtures(
  groupFixtures: Fixture[],
  thirdPlaceAssignments: ThirdPlaceAssignments,
): KnockoutFixture[] {
  const standings = calculateGroupStandings(groupFixtures);
  const fixtures: KnockoutFixture[] = [];

  // Helper: resolve slot label → team ID
  // '1X' = group winner, '2X' = runner-up, 'T3' = resolved from thirdPlaceAssignments
  function resolveSlot(slot: string, matchId: string): string {
    const m = slot.match(/^([12])([A-L])$/);
    if (m) {
      return m[1] === '1'
        ? getGroupWinner(standings, m[2])
        : getGroupRunnerUp(standings, m[2]);
    }
    if (slot === 'T3') {
      const key = matchId.replace('ko:r32:', '') as keyof ThirdPlaceAssignments;
      return thirdPlaceAssignments[key] ?? '';
    }
    return slot; // unknown — caller must patch
  }

  // ── R32 matches (16): fixed pairs + Winner×T3 assignments ──────────────────
  for (const [homeSlot, awaySlot, id, kickoff, venue, city] of FIXED_R32_SLOTS) {
    fixtures.push({
      id,
      group_name: 'R32',
      round: 'R32',
      home_slot: homeSlot,
      away_slot: awaySlot,
      home_team_id: resolveSlot(homeSlot, id),
      away_team_id: resolveSlot(awaySlot, id),
      neutral_venue: true,
      kickoff_utc: kickoff,
      venue,
      city,
      is_played: false,
      home_goals: null,
      away_goals: null,
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
