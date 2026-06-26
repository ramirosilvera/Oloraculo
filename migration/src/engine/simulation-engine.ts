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
// Bracket definition — FIFA WC 2026 official structure
//
// 12 groups (A–L). R32 crossings are NOT simple adjacent pairs — they follow
// the official draw that keeps the 3 hosts (Mexico=A, Canada=B, USA=D) apart
// and places Argentina (J) vs Spain (H), NOT vs France/Norway (I).
//
// GroupThird slots list which groups may contribute a qualifying 3rd-place team
// to that match. Per-simulation deduplication (assignedThirds) ensures each
// team is assigned to at most one R32 slot.
// ---------------------------------------------------------------------------
type SlotKind = 'GroupWinner' | 'GroupRunnerUp' | 'GroupThird' | 'WinnerOf';

interface BracketSlot {
  kind: SlotKind;
  group?: string;
  tieId?: number;
  thirdOptions?: string[]; // GroupThird: eligible source groups
}

interface BracketTie {
  id: number;
  stage: string;
  home: BracketSlot;
  away: BracketSlot;
}

const W  = (group: string):           BracketSlot => ({ kind: 'GroupWinner',   group });
const R  = (group: string):           BracketSlot => ({ kind: 'GroupRunnerUp', group });
const T  = (...groups: string[]):     BracketSlot => ({ kind: 'GroupThird',    thirdOptions: groups });
const WO = (tieId: number):           BracketSlot => ({ kind: 'WinnerOf',      tieId });

// Official FIFA WC 2026 R32 draw (confirmed from FIFA schedule):
// 4 Runner×Runner pairs: M73(2A×2B), M78(2E×2I), M83(2K×2L), M88(2D×2G)
// 4 Winner×RunnerUp crosses: M75(1F×2C), M76(1C×2F), M84(1H×2J), M86(1J×2H)
// 8 Winner×T3 matches: M74(1E), M77(1I), M79(1A), M80(1L), M81(1D), M82(1G), M85(1B), M87(1K)
// T3 group eligibility lists: per Annex C slot assignments from FIFA draw
const ROUND_OF_32: BracketTie[] = [
  { id: 73, stage: 'R32', home: R('A'), away: R('B') },                     // 2A vs 2B
  { id: 74, stage: 'R32', home: W('E'), away: T('A','B','C','D','F') },      // 1E vs T3
  { id: 75, stage: 'R32', home: W('F'), away: R('C') },                      // 1F vs 2C
  { id: 76, stage: 'R32', home: W('C'), away: R('F') },                      // 1C vs 2F
  { id: 77, stage: 'R32', home: W('I'), away: T('C','D','F','G','H') },      // 1I vs T3
  { id: 78, stage: 'R32', home: R('E'), away: R('I') },                      // 2E vs 2I
  { id: 79, stage: 'R32', home: W('A'), away: T('C','E','F','H','I') },      // 1A vs T3
  { id: 80, stage: 'R32', home: W('L'), away: T('E','H','I','J','K') },      // 1L vs T3
  { id: 81, stage: 'R32', home: W('D'), away: T('B','E','F','I','J') },      // 1D vs T3
  { id: 82, stage: 'R32', home: W('G'), away: T('A','E','H','I','J') },      // 1G vs T3
  { id: 83, stage: 'R32', home: R('K'), away: R('L') },                      // 2K vs 2L
  { id: 84, stage: 'R32', home: W('H'), away: R('J') },                      // 1H vs 2J
  { id: 85, stage: 'R32', home: W('B'), away: T('E','F','G','I','J') },      // 1B vs T3
  { id: 86, stage: 'R32', home: W('J'), away: R('H') },                      // 1J vs 2H
  { id: 87, stage: 'R32', home: W('K'), away: T('D','E','I','J','L') },      // 1K vs T3
  { id: 88, stage: 'R32', home: R('D'), away: R('G') },                      // 2D vs 2G
];

