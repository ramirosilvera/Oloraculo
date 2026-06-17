import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import { loadTournamentSnapshots } from '../services/supabase-client';
import type { PredictionSnapshot, TournamentProjection } from '../types/domain';
import { Button, Badge, Card, CardHeader, Skeleton, SectionTitle, FlagImg } from '../components/ui';
import { TeamJourneyPanel } from '../components/TeamJourneyPanel';
import { History, Trophy, ChevronRight, Clock, Zap } from 'lucide-react';
import type { TeamTournamentProbability } from '../types/domain';

function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function pct0(n: number) { return `${(n * 100).toFixed(0)}%`;  }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function topChampion(projection: TournamentProjection): TournamentProjection['teams'][number] | null {
  if (!projection.teams.length) return null;
  return [...projection.teams].sort((a, b) => b.winTournament - a.winTournament)[0];
}

interface ProbTableProps {
  teams: TournamentProjection['teams'];
  getTeamName: (id: string) => string;
  onSelectTeam: (t: TeamTournamentProbability) => void;
}

function ProbTable({ teams, getTeamName, onSelectTeam }: ProbTableProps) {
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

interface SnapItemProps {
  snap: PredictionSnapshot;
  isSelected: boolean;
  getTeamName: (id: string) => string;
  onClick: () => void;
}

function SnapItem({ snap, isSelected, getTeamName, onClick }: SnapItemProps) {
  const projection = snap.payload as TournamentProjection;
  const champion   = topChampion(projection);
  const simCount   = projection?.simulations?.toLocaleString('es') ?? '—';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        isSelected
          ? 'border-wc-gold bg-amber-50/40 shadow-sm'
          : 'border-gray-200 bg-white hover:border-wc-navy/30 hover:bg-wc-cream/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate">{formatDate(snap.created_at)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Zap className="w-3 h-3 shrink-0" />
            <span>{simCount} simulaciones</span>
          </div>
        </div>

        {champion && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <FlagImg id={champion.teamId} className="w-8 h-5 object-cover rounded-[2px]" />
            <span className="text-xs font-bold text-wc-navy leading-tight text-right">
              {getTeamName(champion.teamId)}
            </span>
            <Badge color="gold">{pct1(champion.winTournament)}</Badge>
          </div>
        )}
      </div>
    </button>
  );
}

export function TournamentSnapshotsPage() {
  const { teamMap, isLoading: appLoading } = useAppData();
  const [selected, setSelected]             = useState<PredictionSnapshot | null>(null);
  const [showDetail, setShowDetail]         = useState(false);
  const [selectedTeam, setSelectedTeam]     = useState<TeamTournamentProbability | null>(null);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['tournament-snapshots'],
    queryFn: loadTournamentSnapshots,
  });

  const getTeamName = (id: string) => teamMap.get(id)?.name ?? id;

  const handleSelect = (snap: PredictionSnapshot) => {
    if (selected?.id === snap.id) {
      setShowDetail(v => !v);
    } else {
      setSelected(snap);
      setShowDetail(true);
    }
  };

  const projection = selected?.payload as TournamentProjection | undefined;

  if (isLoading || appLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const empty = !snapshots || snapshots.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle sub="Comparé cómo evolucionan las probabilidades a medida que avanza el torneo">
          <span className="flex items-center gap-2">
            <History className="w-6 h-6 text-wc-gold inline" />
            Historial de Simulaciones
          </span>
        </SectionTitle>
        <Link to="/tournament">
          <Button variant="secondary" size="sm">
            <Trophy className="w-3.5 h-3.5" />
            Nueva simulación
          </Button>
        </Link>
      </div>

      {empty && (
        <Card className="p-8 sm:p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-wc-navy/5 flex items-center justify-center">
            <History className="w-8 h-8 text-wc-navy/25" />
          </div>
          <p className="text-gray-500 font-semibold mb-1">Aún no guardaste ninguna simulación</p>
          <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
            Corré una simulación y guardala para ver cómo cambian las probabilidades a lo largo del torneo.
          </p>
          <Link to="/tournament">
            <Button variant="primary">
              Ir a simular
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        </Card>
      )}

      {selectedTeam && selected && (
        <TeamJourneyPanel
          team={selectedTeam}
          teamMap={teamMap}
          simulations={(selected.payload as TournamentProjection).simulations}
          onClose={() => setSelectedTeam(null)}
        />
      )}

      {!empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          <div className="space-y-2 md:col-span-1">
            {snapshots!.map(snap => (
              <SnapItem
                key={snap.id}
                snap={snap}
                isSelected={selected?.id === snap.id}
                getTeamName={getTeamName}
                onClick={() => handleSelect(snap)}
              />
            ))}
          </div>

          <div className={`md:col-span-2 ${showDetail || selected ? 'block' : 'hidden md:block'}`}>
            {!selected && (
              <Card className="p-10 text-center hidden md:block">
                <Trophy className="w-8 h-8 text-wc-navy/20 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">
                  Seleccioná una simulación para ver las probabilidades
                </p>
              </Card>
            )}

            {selected && projection && (
              <Card className="overflow-hidden animate-fade-in">
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-wc-gold" />
                      <h2 className="font-black text-wc-navy text-base">Probabilidades del torneo</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-400">{formatDate(selected.created_at)}</span>
                      <button
                        onClick={() => setShowDetail(false)}
                        className="md:hidden ml-1 -mr-1 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors text-lg leading-none"
                        aria-label="Cerrar detalle"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <ProbTable teams={projection.teams} getTeamName={getTeamName} onSelectTeam={setSelectedTeam} />
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
