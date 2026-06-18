// Smoke test: the tournament simulation now runs on the full prediction
// engine (same as the Matches page). Loads real static data and asserts the
// projection is well-formed and probabilities are coherent.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSimulation, type SimulationInput } from './simulation-engine';
import type { Group, Fixture, Rating, Team, MatchResult, WcActualResult } from '../types/domain';

const DATA = resolve(__dirname, '../../public/data');
const readJson = (f: string) => JSON.parse(readFileSync(resolve(DATA, f), 'utf-8'));

function loadResults(): MatchResult[] {
  const { cols, rows } = readJson('historical_results.json') as { cols: string[]; rows: unknown[][] };
  const idx = (c: string) => cols.indexOf(c);
  return rows.map((r, i) => ({
    id: String(i),
    date: String(r[idx('date')]),
    home_team_id: String(r[idx('home_id')]),
    away_team_id: String(r[idx('away_id')]),
    home_goals: Number(r[idx('home_goals')]),
    away_goals: Number(r[idx('away_goals')]),
    tournament: String(r[idx('tournament')]),
    neutral: Boolean(r[idx('neutral')]),
  }));
}

describe('tournament simulation (full engine)', () => {
  it('produces a coherent projection', async () => {
    const groups   = readJson('groups.json') as Group[];
    const fixtures = readJson('fixtures.json') as Fixture[];
    const ratings  = readJson('ratings.json') as Rating[];
    const teams    = readJson('teams.json') as Team[];
    const results  = loadResults();
    const wcResults: WcActualResult[] = fixtures
      .filter(f => f.is_played && f.home_goals != null && f.away_goals != null)
      .map((f, i) => ({
        id: i,
        fixture_id: f.id,
        home_goals: f.home_goals!,
        away_goals: f.away_goals!,
        played_at: f.kickoff_utc ?? new Date().toISOString(),
      }));

    const input: SimulationInput = {
      groups, fixtures, allResults: results, ratings, teams, wcResults,
      simulations: 200, seed: 2026,
    };

    const proj = runSimulation(input);
    const teamCount = groups.flatMap(g => g.team_ids).length;

    expect(proj.teams).toHaveLength(teamCount);

    // Every probability is a valid fraction.
    for (const t of proj.teams) {
      for (const p of [t.qualify, t.reachRoundOf16, t.reachQuarterFinal, t.reachSemiFinal, t.reachFinal, t.winTournament]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      // Monotonic down the bracket.
      expect(t.qualify).toBeGreaterThanOrEqual(t.reachQuarterFinal);
      expect(t.reachQuarterFinal).toBeGreaterThanOrEqual(t.reachSemiFinal);
      expect(t.reachSemiFinal).toBeGreaterThanOrEqual(t.reachFinal);
      expect(t.reachFinal).toBeGreaterThanOrEqual(t.winTournament);
    }

    // Exactly one champion per simulation → champion probs sum to ~1.
    const champSum = proj.teams.reduce((s, t) => s + t.winTournament, 0);
    expect(champSum).toBeGreaterThan(0.99);
    expect(champSum).toBeLessThan(1.01);

    // Deterministic for a fixed seed.
    const proj2 = runSimulation(input);
    expect(proj2.teams[0].teamId).toBe(proj.teams[0].teamId);
    expect(proj2.teams[0].winTournament).toBe(proj.teams[0].winTournament);
  }, 20000);
});
