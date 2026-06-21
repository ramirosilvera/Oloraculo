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
  SquadStrengthEntry,
  Team,
  TeamTournamentProbability,
  TournamentProjection,
  WcActualResult,
} from '../types/domain';
import type { TacticalProfile } from './models';
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
  // Group detail
  groupGoalsFor: number; groupGoalsAgainst: number;
  groupPos: [number, number, number, number]; // finish position 1st/2nd/3rd/4th counts
  // Knockout opponent tracking: oppId → count
  r32Opps: Record<string, number>; r32Wins: Record<string, number>;
  r16Opps: Record<string, number>; r16Wins: Record<string, number>;
  qfOpps:  Record<string, number>; qfWins:  Record<string, number>;
  sfOpps:  Record<string, number>; sfWins:  Record<string, number>;
  finOpps: Record<string, number>; finWins: Record<string, number>;
}

function newCounter(): Counter {
  return {
    qualify: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0, winGroup: 0, groupPoints: 0,
    groupGoalsFor: 0, groupGoalsAgainst: 0, groupPos: [0, 0, 0, 0],
    r32Opps: {}, r32Wins: {}, r16Opps: {}, r16Wins: {},
    qfOpps:  {}, qfWins:  {}, sfOpps:  {}, sfWins:  {},
    finOpps: {}, finWins: {},
  };
}

function trackOpp(opps: Record<string, number>, wins: Record<string, number>, oppId: string, won: boolean) {
  opps[oppId] = (opps[oppId] ?? 0) + 1;
  if (won) wins[oppId] = (wins[oppId] ?? 0) + 1;
}

function computeJourney(
  opps: Record<string, number>,
  wins: Record<string, number>,
  reached: number,
  exclude: Set<string> = new Set(),
): import('../types/domain').JourneyRound | undefined {
  const entries = Object.entries(opps).filter(([id]) => !exclude.has(id));
  if (!entries.length || reached === 0) return undefined;
  const [topId, facedCount] = entries.sort((a, b) => b[1] - a[1])[0];
  return {
    mostLikelyOpponentId: topId,
    facedCount,
    winsVsMostLikely: wins[topId] ?? 0,
    totalReached: reached,
    wins: Object.values(wins).reduce((s, v) => s + v, 0),
  };
}

function buildJourneys(c: Counter) {
  const seen = new Set<string>();
  const pick = (j: ReturnType<typeof computeJourney>) => { if (j) seen.add(j.mostLikelyOpponentId); return j; };
  return {
    r32Journey: pick(computeJourney(c.r32Opps, c.r32Wins, c.qualify, seen)),
    r16Journey: pick(computeJourney(c.r16Opps, c.r16Wins, c.r16,     seen)),
    qfJourney:  pick(computeJourney(c.qfOpps,  c.qfWins,  c.qf,      seen)),
    sfJourney:  pick(computeJourney(c.sfOpps,  c.sfWins,  c.sf,      seen)),
    finJourney: pick(computeJourney(c.finOpps, c.finWins, c.final,   seen)),
  };
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
  squadStrengthData?: Record<string, SquadStrengthEntry>;
  tacticalProfilesData?: Record<string, TacticalProfile>;
}

/**
 * Run the Monte Carlo simulation.
 * Call this from a Web Worker to avoid blocking the UI thread.
 * Migrated from SimulationService.RunAsync()
 */
