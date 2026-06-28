// =============================================================================
// Oloráculo — Prediction Engine (orchestrator)
// Migrated from: Oloraculo.Web/Services/PredictionService.cs
// Runs entirely in the browser — no server required
// =============================================================================

import type {
  Fixture,
  MatchContext,
  MatchPrediction,
  MatchPredictionResult,
  MatchResult,
  Rating,
  Team,
  WcActualResult,
  TournamentFormStats,
  SquadStrengthEntry,
} from '../types/domain';
import {
  nullModelPredict,
  eloModelPredict,
  recentFormModelPredict,
  goalContextModelPredict,
  GoalModel,
  tournamentMomentumPredict,
  groupPatternPredict,
  eloTournamentPredict,
  knockoutPatternPredict,
  squadStrengthModelPredict,
  buildSquadStrengthMap,
  buildTacticalMap,
} from './models';
import type { TacticalProfile } from './models';
import { selectFinalPrediction } from './final-selector';

const RECENT_RESULT_COUNT = 8;
const GOAL_MODEL_YEARS_WINDOW = 8;

/** Pre-built engine: fit once, predict many */
export class PredictionEngine {
  private readonly goalModel: GoalModel;
  private readonly squadStrengthMap: Map<string, SquadStrengthEntry>;
  private readonly tacticalProfiles: Map<string, TacticalProfile>;
  private readonly teamResultsMap: Map<string, MatchResult[]>;

  constructor(
    private readonly allResults: MatchResult[],
    yearsWindow = GOAL_MODEL_YEARS_WINDOW,
    squadStrengthData: Record<string, SquadStrengthEntry> = {},
    tacticalProfilesData: Record<string, TacticalProfile> = {},
  ) {
    this.goalModel = new GoalModel(allResults, yearsWindow);
    this.squadStrengthMap = buildSquadStrengthMap(squadStrengthData);
    this.tacticalProfiles = buildTacticalMap(tacticalProfilesData);
    // Pre-index results by team so buildContext lookups are O(1) instead of O(n).
    const tmpMap = new Map<string, MatchResult[]>();
    for (const r of allResults) {
      if (!tmpMap.has(r.home_team_id)) tmpMap.set(r.home_team_id, []);
      if (!tmpMap.has(r.away_team_id)) tmpMap.set(r.away_team_id, []);
      tmpMap.get(r.home_team_id)!.push(r);
      tmpMap.get(r.away_team_id)!.push(r);
    }
    // Sort each team's list descending by date once — slicing is then O(1).
    for (const arr of tmpMap.values()) {
      arr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    this.teamResultsMap = tmpMap;
  }

  private computeTournamentForm(
    teamId: string,
    wcResults: WcActualResult[],
    allFixtures: Fixture[],
    ratings: Rating[],
  ): TournamentFormStats | null {
    const fixtureMap = new Map<string, Fixture>(allFixtures.map(f => [f.id, f]));

    // Filter WC results to those involving this team
    const teamResults = wcResults.filter(r => {
      const f = fixtureMap.get(r.fixture_id);
      return f !== undefined && (f.home_team_id === teamId || f.away_team_id === teamId);
    });

    // Sort ascending (oldest first)
    teamResults.sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime());

    if (teamResults.length === 0) return null;

    // Build latestElo map in a single O(n) pass — ISO date strings sort lexicographically.
    const latestEloMap = new Map<string, number>();
    const latestEloDates = new Map<string, string>();
    for (const r of ratings) {
      if (r.type !== 'elo') continue;
      const d = latestEloDates.get(r.team_id) ?? '';
      if (r.as_of > d) { latestEloMap.set(r.team_id, r.value); latestEloDates.set(r.team_id, r.as_of); }
    }

    // Compute average Elo across all teams that have a rating
    const allEloValues = [...latestEloMap.values()];
    const avgElo = allEloValues.length > 0
      ? allEloValues.reduce((s, v) => s + v, 0) / allEloValues.length
      : 1500;

    const latestElo = (tid: string): number => latestEloMap.get(tid) ?? avgElo;

    // Accumulate stats
    let played = 0, wins = 0, draws = 0, losses = 0;
    let goalsFor = 0, goalsAgainst = 0;
    let rawScore = 0;
    let upsetBonus = 0;

    const total = teamResults.length;
    for (let i = 0; i < total; i++) {
      const r = teamResults[i];
      const f = fixtureMap.get(r.fixture_id)!;
      const isHome = f.home_team_id === teamId;
      const opponentId = isHome ? f.away_team_id : f.home_team_id;

      const gf = isHome ? r.home_goals : r.away_goals;
      const ga = isHome ? r.away_goals : r.home_goals;

      played++;
      goalsFor += gf;
      goalsAgainst += ga;

      const pts = gf > ga ? 3 : gf === ga ? 1 : -1;
      if (gf > ga) wins++;
      else if (gf === ga) draws++;
      else losses++;

      const oppElo = latestElo(opponentId);
      const teamElo = latestElo(teamId);
      const strengthFactor = oppElo / avgElo;
      const eloDiff = oppElo - teamElo;

      let surpriseMult = 1.0;
      if (pts > 0 && eloDiff > 150) surpriseMult = 1.4;  // upset win
      else if (pts < 0 && eloDiff < -150) surpriseMult = 1.5;  // surprise loss penalty

      if (pts > 0 && eloDiff > 150) upsetBonus += eloDiff / 1000;

      const goalFactor = Math.max(-2, Math.min(2, gf - ga)) * 0.25;
      const recencyWeight = Math.pow(0.75, total - 1 - i);  // most recent = weight 1.0

      rawScore += (pts * strengthFactor * surpriseMult + goalFactor) * recencyWeight;
    }

    const momentumScore = Math.max(-1, Math.min(1, rawScore / 9));

    return { played, wins, draws, losses, goalsFor, goalsAgainst, momentumScore, upsetBonus };
  }

