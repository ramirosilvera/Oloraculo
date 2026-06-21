// =============================================================================
// Oloráculo — Group standings calculator
// Used by bracket-generator.ts to determine R32 qualifiers.
// =============================================================================

import type { Fixture } from '../types/domain';

export interface TeamStanding {
  teamId: string;
  groupName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

export type GroupStandings = Record<string, TeamStanding[]>;

function blank(teamId: string, groupName: string): TeamStanding {
  return { teamId, groupName, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
}

// FIFA WC 2026 tiebreaker criterion 1-3 (all group matches): Pts → GD → GF
export function standingComparator(a: TeamStanding, b: TeamStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
  return b.goalsFor - a.goalsFor;
}

// H2H mini-table: only matches between the given team IDs count.
function h2hMiniTable(
  teamIds: string[],
  groupFixtures: Fixture[],
): Map<string, { pts: number; gd: number; gf: number }> {
  const ids = new Set(teamIds);
  const stats = new Map(teamIds.map(id => [id, { pts: 0, gd: 0, gf: 0 }]));
  for (const f of groupFixtures) {
    if (!ids.has(f.home_team_id) || !ids.has(f.away_team_id)) continue;
    if (f.home_goals == null || f.away_goals == null) continue;
    const h = stats.get(f.home_team_id)!;
    const a = stats.get(f.away_team_id)!;
    h.gf += f.home_goals;  h.gd += f.home_goals - f.away_goals;
    a.gf += f.away_goals;  a.gd += f.away_goals - f.home_goals;
    if (f.home_goals > f.away_goals)        { h.pts += 3; }
    else if (f.home_goals === f.away_goals) { h.pts++; a.pts++; }
    else                                    { a.pts += 3; }
  }
  return stats;
}

// Sort a group's standings applying FIFA criteria in full order:
//   1. Overall: Pts → GD → GF
//   2. H2H (for tied sub-group): h2h Pts → h2h GD → h2h GF
//   (fair play / FIFA rank omitted — caller may post-process if needed)
function sortWithH2H(rows: TeamStanding[], groupFixtures: Fixture[]): TeamStanding[] {
  const sorted = [...rows].sort(standingComparator);
  const result: TeamStanding[] = [];
  let i = 0;
  while (i < sorted.length) {
    // Find how many consecutive teams share the same overall position
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].points   === sorted[i].points &&
      sorted[j].goalDiff === sorted[i].goalDiff &&
      sorted[j].goalsFor === sorted[i].goalsFor
    ) j++;
    if (j - i === 1) {
      result.push(sorted[i]);
    } else {
      // Tied group: apply H2H criteria
      const tied = sorted.slice(i, j);
      const h2h  = h2hMiniTable(tied.map(t => t.teamId), groupFixtures);
      result.push(...[...tied].sort((a, b) => {
        const ha = h2h.get(a.teamId)!;
        const hb = h2h.get(b.teamId)!;
        if (hb.pts !== ha.pts) return hb.pts - ha.pts;
        if (hb.gd  !== ha.gd)  return hb.gd  - ha.gd;
        return hb.gf - ha.gf;
      }));
    }
    i = j;
  }
  return result;
}

export function calculateGroupStandings(fixtures: Fixture[]): GroupStandings {
  const map: Record<string, Record<string, TeamStanding>> = {};
  const byGroup: Record<string, Fixture[]> = {};

  for (const f of fixtures) {
    // Only group stage (ko: prefix = knockout)
    if (f.id.startsWith('ko:')) continue;
    if (!f.is_played || f.home_goals == null || f.away_goals == null) continue;

    const g = f.group_name;
    if (!map[g]) map[g] = {};
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(f);

    const h = (map[g][f.home_team_id] ??= blank(f.home_team_id, g));
    const a = (map[g][f.away_team_id] ??= blank(f.away_team_id, g));

    h.played++; a.played++;
    h.goalsFor += f.home_goals;   h.goalsAgainst += f.away_goals;
    a.goalsFor += f.away_goals;   a.goalsAgainst += f.home_goals;
    h.goalDiff = h.goalsFor - h.goalsAgainst;
    a.goalDiff = a.goalsFor - a.goalsAgainst;

    if (f.home_goals > f.away_goals)        { h.won++;  h.points += 3; a.lost++; }
    else if (f.home_goals === f.away_goals) { h.drawn++; h.points++;   a.drawn++; a.points++; }
    else                                    { a.won++;  a.points += 3; h.lost++; }
  }

  const result: GroupStandings = {};
  for (const [g, teams] of Object.entries(map)) {
    result[g] = sortWithH2H(Object.values(teams), byGroup[g] ?? []);
  }
  return result;
}

export function getGroupWinner(standings: GroupStandings, group: string): string {
  return standings[group]?.[0]?.teamId ?? '';
}

export function getGroupRunnerUp(standings: GroupStandings, group: string): string {
  return standings[group]?.[1]?.teamId ?? '';
}

export function getGroupThirdPlace(standings: GroupStandings, group: string): TeamStanding | undefined {
  return standings[group]?.[2];
}

// Returns the N best third-place teams sorted by FIFA criteria (Pts → GD → GF).
// H2H does not apply here — these are teams from different groups.
export function rankThirdPlaceTeams(standings: GroupStandings, n = 8): TeamStanding[] {
  const thirds = (Object.values(standings).map(g => g[2]).filter(Boolean) as TeamStanding[])
    .sort(standingComparator);
  return thirds.slice(0, n);
}