export function runSimulation(input: SimulationInput): TournamentProjection {
  const { groups, fixtures, allResults, ratings, teams: teamList, wcResults, simulations, seed,
          squadStrengthData, tacticalProfilesData } = input;
  const rng = createRng(seed);
  // Same engine as the Matches page — squad/tactical data included so L4.5 and L7 are active.
  const engine = new PredictionEngine(allResults, 8, squadStrengthData ?? {}, tacticalProfilesData ?? {});
  const teamMap = new Map<string, Team>(teamList.map(t => [t.id, t]));
  const emptyContexts = new Map<string, FixtureContext>();

  // For each team keep only the most-recent rating (compare as_of strings — ISO dates sort lexicographically).
  const fifaPoints = new Map<string, number>();
  const fifaDates  = new Map<string, string>();
  for (const r of ratings) {
    if (r.type !== 'fifa') continue;
    const d = fifaDates.get(r.team_id) ?? '';
    if (r.as_of > d) { fifaPoints.set(r.team_id, r.value); fifaDates.set(r.team_id, r.as_of); }
  }

  const eloMap   = new Map<string, number>();
  const eloDates = new Map<string, string>();
  for (const r of ratings) {
    if (r.type !== 'elo') continue;
    const d = eloDates.get(r.team_id) ?? '';
    if (r.as_of > d) { eloMap.set(r.team_id, r.value); eloDates.set(r.team_id, r.as_of); }
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
  // Cache the ScorelineDistribution (not pre-generated samples) so each simulation
  // draws a fresh, unbiased score from the full distribution while still avoiding
  // the expensive buildContext + predict call on repeated pairings.
  const predCache = new Map<string, ScorelineDistribution>();

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
    let dist = predCache.get(key);
    if (!dist) { dist = pairingDistribution(homeId, awayId); predCache.set(key, dist); }
    return sampleScore(dist, rng);
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
        const tc = counters.get(ranked[pos].teamId)!;
        tc.groupPoints      += ranked[pos].points;
        tc.groupGoalsFor    += ranked[pos].goalsFor;
        tc.groupGoalsAgainst += ranked[pos].goalsFor - ranked[pos].gd;
        if (pos < 4) tc.groupPos[pos]++;
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

    const playRound = (ties: BracketTie[], onResult: (winnerId: string, loserId: string) => void) => {
      for (const tie of ties) {
        const home = resolve(tie, tie.home);
        const away = resolve(tie, tie.away);
        const winner = knockoutWinner(home, away);
        winners.set(tie.id, winner);
        onResult(winner, winner === home ? away : home);
      }
    };

    playRound(ROUND_OF_32, (w, l) => {
      counters.get(w)!.r16++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.r32Opps, wc.r32Wins, l, true);
      trackOpp(lc.r32Opps, lc.r32Wins, w, false);
    });
    playRound(ROUND_OF_16, (w, l) => {
      counters.get(w)!.qf++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.r16Opps, wc.r16Wins, l, true);
      trackOpp(lc.r16Opps, lc.r16Wins, w, false);
    });
    playRound(QUARTER_FINALS, (w, l) => {
      counters.get(w)!.sf++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.qfOpps, wc.qfWins, l, true);
      trackOpp(lc.qfOpps, lc.qfWins, w, false);
    });
    playRound(SEMI_FINALS, (w, l) => {
      counters.get(w)!.final++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.sfOpps, wc.sfWins, l, true);
      trackOpp(lc.sfOpps, lc.sfWins, w, false);
    });

    const finalistHome = resolve(FINAL, FINAL.home);
    const finalistAway = resolve(FINAL, FINAL.away);
    const champion = knockoutWinner(finalistHome, finalistAway);
    const runner = champion === finalistHome ? finalistAway : finalistHome;
    counters.get(champion)!.champion++;
    trackOpp(counters.get(champion)!.finOpps, counters.get(champion)!.finWins, runner, true);
    trackOpp(counters.get(runner)!.finOpps,   counters.get(runner)!.finWins,   champion, false);
  }

  const teams: TeamTournamentProbability[] = allTeams.map(teamId => {
    const group = groups.find(g => g.team_ids.includes(teamId))!.name;
    const c = counters.get(teamId)!;
    return {
      teamId,
      group,
      winGroup:            c.winGroup   / simulations,
      qualify:             c.qualify    / simulations,
      reachRoundOf16:      c.r16        / simulations,
      reachQuarterFinal:   c.qf         / simulations,
      reachSemiFinal:      c.sf         / simulations,
      reachFinal:          c.final      / simulations,
      winTournament:       c.champion   / simulations,
      expectedGroupPoints: Math.round((c.groupPoints / simulations) * 100) / 100,
      avgGroupGoalsFor:     +(c.groupGoalsFor    / simulations).toFixed(2),
      avgGroupGoalsAgainst: +(c.groupGoalsAgainst / simulations).toFixed(2),
      groupPositions: c.groupPos.map(n => +(n / simulations).toFixed(4)) as [number, number, number, number],
      ...buildJourneys(c),
    };
  });

  return {
    simulations,
    modelName: 'Final',
    inputSummaryHash: `sim:${simulations}:seed:${seed}`,
    teams: teams.sort((a, b) => b.winTournament - a.winTournament),
  };
}