  private computeGoalInflation(wcResults: WcActualResult[]): number | null {
    if (wcResults.length < 3) return null;
    const totalGoals = wcResults.reduce((s, r) => s + r.home_goals + r.away_goals, 0);
    const wcAvgPerTeam = totalGoals / (wcResults.length * 2);
    const historicalAvg = this.goalModel.avgGoals;
    return Math.max(0.5, Math.min(3.0, +(wcAvgPerTeam / historicalAvg).toFixed(3)));
  }

  private computeGroupContext(
    fixture: import('../types/domain').Fixture,
    wcResults: WcActualResult[],
    allFixtures: Fixture[],
  ): import('../types/domain').GroupContext | null {
    if (!fixture.group_name || fixture.id.startsWith('ko:')) return null;
    const groupFixtures = allFixtures.filter(
      f => f.group_name === fixture.group_name && !f.id.startsWith('ko:'),
    );
    if (groupFixtures.length === 0) return null;

    const sorted = [...groupFixtures].sort(
      (a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''),
    );
    const fixtureIdx = sorted.findIndex(f => f.id === fixture.id);
    if (fixtureIdx < 0) return null;

    const matchDay = (fixtureIdx < 2 ? 1 : fixtureIdx < 4 ? 2 : 3) as 1 | 2 | 3;

    const playedMap = new Map<string, WcActualResult>(wcResults.map(r => [r.fixture_id, r]));
    const teamIds = [...new Set(sorted.flatMap(f => [f.home_team_id, f.away_team_id]))];
    const pts = new Map<string, number>(teamIds.map(t => [t, 0]));
    const playedCount = new Map<string, number>(teamIds.map(t => [t, 0]));

    for (const f of sorted) {
      if (f.id === fixture.id) continue;
      const r = playedMap.get(f.id);
      if (!r) continue;
      playedCount.set(f.home_team_id, (playedCount.get(f.home_team_id) ?? 0) + 1);
      playedCount.set(f.away_team_id, (playedCount.get(f.away_team_id) ?? 0) + 1);
      if (r.home_goals > r.away_goals) {
        pts.set(f.home_team_id, (pts.get(f.home_team_id) ?? 0) + 3);
      } else if (r.home_goals === r.away_goals) {
        pts.set(f.home_team_id, (pts.get(f.home_team_id) ?? 0) + 1);
        pts.set(f.away_team_id, (pts.get(f.away_team_id) ?? 0) + 1);
      } else {
        pts.set(f.away_team_id, (pts.get(f.away_team_id) ?? 0) + 3);
      }
    }

    const homeId = fixture.home_team_id;
    const awayId = fixture.away_team_id;
    const sortedByPts = [...teamIds].sort((a, b) => (pts.get(b) ?? 0) - (pts.get(a) ?? 0));
    const homePosition = sortedByPts.indexOf(homeId) + 1;
    const awayPosition = sortedByPts.indexOf(awayId) + 1;
    const homePoints = pts.get(homeId) ?? 0;
    const awayPoints = pts.get(awayId) ?? 0;
    const homePlayed = playedCount.get(homeId) ?? 0;
    const awayPlayed = playedCount.get(awayId) ?? 0;

    const secondPlacePts = pts.get(sortedByPts[1]) ?? 0;
    const homeQualified = homePoints >= 6 && homePlayed >= 2;
    const awayQualified = awayPoints >= 6 && awayPlayed >= 2;
    const homeIsEliminated = matchDay === 3 && homePosition > 2 && homePoints + 3 < secondPlacePts;
    const awayIsEliminated = matchDay === 3 && awayPosition > 2 && awayPoints + 3 < secondPlacePts;
    const bothAdvanceWithDraw = matchDay === 3 && homePosition <= 2 && awayPosition <= 2;
    const homeMustWin = matchDay >= 2 && homePosition >= 3 && !homeQualified;
    const awayMustWin = matchDay >= 2 && awayPosition >= 3 && !awayQualified;
    const isDead = (homeQualified && awayQualified) || (homeIsEliminated && awayIsEliminated);

    return {
      matchDay, homePosition, awayPosition,
      homeMustWin, awayMustWin, bothAdvanceWithDraw,
      homeIsEliminated, awayIsEliminated, isDead,
    };
  }

