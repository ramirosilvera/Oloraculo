// =============================================================================
// Oloráculo — Monte Carlo Simulation Engine
// Migrated from: Oloraculo.Web/Services/Simulation/SimulationService.cs
// Runs in a Web Worker for non-blocking UI
// =============================================================================

import type {
  Fixture,
  FixtureContext,
  Group,
  MatchResult,
  Rating,
  ScorelineDistribution,
  Team,
  TeamTournamentProbability,
  TournamentProjection,
  WcActualResult,
} from '../types/domain';
import { PredictionEngine } from './prediction-engine';
import { poissonScoreline, sampleScore, eloExpectation } from './probability-helper';

// ---------------------------------------------------------------------------
// Bracket definition (WorldCup2026Bracket.cs)
// ---------------------------------------------------------------------------
type SlotKind = 'GroupWinner' | 'GroupRunnerUp' | 'GroupThird' | 'WinnerOf';

interface BracketSlot {
  kind: SlotKind;
  group?: string;
  tieId?: number;
  thirdOptions?: string[];
}

interface BracketTie {
  id: number;
  stage: string;
  home: BracketSlot;
  away: BracketSlot;
}

const W = (group: string): BracketSlot => ({ kind: 'GroupWinner', group });
const R = (group: string): BracketSlot => ({ kind: 'GroupRunnerUp', group });
const T = (...groups: string[]): BracketSlot => ({ kind: 'GroupThird', thirdOptions: groups });
const WO = (tieId: number): BracketSlot => ({ kind: 'WinnerOf', tieId });

const ROUND_OF_32: BracketTie[] = [
  { id: 73,  stage: 'R32', home: R('A'),  away: R('B') },
  { id: 74,  stage: 'R32', home: W('E'),  away: T('A','B','C','D','F') },
  { id: 75,  stage: 'R32', home: W('F'),  away: R('C') },
  { id: 76,  stage: 'R32', home: W('C'),  away: R('F') },
  { id: 77,  stage: 'R32', home: W('I'),  away: T('C','D','F','G','H') },
  { id: 78,  stage: 'R32', home: R('E'),  away: R('I') },
  { id: 79,  stage: 'R32', home: W('A'),  away: T('C','E','F','H','I') },
  { id: 80,  stage: 'R32', home: W('L'),  away: T('E','H','I','J','K') },
  { id: 81,  stage: 'R32', home: W('D'),  away: T('B','E','F','I','J') },
  { id: 82,  stage: 'R32', home: W('G'),  away: T('A','E','H','I','J') },
  { id: 83,  stage: 'R32', home: R('K'),  away: R('L') },
  { id: 84,  stage: 'R32', home: W('H'),  away: R('J') },
  { id: 85,  stage: 'R32', home: W('B'),  away: T('E','F','G','I','J') },
  { id: 86,  stage: 'R32', home: W('J'),  away: R('H') },
  { id: 87,  stage: 'R32', home: W('K'),  away: T('D','E','I','J','L') },
  { id: 88,  stage: 'R32', home: R('D'),  away: R('G') },
];

const ROUND_OF_16: BracketTie[] = [
  { id: 89, stage: 'R16', home: WO(74),  away: WO(77) },
  { id: 90, stage: 'R16', home: WO(73),  away: WO(75) },
  { id: 91, stage: 'R16', home: WO(76),  away: WO(78) },
  { id: 92, stage: 'R16', home: WO(79),  away: WO(80) },
  { id: 93, stage: 'R16', home: WO(83),  away: WO(84) },
  { id: 94, stage: 'R16', home: WO(81),  away: WO(82) },
  { id: 95, stage: 'R16', home: WO(86),  away: WO(88) },
  { id: 96, stage: 'R16', home: WO(85),  away: WO(87) },
];

const QUARTER_FINALS: BracketTie[] = [
  { id: 97,  stage: 'QF', home: WO(89), away: WO(90) },
  { id: 98,  stage: 'QF', home: WO(93), away: WO(94) },
  { id: 99,  stage: 'QF', home: WO(91), away: WO(92) },
  { id: 100, stage: 'QF', home: WO(95), away: WO(96) },
];

const SEMI_FINALS: BracketTie[] = [
  { id: 101, stage: 'SF', home: WO(97),  away: WO(98) },
  { id: 102, stage: 'SF', home: WO(99),  away: WO(100) },
];

const FINAL: BracketTie = { id: 104, stage: 'Final', home: WO(101), away: WO(102) };

// ---------------------------------------------------------------------------
// Seeded deterministic RNG (Mulberry32 — fast, seedable)
// ---------------------------------------------------------------------------
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Group table logic (GroupTable.cs)
// ---------------------------------------------------------------------------
interface Standing {
  teamId: string;
  group: string;
  points: number;
  gd: number;
  goalsFor: number;
}

