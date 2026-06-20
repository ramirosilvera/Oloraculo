// Per-match goal scorer list — shows below the scoreboard in played fixtures
import type { MatchGoal } from '../services/supabase-client';

interface Props {
  fixtureId:  string;
  homeTeamId: string;
  awayTeamId: string;
  goals:      MatchGoal[];
}

const ICON: Record<MatchGoal['goal_type'], string> = {
  normal:    '⚽',
  penalty:   '🥅',
  own_goal:  '↩️',
};

const LABEL: Record<MatchGoal['goal_type'], string> = {
  normal:   '',
  penalty:  ' (P)',
  own_goal: ' (AG)',
};

export function GoalList({ fixtureId, homeTeamId, awayTeamId, goals }: Props) {
  const mine = goals.filter(g => g.fixture_id === fixtureId);
  if (mine.length === 0) return null;

  const homeGoals = mine.filter(g => g.team_id === homeTeamId);
  const awayGoals = mine.filter(g => g.team_id === awayTeamId);

  function GoalEntry({ g }: { g: MatchGoal }) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-600">
        <span>{ICON[g.goal_type]}</span>
        <span>{g.player_name}{LABEL[g.goal_type]}</span>
        {g.minute != null && <span className="text-gray-400">{g.minute}'</span>}
      </span>
    );
  }

  return (
    <div className="flex gap-4 px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px]">
      <div className="flex-1 flex flex-wrap gap-x-2 gap-y-0.5 justify-start">
        {homeGoals.map(g => <GoalEntry key={g.id} g={g} />)}
      </div>
      <div className="flex-1 flex flex-wrap gap-x-2 gap-y-0.5 justify-end">
        {awayGoals.map(g => <GoalEntry key={g.id} g={g} />)}
      </div>
    </div>
  );
}
