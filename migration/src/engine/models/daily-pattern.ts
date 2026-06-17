// =============================================================================
// Oloráculo — Daily Scoring Pattern Detector
// Detects multi-day scoring streaks in WC2026 results and signals L6 to
// amplify or dampen predictions accordingly.
//
// Pattern types (classified per calendar day in ART timezone):
//   blowout    — avg margin ≥ 2.5 (dominant wins, large scorelines)
//   draw_heavy — draw rate ≥ 50 % (lots of level matches)
//   decisive   — avg margin ≥ 1.5 (clear winners, few draws)
//   low_scoring— avg goals < 1.8  (defensive day)
//   contested  — default (balanced, close matches)
//
// A streak requires ≥ 2 consecutive days with the same pattern type.
// Modifiers only apply when the streak is confirmed (streakDays ≥ 2).
// =============================================================================

import type { Fixture, WcActualResult, DailyPatternType, DailyStats, DailyPatternSignal } from '../../types/domain';

// Require ≥3 matches to classify a day (2 is statistically too noisy for a 5-category classifier).
const MIN_MATCHES_PER_DAY = 3;

function classifyDay(avgGoals: number, avgMargin: number, drawRate: number): DailyPatternType {
  if (avgMargin >= 2.5) return 'blowout';
  if (drawRate >= 0.5)  return 'draw_heavy';
  if (avgMargin >= 1.5) return 'decisive';
  if (avgGoals < 1.8)   return 'low_scoring';
  return 'contested';
}

// Goal modifier: scales both expected goal values (total goals up/down)
// Push modifier: amplifies the directional momentum push between teams
export const PATTERN_MODIFIERS: Record<DailyPatternType, { goal: number; push: number }> = {
  blowout:     { goal: 1.12, push: 1.15 },
  decisive:    { goal: 1.07, push: 1.10 },
  contested:   { goal: 1.00, push: 1.00 },
  draw_heavy:  { goal: 0.94, push: 0.82 },
  low_scoring: { goal: 0.90, push: 0.92 },
};

// Convert UTC ISO timestamp to ART (UTC-3) calendar date string
function artDate(utcIso: string): string {
  const ms = new Date(utcIso).getTime() - 3 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Detect the current scoring streak and return a signal for L6 to consume.
 *
 * @param wcResults    - All WC matches played so far (from fixtures.json + Supabase)
 * @param allFixtures  - All fixtures (needed to look up kickoff times by fixture_id)
 * @param beforeDate   - ART date of the fixture being predicted; only days strictly
 *                       before this date contribute to the streak (prevents look-ahead)
 */
export function detectDailyPattern(
  wcResults: WcActualResult[],
  allFixtures: Fixture[],
  beforeDate: string | null,
): DailyPatternSignal | null {
  if (wcResults.length === 0) return null;

  const fixtureMap = new Map(allFixtures.map(f => [f.id, f]));

  // Group played results by ART date
  const byDate = new Map<string, { home: number; away: number }[]>();
  for (const r of wcResults) {
    const f = fixtureMap.get(r.fixture_id);
    if (!f?.kickoff_utc) continue;
    const date = artDate(f.kickoff_utc);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({ home: r.home_goals, away: r.away_goals });
  }

  // Build per-day stats; discard days with fewer than MIN_MATCHES_PER_DAY
  const dailyStats: DailyStats[] = [];
  for (const [date, matches] of byDate) {
    if (matches.length < MIN_MATCHES_PER_DAY) continue;
    const totalGoals  = matches.reduce((s, m) => s + m.home + m.away, 0);
    const totalMargin = matches.reduce((s, m) => s + Math.abs(m.home - m.away), 0);
    const draws       = matches.filter(m => m.home === m.away).length;
    const avgGoals    = totalGoals  / matches.length;
    const avgMargin   = totalMargin / matches.length;
    const drawRate    = draws       / matches.length;
    dailyStats.push({
      date,
      matchCount:  matches.length,
      avgGoals,
      avgMargin,
      drawRate,
      patternType: classifyDay(avgGoals, avgMargin, drawRate),
    });
  }

  // Sort descending — most recent day first
  dailyStats.sort((a, b) => b.date.localeCompare(a.date));

  // Only look at completed days strictly before the fixture date
  const relevant = beforeDate
    ? dailyStats.filter(d => d.date < beforeDate)
    : dailyStats;

  if (relevant.length === 0) return null;

  // Count how many consecutive days at the top share the same pattern
  const currentType = relevant[0].patternType;
  let streakDays = 1;
  for (let i = 1; i < relevant.length; i++) {
    if (relevant[i].patternType === currentType) streakDays++;
    else break;
  }

  // Require 3 consecutive days to confirm a streak — 2 days is not enough to distinguish
  // a sustained tournament pattern from random day-to-day variation.
  const isConfirmed = streakDays >= 3;
  const { goal: goalModifier, push: pushModifier } = isConfirmed
    ? PATTERN_MODIFIERS[currentType]
    : { goal: 1.0, push: 1.0 };

  return {
    currentStreak: currentType,
    streakDays,
    isConfirmed,
    goalModifier,
    pushModifier,
    recentDays: relevant.slice(0, 5),
  };
}
