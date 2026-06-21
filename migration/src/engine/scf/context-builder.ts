// =============================================================================
// SCF — builds SCFMatchContext from the existing app data hooks
// =============================================================================

import type { Fixture, Rating, Team, WcActualResult } from '../../types/domain';
import type { SquadStrengthEntry } from '../../types/domain';
import type { SCFMatchContext } from '../../types/scf';
import { buildSquadStrengthMap } from '../models/squad-strength-model';

const DEFENDING_CHAMPION = 'argentina';
const HOST_NATIONS = new Set(['usa', 'united-states', 'mexico', 'canada']);

const KNOCKOUT_GROUP_NAMES = new Set([
  'R32', 'R16', 'QF', 'SF', 'F', 'Third',
  'Dieciséisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final',
]);

function isKnockoutPhase(groupName: string): boolean {
  if (!groupName) return false;
  if (KNOCKOUT_GROUP_NAMES.has(groupName)) return true;
  const upper = groupName.toUpperCase();
  return (
    upper.startsWith('R16') ||
    upper.startsWith('R32') ||
    upper.startsWith('QF') ||
    upper.startsWith('SF') ||
    upper === 'F' ||
    upper.includes('KNOCKOUT') ||
    upper.includes('ELIMINAT')
  );
}

interface TournamentForm {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

function computeTournamentForm(
  teamId: string,
  fixtures: Fixture[],
  wcResults: WcActualResult[],
): TournamentForm {
  const playedMap = new Map(wcResults.map(r => [r.fixture_id, r]));
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
  for (const f of fixtures) {
    const result = playedMap.get(f.id);
    if (!result) continue;
    const isHome = f.home_team_id === teamId;
    const isAway = f.away_team_id === teamId;
    if (!isHome && !isAway) continue;
    const gf = isHome ? result.home_goals : result.away_goals;
    const ga = isHome ? result.away_goals : result.home_goals;
    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) wins++;
    else if (gf === ga) draws++;
    else losses++;
  }
  return { wins, draws, losses, goalsFor, goalsAgainst };
}

function getElo(teamId: string, ratings: Rating[]): number {
  // Use the most recent Elo rating for the team
  let best: Rating | null = null;
  for (const r of ratings) {
    if (r.team_id !== teamId || r.type !== 'elo') continue;
    if (!best || r.as_of > best.as_of) best = r;
  }
  return best?.value ?? 1500;
}

function computeSquadStrengths(
  homeId: string,
  awayId: string,
  squadStrengthData: Record<string, SquadStrengthEntry>,
): { home: number; away: number } {
  const rawMap = buildSquadStrengthMap(squadStrengthData);
  if (rawMap.size === 0) return { home: 0.5, away: 0.5 };

  // Compute normalized scores (same logic as squad-strength-model)
  let maxValue = 0;
  for (const entry of rawMap.values()) {
    if (entry.market_value_m > maxValue) maxValue = entry.market_value_m;
  }
  if (maxValue <= 0) maxValue = 1;

  const scores = new Map<string, number>();
  for (const [teamId, entry] of rawMap) {
    const size = entry.squad_size > 0 ? entry.squad_size : 26;
    const valuePct = entry.market_value_m / maxValue;
    const top5Pct  = entry.top5_league_count / size;
    scores.set(teamId, 0.60 * valuePct + 0.40 * top5Pct);
  }

  const allScores = [...scores.values()];
  const minScore = Math.min(...allScores);
  const maxScore = Math.max(...allScores);
  const range = maxScore - minScore;

  const normalize = (raw: number) =>
    range > 0.001 ? (raw - minScore) / range : 0.5;

  return {
    home: normalize(scores.get(homeId) ?? (minScore + maxScore) / 2),
    away: normalize(scores.get(awayId) ?? (minScore + maxScore) / 2),
  };
}

function computeGoalInflation(wcResults: WcActualResult[]): number {
  if (wcResults.length < 3) return 1.0;
  const totalGoals = wcResults.reduce((s, r) => s + r.home_goals + r.away_goals, 0);
  return (totalGoals / wcResults.length) / 2.50; // 2.50 = WC historical avg
}

export function buildSCFContext(
  fixture: Fixture,
  homeTeam: Team,
  awayTeam: Team,
  ratings: Rating[],
  allFixtures: Fixture[],
  wcResults: WcActualResult[],
  squadStrengthData: Record<string, SquadStrengthEntry>,
): SCFMatchContext {
  const homeForm = computeTournamentForm(homeTeam.id, allFixtures, wcResults);
  const awayForm = computeTournamentForm(awayTeam.id, allFixtures, wcResults);
  const squadStr = computeSquadStrengths(homeTeam.id, awayTeam.id, squadStrengthData);

  return {
    fixture: {
      id: fixture.id,
      home_team_id: fixture.home_team_id,
      away_team_id: fixture.away_team_id,
      group_name: fixture.group_name,
      neutral_venue: fixture.neutral_venue,
    },
    homeTeam: { id: homeTeam.id, name: homeTeam.name },
    awayTeam: { id: awayTeam.id, name: awayTeam.name },
    homeElo: getElo(homeTeam.id, ratings),
    awayElo: getElo(awayTeam.id, ratings),
    homeWCWins:        homeForm.wins,
    homeWCDraws:       homeForm.draws,
    homeWCLosses:      homeForm.losses,
    homeWCGoalsFor:    homeForm.goalsFor,
    homeWCGoalsAgainst: homeForm.goalsAgainst,
    awayWCWins:        awayForm.wins,
    awayWCDraws:       awayForm.draws,
    awayWCLosses:      awayForm.losses,
    awayWCGoalsFor:    awayForm.goalsFor,
    awayWCGoalsAgainst: awayForm.goalsAgainst,
    homeSquadStrength: squadStr.home,
    awaySquadStrength: squadStr.away,
    isDefendingChampion: {
      home: homeTeam.id === DEFENDING_CHAMPION,
      away: awayTeam.id === DEFENDING_CHAMPION,
    },
    isHostNation: {
      home: HOST_NATIONS.has(homeTeam.id),
      away: HOST_NATIONS.has(awayTeam.id),
    },
    isKnockout: isKnockoutPhase(fixture.group_name),
    goalInflation: computeGoalInflation(wcResults),
  };
}