function rankGroup(standings: Standing[], fifaPoints: Map<string, number>): Standing[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return (fifaPoints.get(b.teamId) ?? 0) - (fifaPoints.get(a.teamId) ?? 0);
  });
}

function rankBestThirds(thirds: Standing[], fifaPoints: Map<string, number>): Standing[] {
  return [...thirds]
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return (fifaPoints.get(b.teamId) ?? 0) - (fifaPoints.get(a.teamId) ?? 0);
    })
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------
interface Counter {
  qualify: number; r16: number; qf: number; sf: number; final: number; champion: number;
  winGroup: number; groupPoints: number;
}

function newCounter(): Counter {
  return { qualify: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0, winGroup: 0, groupPoints: 0 };
}

export interface SimulationInput {
  groups: Group[];
  fixtures: Fixture[];
  allResults: MatchResult[];
  ratings: Rating[];
  teams: Team[];
  wcResults: WcActualResult[];
  simulations: number;
  seed: number;
}

/**
 * Run the Monte Carlo simulation.
 * Call this from a Web Worker to avoid blocking the UI thread.
 * Migrated from SimulationService.RunAsync()
 */
export function runSimulation(input: SimulationInput): TournamentProjection {
  const { groups, fixtures, allResults, ratings, teams: teamList, wcResults, simulations, seed } = input;
  const rng = createRng(seed);
  // Same engine as the Matches page — fit once, predict many.
  const engine = new PredictionEngine(allResults);
  const teamMap = new Map<string, Team>(teamList.map(t => [t.id, t]));
  const emptyContexts = new Map<string, FixtureContext>();

  const fifaPoints = new Map<string, number>();
  for (const r of ratings) {
    if (r.type !== 'fifa') continue;
    const existing = fifaPoints.get(r.team_id);
    if (!existing || new Date(r.as_of) > new Date()) {
      fifaPoints.set(r.team_id, r.value);
    }
  }

  const eloMap = new Map<string, number>();
  for (const r of ratings) {
    if (r.type !== 'elo') continue;
    eloMap.set(r.team_id, r.value);
  }

  const allTeams = groups.flatMap(g => g.team_ids);
  const counters = new Map<string, Counter>(allTeams.map(t => [t, newCounter()]));

  // Each ordered (home, away) pairing is predicted once with the FULL ladder —
  // the same engine the Matches page uses. buildContext threads in Elo, recent
  // form, FIFA, the goal model, tournament momentum (L6), goal inflation and the
  // daily scoring streak, and predict() selects the highest usable level. We then
  // sample scorelines from that selected level's grid.
  //
  // Simulated matches are played at neutral venues, so per-match availability
  // context (L5, keyed to a specific scheduled fixture) is intentionally not
  // applied to hypothetical bracket pairings.
  const predCache = new Map<string, { home: number; away: number }[]>();

  function pairingDistribution(homeId: string, awayId: string): ScorelineDistribution {
    const fixture: Fixture = {
      id: `sim:${homeId}:${awayId}`,
      group_name: '',
      home_team_id: homeId,
      away_team_id: awayId,
      neutral_venue: true,
      is_played: false,
    };
    const ctx = engine.buildContext(fixture, teamMap, ratings, emptyContexts, wcResults, fixtures);
    const result = engine.predict(ctx);
    // The selected level is goal-based (L4/L5/L6) for any team with history, so
    // a scoreline grid is virtually always present; fall back defensively.
    return (
      result.bestPrediction.scoreline ??
      result.predictions.find(p => p.scoreline)?.scoreline ??
      poissonScoreline(1.3, 1.1, 8, -0.03)
    );
  }

  function sampleMatchScore(homeId: string, awayId: string): { home: number; away: number } {
    const key = `${homeId}|${awayId}`;
    let samples = predCache.get(key);
    if (!samples) {
      const dist = pairingDistribution(homeId, awayId);
      // Pre-generate 50 samples per pairing for cheap reuse across iterations.
      samples = Array.from({ length: 50 }, () => sampleScore(dist, rng));
      predCache.set(key, samples);
    }
    return samples[Math.floor(rng() * samples.length)];
  }

  function knockoutWinner(homeId: string, awayId: string): string {
    const score = sampleMatchScore(homeId, awayId);
    if (score.home === score.away) {
      // Penalty shootout — use Elo expectation as coin flip weight
      const homeElo = eloMap.get(homeId) ?? 1500;
      const awayElo = eloMap.get(awayId) ?? 1500;
      return rng() < eloExpectation(homeElo, awayElo) ? homeId : awayId;
    }
    return score.home > score.away ? homeId : awayId;
  }

  for (let sim = 0; sim < simulations; sim++) {
    const groupSlots = new Map<string, { winner: string; runnerUp: string; third: string }>();
    const thirds: Standing[] = [];

    // --- Group stage ---
    for (const group of groups) {
      const teams = group.team_ids;
      const standings = new Map<string, Standing>(
        teams.map(t => [t, { teamId: t, group: group.name, points: 0, gd: 0, goalsFor: 0 }]),
      );

      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const a = teams[i], b = teams[j];
          const known = fixtures.find(
            f => f.group_name === group.name && f.is_played &&
              ((f.home_team_id === a && f.away_team_id === b) ||
               (f.home_team_id === b && f.away_team_id === a)),
          );

          let scoreA: number, scoreB: number;
          if (known && known.home_goals != null && known.away_goals != null) {
            if (known.home_team_id === a) {
              scoreA = known.home_goals; scoreB = known.away_goals;
            } else {
              scoreA = known.away_goals; scoreB = known.home_goals;
            }
          } else {
            const s = sampleMatchScore(a, b);
            scoreA = s.home; scoreB = s.away;
          }

          const sa = standings.get(a)!;
          const sb = standings.get(b)!;
          sa.goalsFor += scoreA; sa.gd += scoreA - scoreB;
          sb.goalsFor += scoreB; sb.gd += scoreB - scoreA;
          if (scoreA > scoreB) { sa.points += 3; }
          else if (scoreA === scoreB) { sa.points += 1; sb.points += 1; }
          else { sb.points += 3; }
        }
      }

      const ranked = rankGroup([...standings.values()], fifaPoints);
      for (let pos = 0; pos < ranked.length; pos++) {
        counters.get(ranked[pos].teamId)!.groupPoints += ranked[pos].points;
      }

      counters.get(ranked[0].teamId)!.winGroup++;
      groupSlots.set(group.name, {
        winner: ranked[0].teamId,
        runnerUp: ranked[1].teamId,
        third: ranked[2].teamId,
      });
      thirds.push({ ...ranked[2], group: group.name });
    }

    const best8Thirds = rankBestThirds(thirds, fifaPoints);
    for (const slot of groupSlots.values()) {
      counters.get(slot.winner)!.qualify++;
      counters.get(slot.runnerUp)!.qualify++;
    }
    for (const t of best8Thirds) counters.get(t.teamId)!.qualify++;

    const thirdByGroup = new Map(best8Thirds.map(t => [t.group, t.teamId]));
    const winners = new Map<number, string>();

    function resolve(tie: BracketTie, slot: BracketSlot): string {
      if (slot.kind === 'GroupWinner') return groupSlots.get(slot.group!)!.winner;
      if (slot.kind === 'GroupRunnerUp') return groupSlots.get(slot.group!)!.runnerUp;
      if (slot.kind === 'GroupThird') {
        const g = (slot.thirdOptions ?? []).find(g => thirdByGroup.has(g));
        return g ? thirdByGroup.get(g)! : best8Thirds[0].teamId;
      }
      return winners.get(slot.tieId!)!;
    }

    function playRound(ties: BracketTie[], onWin: (teamId: string) => void): void {
      for (const tie of ties) {
        const home = resolve(tie, tie.home);
        const away = resolve(tie, tie.away);
        const winner = knockoutWinner(home, away);
        winners.set(tie.id, winner);
        onWin(winner);
      }
    }

    playRound(ROUND_OF_32, t => counters.get(t)!.r16++);
    playRound(ROUND_OF_16, t => counters.get(t)!.qf++);
    playRound(QUARTER_FINALS, t => counters.get(t)!.sf++);
    playRound(SEMI_FINALS, t => counters.get(t)!.final++);

    const finalistHome = resolve(FINAL, FINAL.home);
    const finalistAway = resolve(FINAL, FINAL.away);
    const champion = knockoutWinner(finalistHome, finalistAway);
    counters.get(champion)!.champion++;
  }

  const teams: TeamTournamentProbability[] = allTeams.map(teamId => {
    const group = groups.find(g => g.team_ids.includes(teamId))!.name;
    const c = counters.get(teamId)!;
    return {
      teamId,
      group,
      winGroup:           c.winGroup   / simulations,
      qualify:            c.qualify    / simulations,
      reachRoundOf16:     c.r16        / simulations,
      reachQuarterFinal:  c.qf         / simulations,
      reachSemiFinal:     c.sf         / simulations,
      reachFinal:         c.final      / simulations,
      winTournament:      c.champion   / simulations,
      expectedGroupPoints: Math.round((c.groupPoints / simulations) * 100) / 100,
    };
  });

  return {
    simulations,
    modelName: 'Final',
    inputSummaryHash: `sim:${simulations}:seed:${seed}`,
    teams: teams.sort((a, b) => b.winTournament - a.winTournament),
  };
}
