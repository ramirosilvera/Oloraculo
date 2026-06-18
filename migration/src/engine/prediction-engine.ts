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
  fifaModelPredict,
  eloModelPredict,
  recentFormModelPredict,
  goalContextModelPredict,
  GoalModel,
  tournamentMomentumPredict,
  squadStrengthModelPredict,
  buildSquadStrengthMap,
} from './models';
import { detectDailyPattern } from './models/daily-pattern';
import { selectFinalPrediction } from './final-selector';

const RECENT_RESULT_COUNT = 8;
const GOAL_MODEL_YEARS_WINDOW = 8;

/** Pre-built engine: fit once, predict many */
export class PredictionEngine {
  private readonly goalModel: GoalModel;
  private readonly squadStrengthMap: Map<string, SquadStrengthEntry>;

  constructor(
    private readonly allResults: MatchResult[],
    yearsWindow = GOAL_MODEL_YEARS_WINDOW,
    squadStrengthData: Record<string, SquadStrengthEntry> = {},
  ) {
    this.goalModel = new GoalModel(allResults, yearsWindow);
    this.squadStrengthMap = buildSquadStrengthMap(squadStrengthData);
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
      this.allResults
        .filter(r => r.home_team_id === teamId || r.away_team_id === teamId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, RECENT_RESULT_COUNT);

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
      dailyPatternSignal: (wcResults && allFixtures)
        ? detectDailyPattern(
            wcResults,
            allFixtures,
            fixture.kickoff_utc
              ? new Date(new Date(fixture.kickoff_utc).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
              : null,
          )
        : null,
    };
  }

  predict(ctx: MatchContext, modelWeights?: Map<string, number>): MatchPredictionResult {
    const ladder: MatchPrediction[] = [
      nullModelPredict(ctx),
      fifaModelPredict(ctx),
      eloModelPredict(ctx),
      recentFormModelPredict(ctx),
      this.goalModel.predict(ctx),
      squadStrengthModelPredict(ctx, this.goalModel, this.squadStrengthMap),
      goalContextModelPredict(ctx, this.goalModel),
      tournamentMomentumPredict(ctx, this.goalModel),
    ];

    return {
      fixture: ctx.fixture,
      homeTeamName: ctx.homeTeam.name,
      awayTeamName: ctx.awayTeam.name,
      predictions: ladder,
      bestPrediction: selectFinalPrediction(ladder, modelWeights),
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
