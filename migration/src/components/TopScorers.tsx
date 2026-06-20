import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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

const RANK_COLOR = ['text-amber-500', 'text-gray-400', 'text-orange-400'];
const VISIBLE_DEFAULT = 5;

export function TopScorers({ goals, teamMap, limit = 30 }: Props) {
  const [showAll, setShowAll] = useState(false);

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

  const visible = showAll ? rows : rows.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = rows.length - VISIBLE_DEFAULT;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-1.5 border-b border-gray-50">
        <span className="text-sm leading-none">👟</span>
        <span className="text-[11px] font-bold text-gray-700">Goleadores</span>
        <span className="ml-auto text-[10px] text-gray-400 font-medium">Bota de Oro</span>
      </div>

      <div className="divide-y divide-gray-50">
        {visible.map((r, i) => {
          const team = teamMap.get(r.team_id);
          return (
            <div key={`${r.player_name}-${r.team_id}`} className="flex items-center gap-2 px-3 py-1.5">
              <span className={`w-4 text-center text-[10px] font-bold shrink-0 tabular-nums ${RANK_COLOR[i] ?? 'text-gray-300'}`}>
                {i + 1}
              </span>
              <FlagImg id={r.team_id} className="w-5 h-3.5 object-cover rounded-[2px] shrink-0" />
              <span className="flex-1 min-w-0 text-xs font-semibold text-gray-800 truncate">
                {r.player_name}
                {team && <span className="font-normal text-gray-400"> · {team.name}</span>}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-sm font-bold text-gray-900 tabular-nums">{r.goals}</span>
                {r.penalties > 0 && (
                  <span className="text-[9px] text-gray-400">({r.penalties}p)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rows.length > VISIBLE_DEFAULT && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold text-gray-400 hover:text-gray-600 hover:bg-gray-50 border-t border-gray-50 transition-colors active:scale-[0.98]"
        >
          {showAll
            ? <><ChevronUp className="w-3 h-3" />Ocultar</>
            : <><ChevronDown className="w-3 h-3" />Ver {hiddenCount} más</>}
        </button>
      )}
    </div>
  );
}
