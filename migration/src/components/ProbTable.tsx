import type { TournamentProjection, TeamTournamentProbability } from '../types/domain';
import { FlagImg } from './ui';

function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function pct0(n: number) { return `${(n * 100).toFixed(0)}%`; }

export interface ProbTableProps {
  teams: TournamentProjection['teams'];
  getTeamName: (id: string) => string;
  onSelectTeam: (t: TeamTournamentProbability) => void;
}

export function ProbTable({ teams, getTeamName, onSelectTeam }: ProbTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-wc-navy text-white text-xs">
            <th className="text-left px-3 py-3 font-semibold w-8">#</th>
            <th className="text-left px-3 py-3 font-semibold">Equipo</th>
            <th className="text-left px-3 py-3 font-semibold">Grp</th>
            <th className="text-right px-3 py-3 font-semibold">Clasifica</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">16avos</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Cuartos</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Semis</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Final</th>
            <th className="text-right px-3 py-3 font-semibold bg-wc-navy pr-4">
              <span className="text-wc-gold font-black">Campeón</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.slice(0, 32).map((t, i) => {
            const isTop8 = i < 8;
            return (
              <tr
                key={t.teamId}
                onClick={() => onSelectTeam(t)}
                className={`cursor-pointer transition-colors hover:bg-amber-50/80 active:bg-amber-100 ${isTop8 ? 'bg-amber-50/30' : 'bg-white'}`}
              >
                <td className="px-3 py-2.5 text-gray-400 text-xs font-medium">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 font-semibold text-gray-800">
                    <FlagImg id={t.teamId} className="w-6 h-4 object-cover rounded-[2px] shrink-0" />
                    <span>{getTeamName(t.teamId)}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs font-medium">{t.group}</td>
                <td className="px-3 py-2.5 text-right text-gray-600">{pct0(t.qualify)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachRoundOf16)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachQuarterFinal)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachSemiFinal)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachFinal)}</td>
                <td className="px-3 py-2.5 text-right pr-4 bg-wc-navy/5">
                  <span className="font-black text-wc-gold text-base">{pct1(t.winTournament)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-center text-[10px] text-gray-300 py-2">Tocá una selección para ver su recorrido</p>
    </div>
  );
}