  private computeAllTournamentElos(
    wcResults: WcActualResult[],
    allFixtures: Fixture[],
    ratings: Rating[],
    K = 32,
  ): Map<string, number> {
    const latestElo = new Map<string, number>();
    const latestDate = new Map<string, string>();
    for (const r of ratings) {
      if (r.type !== 'elo') continue;
      const d = latestDate.get(r.team_id) ?? '';
      if (r.as_of > d) { latestElo.set(r.team_id, r.value); latestDate.set(r.team_id, r.as_of); }
    }
    const tournamentElo = new Map(latestElo);
    const fixtureMap = new Map(allFixtures.map(f => [f.id, f]));
    const sorted = [...wcResults].sort((a, b) => a.played_at.localeCompare(b.played_at));
    for (const r of sorted) {
      const f = fixtureMap.get(r.fixture_id);
      if (!f) continue;
      const hElo = tournamentElo.get(f.home_team_id) ?? 1500;
      const aElo = tournamentElo.get(f.away_team_id) ?? 1500;
      const expected = 1 / (1 + Math.pow(10, (aElo - hElo) / 400));
      const actual = r.home_goals > r.away_goals ? 1 : r.home_goals === r.away_goals ? 0.5 : 0;
      const delta = K * (actual - expected);
      tournamentElo.set(f.home_team_id, hElo + delta);
      tournamentElo.set(f.away_team_id, aElo - delta);
    }
    return tournamentElo;
  }

  buildContext(
    fixture: Fixture,
    teams: Map<string, Team>,
    ratings: Rating[],
    fixtureContexts: Map<string, import('../types/domain').FixtureContext>,
    wcResults?: WcActualResult[],
    allFixtures?: Fixture[],
  ): MatchContext {
    const homeTeam = teams.get(fixture.home_team_id) ?? {
      id: fixture.home_team_id,
      name: fixture.home_team_id,
      source: '',
    };
    const awayTeam = teams.get(fixture.away_team_id) ?? {
      id: fixture.away_team_id,
      name: fixture.away_team_id,
      source: '',
    };

    const latestRating = (teamId: string, type: 'elo' | 'fifa'): Rating | null =>
      ratings
        .filter(r => r.team_id === teamId && r.type === type)
        .sort((a, b) => new Date(b.as_of).getTime() - new Date(a.as_of).getTime())[0] ?? null;

    const recentResults = (teamId: string): MatchResult[] =>
      (this.teamResultsMap.get(teamId) ?? []).slice(0, RECENT_RESULT_COUNT);

    const tournamentEloMap = (wcResults && allFixtures && wcResults.length > 0)
      ? this.computeAllTournamentElos(wcResults, allFixtures, ratings)
      : null;

    return {
      fixture,
      homeTeam,
      awayTeam,
      homeElo: latestRating(fixture.home_team_id, 'elo'),
      awayElo: latestRating(fixture.away_team_id, 'elo'),
      homeFifaRating: latestRating(fixture.home_team_id, 'fifa'),
      awayFifaRating: latestRating(fixture.away_team_id, 'fifa'),
      homeRecentResults: recentResults(fixture.home_team_id),
      awayRecentResults: recentResults(fixture.away_team_id),
      fixtureContext: fixtureContexts.get(fixture.id) ?? null,
      homeTournamentForm: (wcResults && allFixtures)
        ? this.computeTournamentForm(fixture.home_team_id, wcResults, allFixtures, ratings)
        : null,
      awayTournamentForm: (wcResults && allFixtures)
        ? this.computeTournamentForm(fixture.away_team_id, wcResults, allFixtures, ratings)
        : null,
      tournamentGoalInflation: wcResults ? this.computeGoalInflation(wcResults) : null,
      // Daily pattern disabled: WC group stage has too few matches/day for the
      // 3-consecutive-day streak threshold to fire reliably. The pattern is still
      // computed in MatchesPage for display (TournamentPace widget) but does not
      // influence L6 predictions.
      dailyPatternSignal: null,
      groupContext: (wcResults && allFixtures)
        ? this.computeGroupContext(fixture, wcResults, allFixtures)
        : null,
      homeTournamentElo: tournamentEloMap?.get(fixture.home_team_id) ?? null,
      awayTournamentElo: tournamentEloMap?.get(fixture.away_team_id) ?? null,
    };
  }