// R16: confirmed pairings from FIFA schedule (source: worldcupkickofftimes.com, wikipedia)
const ROUND_OF_16: BracketTie[] = [
  { id: 89, stage: 'R16', home: WO(74), away: WO(77) }, // W(1E/T3) vs W(1I/T3)
  { id: 90, stage: 'R16', home: WO(73), away: WO(75) }, // W(2A/2B) vs W(1F/2C)
  { id: 91, stage: 'R16', home: WO(76), away: WO(78) }, // W(1C/2F) vs W(2E/2I)
  { id: 92, stage: 'R16', home: WO(79), away: WO(80) }, // W(1A/T3) vs W(1L/T3)
  { id: 93, stage: 'R16', home: WO(83), away: WO(84) }, // W(2K/2L) vs W(1H/2J)
  { id: 94, stage: 'R16', home: WO(81), away: WO(82) }, // W(1D/T3) vs W(1G/T3)
  { id: 95, stage: 'R16', home: WO(86), away: WO(88) }, // W(1J/2H) vs W(2D/2G)
  { id: 96, stage: 'R16', home: WO(85), away: WO(87) }, // W(1B/T3) vs W(1K/T3)
];

const QUARTER_FINALS: BracketTie[] = [
  { id: 97,  stage: 'QF', home: WO(89), away: WO(90) }, // W(M89) vs W(M90)
  { id: 98,  stage: 'QF', home: WO(91), away: WO(92) }, // W(M91) vs W(M92)
  { id: 99,  stage: 'QF', home: WO(93), away: WO(94) }, // W(M93) vs W(M94)
  { id: 100, stage: 'QF', home: WO(95), away: WO(96) }, // W(M95) vs W(M96)
];

// SF must keep each half of the draw intact. QF97 & QF99 are both LEFT-bracket
// quarters (their R32 feeders are Llaves 1-8); QF98 & QF100 are both RIGHT-bracket
// (Llaves 9-16). Pairing (97,98)/(99,100) crossed the halves, letting two same-side
// teams reach the final and merging the brackets one round too early.
const SEMI_FINALS: BracketTie[] = [
  { id: 101, stage: 'SF', home: WO(97),  away: WO(99)  }, // SF A (left):  W(QF97) vs W(QF99)
  { id: 102, stage: 'SF', home: WO(98),  away: WO(100) }, // SF B (right): W(QF98) vs W(QF100)
];

const FINAL: BracketTie = { id: 104, stage: 'Final', home: WO(101), away: WO(102) };

// T3 slot eligibility map (R32 match ID → groups whose T3 may be placed there).
// Derived directly from the ROUND_OF_32 thirdOptions arrays above.
// Used by assignT3Slots() to guarantee a valid per-simulation assignment.
const T3_ELIGIBILITY: Record<number, readonly string[]> = {
  74: ['A','B','C','D','F'],
  77: ['C','D','F','G','H'],
  79: ['C','E','F','H','I'],
  80: ['E','H','I','J','K'],
  81: ['B','E','F','I','J'],
  82: ['A','E','H','I','J'],
  85: ['E','F','G','I','J'],
  87: ['D','E','I','J','L'],
};

