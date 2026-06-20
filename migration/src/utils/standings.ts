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

// FIFA WC 2026 group tiebreaker: Pts → GD → GF → (H2H Pts → H2H GD → H2H GF) → lots
// H2H is omitted here; caller must handle when still tied after GF.
export function standingComparator(a: TeamStanding, b: TeamStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
  return b.goalsFor - a.goalsFor;
}

export function calculateGroupStandings(fixtures: Fixture[]): GroupStandings {
  const map: Record<string, Record<string, TeamStanding>> = {};

  for (const f of fixtures) {
    // Only group stage (ko: prefix = knockout)
    if (f.id.startsWith('ko:')) continue;
    if (!f.is_played || f.home_goals == null || f.away_goals == null) continue;

    const g = f.group_name;
    if (!map[g]) map[g] = {};

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
    result[g] = Object.values(teams).sort(standingComparator);
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
// Note: among third-place teams only results from their 3 group matches are compared.
export function rankThirdPlaceTeams(standings: GroupStandings, n = 8): TeamStanding[] {
  const thirds = (Object.values(standings).map(g => g[2]).filter(Boolean) as TeamStanding[])
    .sort(standingComparator);
  return thirds.slice(0, n);
}
