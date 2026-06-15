// =============================================================================
// TournamentPage — Monte Carlo simulation
// Migrated from: Oloraculo.Web/Components/Pages/Tournament.razor
// Simulation runs in a Web Worker to keep the UI responsive
// =============================================================================

import { useState, useCallback } from 'react';
import { useAppData } from '../hooks/useAppData';
import { saveTournamentSnapshot } from '../services/supabase-client';
import type { TournamentProjection } from '../types/domain';
import type { SimulationInput } from '../engine/simulation-engine';

const SIMULATION_COUNT = 10_000;
const SIMULATION_SEED = 2026;

function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function pct0(n: number) { return `${(n * 100).toFixed(0)}%`; }

export function TournamentPage() {
  const { groups, fixtures, results, ratings, teamMap, isLoading } = useAppData();
  const [projection, setProjection] = useState<TournamentProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const runSimulation = useCallback(async () => {
    if (busy || groups.length === 0) return;
    setBusy(true);
    setError('');
    setSaved(false);

    try {
      const input: SimulationInput = {
        groups,
        fixtures,
        allResults: results,
        ratings,
        simulations: SIMULATION_COUNT,
        seed: SIMULATION_SEED,
      };

      // Run in a Web Worker to avoid blocking the UI
      const worker = new Worker(
        new URL('../workers/simulation.worker.ts', import.meta.url),
        { type: 'module' },
      );

      const result = await new Promise<TournamentProjection>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: TournamentProjection; error?: string }>) => {
          worker.terminate();
          if (e.data.ok && e.data.result) resolve(e.data.result);
          else reject(new Error(e.data.error ?? 'Simulation failed'));
        };
        worker.onerror = reject;
        worker.postMessage(input);
      });

      setProjection(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [groups, fixtures, results, ratings, busy]);

  const saveSnapshot = async () => {
    if (!projection) return;
    setSaving(true);
    try {
      await saveTournamentSnapshot(projection, {
        modelName: projection.modelName,
        inputSummaryHash: projection.inputSummaryHash,
      });
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-gray-500">Cargando datos…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Torneo</h1>
        <p className="text-gray-500 mt-1">
          Proyección Monte Carlo con la estructura oficial de grupos y eliminación directa de 2026.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runSimulation}
            disabled={busy}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {busy ? '⏳ Simulando…' : '▶ Correr simulación'}
          </button>

          {projection && (
            <button
              onClick={saveSnapshot}
              disabled={saving || saved}
              className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saved ? '✓ Guardado' : saving ? 'Guardando…' : '💾 Guardar snapshot'}
            </button>
          )}

          <span className="ml-auto text-sm text-gray-500">
            {SIMULATION_COUNT.toLocaleString('es')} simulaciones
          </span>
        </div>

        {busy && (
          <div className="mt-4">
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full animate-pulse w-3/4" />
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Corriendo {SIMULATION_COUNT.toLocaleString('es')} simulaciones…
            </p>
          </div>
        )}

        {projection && (
          <p className="text-xs text-gray-400 mt-3">
            {projection.simulations.toLocaleString('es')} simulaciones · {projection.inputSummaryHash}
          </p>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      )}

      {projection && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Probabilidad de campeón</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Equipo</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Grp</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Clasifica</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">16avos</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">4tos</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Semis</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Final</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 pr-5">Campeón</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projection.teams.slice(0, 32).map((t, i) => (
                  <tr key={t.teamId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {teamMap.get(t.teamId)?.name ?? t.teamId}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{t.group}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{pct0(t.qualify)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{pct0(t.reachRoundOf16)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{pct0(t.reachQuarterFinal)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{pct0(t.reachSemiFinal)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{pct0(t.reachFinal)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-blue-700 pr-5">{pct1(t.winTournament)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