// Assign each of the 8 best T3 teams to one R32 T3-slot using most-constrained-first
// greedy. The naive slot-order greedy can strand Group L's T3 (only eligible for M87)
// if another team is placed in M87 first. Sorting slots by eligible-group count
// (ascending) assigns the most constrained slots before the flexible ones, guaranteeing
// a valid matching whenever one exists.
function assignT3Slots(best8Thirds: Standing[]): Map<number, string> {
  const teamByGroup = new Map(best8Thirds.map(t => [t.group, t.teamId]));
  const qualifiedGroups = new Set(best8Thirds.map(t => t.group));

  const slotEligible: [number, string[]][] = (
    Object.entries(T3_ELIGIBILITY) as [string, readonly string[]][]
  ).map(([id, groups]) => [parseInt(id), groups.filter(g => qualifiedGroups.has(g))]);

  // Most-constrained first (fewest eligible qualified groups)
  slotEligible.sort((a, b) => a[1].length - b[1].length);

  const assignment = new Map<number, string>();
  const usedGroups = new Set<string>();

  for (const [slotId, eligible] of slotEligible) {
    const group = eligible.find(g => !usedGroups.has(g));
    if (group) {
      assignment.set(slotId, teamByGroup.get(group)!);
      usedGroups.add(group);
    } else {
      // Fallback: any unassigned qualified T3 (safety net — should not be reached)
      const fb = best8Thirds.find(t => !usedGroups.has(t.group));
      if (fb) { assignment.set(slotId, fb.teamId); usedGroups.add(fb.group); }
    }
  }

  return assignment;
}

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
  const slotOccupancy: Record<number, Record<string, number>> = {};

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

  // Lock real group-stage results from wcResults (Supabase actual results).
  // fixtures.is_played handles static JSON; this handles user-entered corrections.
  // Key: "homeTeamId|awayTeamId" → { hg, ag } where home/away matches the fixture record.
  const fixtureById = new Map<string, Fixture>(fixtures.map(f => [f.id, f]));
  const groupResultMap = new Map<string, { hg: number; ag: number }>();
  for (const r of wcResults) {
    if (r.fixture_id.startsWith('ko:')) continue;
    const f = fixtureById.get(r.fixture_id);
    if (!f) continue;
    groupResultMap.set(`${f.home_team_id}|${f.away_team_id}`, { hg: r.home_goals, ag: r.away_goals });
  }

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

  // Lock in real knockout results: fixture_id 'ko:*:m{N}' → { home_goals, away_goals }
  // When a knockout match is played, its result is preserved across all simulations
  // instead of being resampled. Draws (OT/pens) still get sampled (no penalty data).
  const koPlayedMap = new Map<number, { home_goals: number; away_goals: number }>();
  for (const r of wcResults) {
    if (!r.fixture_id.startsWith('ko:')) continue;
    const m = r.fixture_id.match(/:m(\d+)$/);
    if (m) koPlayedMap.set(parseInt(m[1]), { home_goals: r.home_goals, away_goals: r.away_goals });
  }

  function knockoutWinnerWithLock(tieId: number, homeId: string, awayId: string): string {
    const played = koPlayedMap.get(tieId);
    if (played) {
      if (played.home_goals > played.away_goals) return homeId;
      if (played.away_goals > played.home_goals) return awayId;
      // Draw after 90 min (went to pens) — sample using Elo since we don't have pen result
    }
    return knockoutWinner(homeId, awayId);
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
          // Fall back to wcResults (Supabase real results) if the static fixture isn't marked played
          const wcKnown = !known
            ? (groupResultMap.get(`${a}|${b}`) ?? groupResultMap.get(`${b}|${a}`))
            : undefined;

          let scoreA: number, scoreB: number;
          if (known && known.home_goals != null && known.away_goals != null) {
            if (known.home_team_id === a) {
              scoreA = known.home_goals; scoreB = known.away_goals;
            } else {
              scoreA = known.away_goals; scoreB = known.home_goals;
            }
          } else if (wcKnown) {
            const aIsHome = groupResultMap.has(`${a}|${b}`);
            scoreA = aIsHome ? wcKnown.hg : wcKnown.ag;
            scoreB = aIsHome ? wcKnown.ag : wcKnown.hg;
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

    // Pre-assign all T3 teams to their R32 slots once, using most-constrained-first
    // greedy. This avoids the per-slot greedy race that could leave Group L's T3
    // (eligible only for M87) without a valid slot.
    const t3SlotMap = assignT3Slots(best8Thirds);
    const winners = new Map<number, string>();

    function resolve(tie: BracketTie, slot: BracketSlot): string {
      if (slot.kind === 'GroupWinner')   return groupSlots.get(slot.group!)!.winner;
      if (slot.kind === 'GroupRunnerUp') return groupSlots.get(slot.group!)!.runnerUp;
      if (slot.kind === 'GroupThird')    return t3SlotMap.get(tie.id) ?? best8Thirds[0].teamId;
      return winners.get(slot.tieId!)!;
    }

    const playRound = (ties: BracketTie[], onResult: (winnerId: string, loserId: string, tieId: number, homeTeam: string, awayTeam: string) => void) => {
      for (const tie of ties) {
        const home = resolve(tie, tie.home);
        const away = resolve(tie, tie.away);
        const winner = knockoutWinnerWithLock(tie.id, home, away);
        winners.set(tie.id, winner);
        onResult(winner, winner === home ? away : home, tie.id, home, away);
      }
    };

    playRound(ROUND_OF_32, (w, l, tieId, home, away) => {
      counters.get(w)!.r16++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.r32Opps, wc.r32Wins, l, true);
      trackOpp(lc.r32Opps, lc.r32Wins, w, false);
      // Track which teams occupy each R32 slot
      if (!slotOccupancy[tieId]) slotOccupancy[tieId] = {};
      slotOccupancy[tieId][home] = (slotOccupancy[tieId][home] ?? 0) + 1;
      slotOccupancy[tieId][away] = (slotOccupancy[tieId][away] ?? 0) + 1;
    });
    playRound(ROUND_OF_16, (w, l, tieId, home, away) => {
      counters.get(w)!.qf++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.r16Opps, wc.r16Wins, l, true);
      trackOpp(lc.r16Opps, lc.r16Wins, w, false);
      if (!slotOccupancy[tieId]) slotOccupancy[tieId] = {};
      slotOccupancy[tieId][home] = (slotOccupancy[tieId][home] ?? 0) + 1;
      slotOccupancy[tieId][away] = (slotOccupancy[tieId][away] ?? 0) + 1;
    });
    playRound(QUARTER_FINALS, (w, l, tieId, home, away) => {
      counters.get(w)!.sf++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.qfOpps, wc.qfWins, l, true);
      trackOpp(lc.qfOpps, lc.qfWins, w, false);
      if (!slotOccupancy[tieId]) slotOccupancy[tieId] = {};
      slotOccupancy[tieId][home] = (slotOccupancy[tieId][home] ?? 0) + 1;
      slotOccupancy[tieId][away] = (slotOccupancy[tieId][away] ?? 0) + 1;
    });
    playRound(SEMI_FINALS, (w, l, tieId, home, away) => {
      counters.get(w)!.final++;
      const wc = counters.get(w)!; const lc = counters.get(l)!;
      trackOpp(wc.sfOpps, wc.sfWins, l, true);
      trackOpp(lc.sfOpps, lc.sfWins, w, false);
      if (!slotOccupancy[tieId]) slotOccupancy[tieId] = {};
      slotOccupancy[tieId][home] = (slotOccupancy[tieId][home] ?? 0) + 1;
      slotOccupancy[tieId][away] = (slotOccupancy[tieId][away] ?? 0) + 1;
    });

    const finalistHome = resolve(FINAL, FINAL.home);
    const finalistAway = resolve(FINAL, FINAL.away);
    const champion = knockoutWinnerWithLock(FINAL.id, finalistHome, finalistAway);
    const runner = champion === finalistHome ? finalistAway : finalistHome;
    counters.get(champion)!.champion++;
    trackOpp(counters.get(champion)!.finOpps, counters.get(champion)!.finWins, runner, true);
    trackOpp(counters.get(runner)!.finOpps,   counters.get(runner)!.finWins,   champion, false);
    if (!slotOccupancy[FINAL.id]) slotOccupancy[FINAL.id] = {};
    slotOccupancy[FINAL.id][finalistHome] = (slotOccupancy[FINAL.id][finalistHome] ?? 0) + 1;
    slotOccupancy[FINAL.id][finalistAway] = (slotOccupancy[FINAL.id][finalistAway] ?? 0) + 1;
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

  const _completed = allResults.filter(r => r.home_goals != null);
  const _rKey = `${_completed.length}:${_completed.reduce((s, r) => s + (r.home_goals ?? 0) + (r.away_goals ?? 0), 0)}`;

  return {
    simulations,
    modelName: 'Final',
    inputSummaryHash: `sim:${simulations}:seed:${seed}:${_rKey}`,
    teams: teams.sort((a, b) => b.winTournament - a.winTournament),
    slotOccupancy,
  };
}
