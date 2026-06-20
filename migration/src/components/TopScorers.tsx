// Global top-scorers leaderboard — the "Bota de Oro" table
import type { MatchGoal } from '../services/supabase-client';
import type { Team } from '../types/domain';
import { FlagImg } from './ui';

interface Props {
  goals:   MatchGoal[];
  teamMap: Map<string, Team>;
  limit?:  number;
}

interface PlayerRow {
  player_name: string;
  team_id:     string;
  goals:       number;
  penalties:   number;
}

export function TopScorers({ goals, teamMap, limit = 20 }: Props) {
  // Aggregate by player + team (exclude own goals from the scorer's tally)
  const map = new Map<string, PlayerRow>();
  for (const g of goals) {
    if (g.goal_type === 'own_goal') continue;
    const key = `${g.player_name}::${g.team_id}`;
    const row = map.get(key) ?? { player_name: g.player_name, team_id: g.team_id, goals: 0, penalties: 0 };
    row.goals++;
    if (g.goal_type === 'penalty') row.penalties++;
    map.set(key, row);
  }

  const rows = [...map.values()]
    .sort((a, b) => b.goals - a.goals || a.penalties - b.penalties)
    .slice(0, limit);

  if (rows.length === 0) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <span className="text-base leading-none">👟</span>
        <span className="text-xs font-bold text-gray-800">Goleadores</span>
        <span className="ml-auto text-[10px] text-gray-400">Bota de Oro</span>
      </div>
      <div className="divide-y divide-gray-50">
        {rows.map((r, i) => {
          const team = teamMap.get(r.team_id);
          return (
            <div key={`${r.player_name}-${r.team_id}`} className="flex items-center gap-3 px-4 py-2">
              {/* Rank */}
              <span className={`w-5 text-center text-[11px] font-bold shrink-0
                ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-gray-300'}`}>
                {i + 1}
              </span>

              {/* Flag */}
              <FlagImg id={r.team_id} className="w-5 h-3.5 object-cover rounded-[2px] shrink-0" />

              {/* Player name + team */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">{r.player_name}</p>
                <p className="text-[10px] text-gray-400 truncate">{team?.name ?? r.team_id}</p>
              </div>

              {/* Goals */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-sm font-bold text-gray-900">{r.goals}</span>
                {r.penalties > 0 && (
                  <span className="text-[9px] text-gray-400">({r.penalties}P)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
