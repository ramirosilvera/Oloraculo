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
} from '../types/domain';
import {
  nullModelPredict,
  fifaModelPredict,
  eloModelPredict,
  recentFormModelPredict,
  goalContextModelPredict,
  GoalModel,
} from './models';
import { selectFinalPrediction } from './final-selector';

const RECENT_RESULT_COUNT = 8;
const GOAL_MODEL_YEARS_WINDOW = 8;

/** Pre-built engine: fit once, predict many */
export class PredictionEngine {
  private readonly goalModel: GoalModel;

  constructor(
    private readonly allResults: MatchResult[],
    yearsWindow = GOAL_MODEL_YEARS_WINDOW,
  ) {
    this.goalModel = new GoalModel(allResults, yearsWindow);
  }

  buildContext(
    fixture: Fixture,
    teams: Map<string, Team>,
    ratings: Rating[],
    fixtureContexts: Map<string, import('../types/domain').FixtureContext>,
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
    };
  }

  predict(ctx: MatchContext): MatchPredictionResult {
    const ladder: MatchPrediction[] = [
      nullModelPredict(ctx),
      fifaModelPredict(ctx),
      eloModelPredict(ctx),
      recentFormModelPredict(ctx),
      this.goalModel.predict(ctx),
      goalContextModelPredict(ctx, this.goalModel),
    ];

    return {
      fixture: ctx.fixture,
      homeTeamName: ctx.homeTeam.name,
      awayTeamName: ctx.awayTeam.name,
      predictions: ladder,
      bestPrediction: selectFinalPrediction(ladder),
    };
  }

  /** Predict all given fixtures in a single pass */
  predictAll(
    fixtures: Fixture[],
    teams: Map<string, Team>,
    ratings: Rating[],
    fixtureContexts: Map<string, import('../types/domain').FixtureContext>,
  ): MatchPredictionResult[] {
    return fixtures.map(f => this.predict(this.buildContext(f, teams, ratings, fixtureContexts)));
  }
}

/** Convenience: predict a one-off pair (for OracleLab) */
export function predictPair(
  homeId: string,
  awayId: string,
  teams: Map<string, Team>,
  ratings: Rating[],
  allResults: MatchResult[],
): MatchPredictionResult {
  const engine = new PredictionEngine(allResults);
  const fixture: Fixture = {
    id: `pair:${homeId}:${awayId}`,
    group_name: '',
    home_team_id: homeId,
    away_team_id: awayId,
    neutral_venue: true,
    is_played: false,
  };
  const ctx = engine.buildContext(fixture, teams, ratings, new Map());
  return engine.predict(ctx);
}