  predict(ctx: MatchContext, modelWeights?: Map<string, number>): MatchPredictionResult {
    const squadPred = squadStrengthModelPredict(ctx, this.goalModel, this.squadStrengthMap);
    // L1 (FIFA Ranking) removed: 0.82 correlation with Elo — redundant signal.
    // L7 (Tactical Matchup) removed: static profiles, no empirical validation.
    const ladder: MatchPrediction[] = [
      nullModelPredict(ctx),
      eloModelPredict(ctx),
      eloTournamentPredict(ctx),
      recentFormModelPredict(ctx),
      this.goalModel.predict(ctx),
      squadPred,
      goalContextModelPredict(ctx, this.goalModel),
      tournamentMomentumPredict(ctx, this.goalModel),
      groupPatternPredict(ctx, this.goalModel),
      knockoutPatternPredict(ctx, this.goalModel, this.squadStrengthMap),
    ];

    return {
      fixture: ctx.fixture,
      homeTeamName: ctx.homeTeam.name,
      awayTeamName: ctx.awayTeam.name,
      predictions: ladder,
      bestPrediction: selectFinalPrediction(ladder, modelWeights, ctx.fixture),
    };
  }

  /** Predict all given fixtures in a single pass */
  predictAll(
    fixtures: Fixture[],
    teams: Map<string, Team>,
    ratings: Rating[],
    fixtureContexts: Map<string, import('../types/domain').FixtureContext>,
    wcResults?: WcActualResult[],
    modelWeights?: Map<string, number>,
  ): MatchPredictionResult[] {
    return fixtures.map(f => this.predict(this.buildContext(f, teams, ratings, fixtureContexts, wcResults, fixtures), modelWeights));
  }
}

/** Convenience: predict a one-off pair (for OracleLab).
 *
 * When the chosen pairing corresponds to a real fixture, that fixture is
 * reused so the result is identical to the Matches page (host-nation home
 * advantage, kickoff-aware daily pattern, L5 availability context). For
 * arbitrary pairings a synthetic neutral-venue fixture is used, but the
 * full WC data is still threaded through so per-team tournament momentum,
 * goal inflation and the daily scoring streak engage exactly as elsewhere.
 */
export function predictPair(
  homeId: string,
  awayId: string,
  teams: Map<string, Team>,
  ratings: Rating[],
  allResults: MatchResult[],
  opts?: {
    engine?: PredictionEngine;
    wcResults?: WcActualResult[];
    allFixtures?: Fixture[];
    fixtureContexts?: Map<string, import('../types/domain').FixtureContext>;
    modelWeights?: Map<string, number>;
  },
): MatchPredictionResult {
  const engine = opts?.engine ?? new PredictionEngine(allResults);
  const allFixtures = opts?.allFixtures ?? [];
  const real = allFixtures.find(
    f => f.home_team_id === homeId && f.away_team_id === awayId,
  );
  const fixture: Fixture = real ?? {
    id: `pair:${homeId}:${awayId}`,
    group_name: '',
    home_team_id: homeId,
    away_team_id: awayId,
    neutral_venue: true,
    is_played: false,
  };
  const ctx = engine.buildContext(
    fixture,
    teams,
    ratings,
    opts?.fixtureContexts ?? new Map(),
    opts?.wcResults,
    opts?.allFixtures,
  );
  return engine.predict(ctx, opts?.modelWeights);
}
