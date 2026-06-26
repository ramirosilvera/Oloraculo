// Slide-in panel showing a team's most likely journey through the tournament.
// Used by TournamentPage and TournamentSnapshotsPage.

import { useEffect } from 'react';
import type { TeamTournamentProbability, JourneyRound, Team } from '../types/domain';
import { FlagImg } from './ui';
import { Trophy, X } from 'lucide-react';

const ROUND_LABELS: Record<string, string> = {
  r32Journey: 'Dieciséisavos',
  r16Journey: 'Octavos de final',
  qfJourney:  'Cuartos de final',
  sfJourney:  'Semifinal',
  finJourney: 'Final',
};

const ROUND_KEYS = ['r32Journey', 'r16Journey', 'qfJourney', 'sfJourney', 'finJourney'] as const;
type RoundKey = typeof ROUND_KEYS[number];

const ROUND_PROB: Record<RoundKey, keyof TeamTournamentProbability> = {
  r32Journey: 'qualify',
  r16Journey: 'reachRoundOf16',
  qfJourney:  'reachQuarterFinal',
  sfJourney:  'reachSemiFinal',
  finJourney: 'reachFinal',
};

function pct0(n: number) { return `${(n * 100).toFixed(0)}%`; }
function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }

function RoundCard({
  roundKey,
  journey,
  reachProb,
  getTeamName,
}: {
  roundKey: RoundKey;
  journey: JourneyRound | undefined;
  reachProb: number;
  getTeamName: (id: string) => string;
}) {
  const label = ROUND_LABELS[roundKey];

  if (reachProb < 0.005) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50/60 opacity-40">
        <div className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <span className="ml-auto text-xs text-gray-300 tabular-nums">0%</span>
      </div>
    );
  }

  if (!journey) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100">
        <div className="w-2 h-2 rounded-full bg-wc-navy/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-600">{label}</p>
          <p className="text-xs text-gray-400">clasifica: {pct0(reachProb)}</p>
        </div>
      </div>
    );
  }

  const oppFreq  = journey.facedCount / journey.totalReached;
  const winRate  = journey.wins / journey.totalReached;
  const winVsTop = journey.winsVsMostLikely / journey.facedCount;
  const isGood   = winRate >= 0.5;

  return (
    <div className={`rounded-xl border px-3 py-2.5 space-y-2 ${isGood ? 'border-green-100 bg-green-50/40' : 'border-gray-100 bg-gray-50/40'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isGood ? 'bg-green-400' : 'bg-gray-300'}`} />
          <span className="text-xs font-bold text-gray-700">{label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-gray-400 tabular-nums">clasifica {pct0(reachProb)}</span>
          <span className={`text-xs font-bold tabular-nums ${isGood ? 'text-green-600' : 'text-orange-500'}`}>
            pasa {pct0(winRate)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-4">
        <FlagImg id={journey.mostLikelyOpponentId} className="w-6 h-4 object-cover rounded-[2px] shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-gray-700 truncate block">
            vs {getTeamName(journey.mostLikelyOpponentId)}
          </span>
          <span className="text-[10px] text-gray-400 tabular-nums">
            rival en {pct0(oppFreq)} de las sims · ganó {pct0(winVsTop)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  team: TeamTournamentProbability;
  teamMap: Map<string, Team>;
  simulations: number;
  onClose: () => void;
}

export function TeamJourneyPanel({ team, teamMap, simulations, onClose }: Props) {
  const getTeamName = (id: string) => teamMap.get(id)?.name ?? id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[22rem] bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in-right">

        {/* Header */}
        <div className="bg-wc-gradient px-5 py-5 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FlagImg id={team.teamId} className="w-10 h-7 object-cover rounded-[3px] shadow shrink-0" />
              <div className="min-w-0">
                <p className="text-white/55 text-[10px] font-bold uppercase tracking-widest">Recorrido más probable</p>
                <h2 className="text-xl font-black leading-tight truncate">{getTeamName(team.teamId)}</h2>
                <p className="text-white/60 text-xs">Grupo {team.group}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3 bg-white/10 rounded-xl px-4 py-2.5">
            <Trophy className="w-5 h-5 text-wc-gold shrink-0" />
            <div>
              <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold">Probabilidad de Campeón</p>
              <p className="text-2xl font-black text-wc-gold leading-none">{pct1(team.winTournament)}</p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Group stage */}
          <section>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Fase de grupos</h3>
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-gray-400 font-medium">Pts prom.</p>
                  <p className="text-lg font-black text-wc-navy tabular-nums">{team.expectedGroupPoints.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-medium">GF prom.</p>
                  <p className="text-lg font-black text-wc-navy tabular-nums">
                    {team.avgGroupGoalsFor != null ? team.avgGroupGoalsFor.toFixed(1) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-medium">GC prom.</p>
                  <p className="text-lg font-black text-gray-500 tabular-nums">
                    {team.avgGroupGoalsAgainst != null ? team.avgGroupGoalsAgainst.toFixed(1) : '—'}
                  </p>
                </div>
              </div>

              {team.groupPositions && (
                <div>
                  <p className="text-[10px] text-gray-400 font-medium mb-1.5">Posición final en el grupo</p>
                  <div className="flex gap-1">
                    {(['1°', '2°', '3°', '4°'] as const).map((label, i) => {
                      const frac = team.groupPositions![i];
                      const qual = i < 2;
                      const dominant = frac > 0.4;
                      return (
                        <div key={i} className="flex-1 text-center">
                          <div className={`text-xs font-bold py-1.5 rounded-lg tabular-nums ${
                            qual && dominant ? 'bg-wc-navy text-white'
                            : qual          ? 'bg-wc-navy/10 text-wc-navy'
                            :                 'bg-gray-100 text-gray-400'
                          }`}>
                            {pct0(frac)}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Knockout journey */}
          <section>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Fase eliminatoria</h3>
            <div className="space-y-1.5">
              {ROUND_KEYS.map(rk => (
                <RoundCard
                  key={rk}
                  roundKey={rk}
                  journey={team[rk]}
                  reachProb={team[ROUND_PROB[rk]] as number}
                  getTeamName={getTeamName}
                />
              ))}

              {team.winTournament > 0.003 && (
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
                  team.winTournament > 0.08
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-100 bg-gray-50/60'
                }`}>
                  <Trophy className={`w-4 h-4 shrink-0 ${team.winTournament > 0.08 ? 'text-amber-500' : 'text-gray-300'}`} />
                  <span className="text-xs font-bold text-gray-700 flex-1">Campeón del Mundial</span>
                  <span className={`text-sm font-black tabular-nums ${
                    team.winTournament > 0.08 ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    {pct1(team.winTournament)}
                  </span>
                </div>
              )}
            </div>
          </section>

          <p className="text-center text-[10px] text-gray-300 pb-2">
            Basado en {simulations.toLocaleString('es')} simulaciones Monte Carlo
          </p>
        </div>
      </div>
    </>
  );
}
