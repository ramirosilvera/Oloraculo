// =============================================================================
// TournamentSnapshotsPage — History of saved Monte Carlo simulations
// Migrated from: Oloraculo.Web/Components/Pages/TournamentSnapshots.razor
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import { loadTournamentSnapshots } from '../services/supabase-client';
import type { PredictionSnapshot, TournamentProjection } from '../types/domain';

function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function pct0(n: number) { return `${(n * 100).toFixed(0)}%`; }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function TournamentSnapshotsPage() {
  const { teamMap } = useAppData();
  const [selected, setSelected] = useState<PredictionSnapshot | null>(null);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['tournament-snapshots'],
    queryFn: loadTournamentSnapshots,
  });

  if (isLoading) return <div className="p-6 text-gray-500">Cargando snapshots…</div>;

  const projection = selected?.payload as TournamentProjection | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Snapshots de Torneo</h1>
        <p className="text-gray-500 mt-1">Historial de simulaciones Monte Carlo guardadas.</p>
      </div>

      {(!snapshots || snapshots.length === 0) && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          No hay snapshots guardados todavía. Corré una simulación en la página de <strong>Torneo</strong> y hacé clic en "Guardar snapshot".
        </div>
      )}

      {snapshots && snapshots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: list */}
          <div className="space-y-2">
            {snapshots.map(snap => (
              <button
                key={snap.id}
                onClick={() => setSelected(selected?.id === snap.id ? null : snap)}
                className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${
                  selected?.id === snap.id
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="font-medium">{snap.model_name || 'Oráculo'}</div>
                <div className="text-xs text-gray-400 mt-0.5">{formatDate(snap.created_at)}</div>
                <div className="text-xs text-gray-400">
                  {(snap.payload as TournamentProjection)?.simulations?.toLocaleString('es') ?? '—'} simulaciones
                </div>
              </button>
            ))}
          </div>

          {/* Right: detail */}
          <div className="md:col-span-2">
            {!selected && (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
                Seleccioná un snapshot para ver los resultados
              </div>
            )}

            {selected && projection && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800">Probabilidades del torneo</h2>
                  <span className="text-xs text-gray-400">{formatDate(selected.created_at)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">#</th>
                        <th className="text-left px-4 py-2 font-medium">Equipo</th>
                        <th className="text-left px-4 py-2 font-medium">Grp</th>
                        <th className="text-right px-4 py-2 font-medium">Clasif</th>
                        <th className="text-right px-4 py-2 font-medium">Semis</th>
                        <th className="text-right px-4 py-2 font-medium">Final</th>
                        <th className="text-right px-4 py-2 font-medium pr-4">Campeón</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {projection.teams.slice(0, 32).map((t, i) => (
                        <tr key={t.teamId} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {teamMap.get(t.teamId)?.name ?? t.teamId}
                          </td>
                          <td className="px-4 py-2 text-gray-500">{t.group}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{pct0(t.qualify)}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{pct0(t.reachSemiFinal)}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{pct0(t.reachFinal)}</td>
                          <td className="px-4 py-2 text-right font-bold text-blue-700 pr-4">{pct1(t.winTournament)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
