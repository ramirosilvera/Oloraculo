// =============================================================================
// PerformancePage — Model accuracy metrics (Brier / RPS / LogLoss)
// Migrated from: Oloraculo.Web/Components/Pages/Performance.razor
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import { loadEvaluations } from '../services/supabase-client';
import type { ModelPerformanceRow, PredictionEvaluation } from '../types/domain';

function groupEvaluations(evals: PredictionEvaluation[]): ModelPerformanceRow[] {
  const byModel = new Map<string, PredictionEvaluation[]>();
  for (const e of evals) {
    const arr = byModel.get(e.model_name) ?? [];
    arr.push(e);
    byModel.set(e.model_name, arr);
  }
  return [...byModel.entries()].map(([modelName, rows]) => ({
    modelName,
    count: rows.length,
    topPickAccuracy: rows.filter(r => r.top_pick_correct).length / rows.length,
    avgBrierScore: rows.reduce((s, r) => s + r.brier_score, 0) / rows.length,
    avgRps: rows.reduce((s, r) => s + r.ranked_probability_score, 0) / rows.length,
    avgLogLoss: rows.reduce((s, r) => s + r.log_loss, 0) / rows.length,
  })).sort((a, b) => a.avgBrierScore - b.avgBrierScore);
}

function Score({ value, low = false }: { value: number; low?: boolean }) {
  const color = low
    ? value < 0.2 ? 'text-green-700' : value < 0.3 ? 'text-yellow-700' : 'text-red-700'
    : value > 0.7 ? 'text-green-700' : value > 0.5 ? 'text-yellow-700' : 'text-red-700';
  return <span className={`font-medium ${color}`}>{value.toFixed(3)}</span>;
}

export function PerformancePage() {
  const { teamMap } = useAppData();
  const { data: evals, isLoading } = useQuery({
    queryKey: ['evaluations'],
    queryFn: loadEvaluations,
  });

  if (isLoading) return <div className="p-6 text-gray-500">Cargando evaluaciones…</div>;

  if (!evals || evals.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rendimiento</h1>
          <p className="text-gray-500 mt-1">Precisión de los modelos comparada con resultados reales.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Sin evaluaciones todavía. Registrá resultados reales en la página de <strong>Partidos</strong> para ver las métricas.
        </div>
      </div>
    );
  }

  const rows = groupEvaluations(evals);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Rendimiento</h1>
        <p className="text-gray-500 mt-1">
          Precisión de los modelos comparada con {evals.length} resultado{evals.length !== 1 ? 's' : ''} real{evals.length !== 1 ? 'es' : ''}.
        </p>
      </div>

      {/* Summary table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Métricas por modelo</h2>
          <p className="text-xs text-gray-400 mt-0.5">Brier Score y LogLoss: menor = mejor · Aciertos: mayor = mejor</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Modelo</th>
                <th className="text-right px-4 py-3 font-medium">N</th>
                <th className="text-right px-4 py-3 font-medium">Aciertos</th>
                <th className="text-right px-4 py-3 font-medium">Brier ↓</th>
                <th className="text-right px-4 py-3 font-medium">RPS ↓</th>
                <th className="text-right px-5 py-3 font-medium">LogLoss ↓</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={row.modelName} className={`hover:bg-gray-50 ${i === 0 ? 'bg-green-50/40' : ''}`}>
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {i === 0 && <span className="mr-1 text-green-600">★</span>}
                    {row.modelName}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{row.count}</td>
                  <td className="px-4 py-3 text-right"><Score value={row.topPickAccuracy} /></td>
                  <td className="px-4 py-3 text-right"><Score value={row.avgBrierScore} low /></td>
                  <td className="px-4 py-3 text-right"><Score value={row.avgRps} low /></td>
                  <td className="px-5 py-3 text-right"><Score value={row.avgLogLoss} low /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Individual evaluations */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Detalle por partido</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Partido</th>
                <th className="text-left px-4 py-3 font-medium">Resultado</th>
                <th className="text-left px-4 py-3 font-medium">Modelo</th>
                <th className="text-right px-4 py-3 font-medium">Prob. ganador</th>
                <th className="text-right px-4 py-3 font-medium">Acierto</th>
                <th className="text-right px-5 py-3 font-medium">Brier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {evals.map(e => {
                const home = teamMap.get(e.home_team_id)?.name ?? e.home_team_id;
                const away = teamMap.get(e.away_team_id)?.name ?? e.away_team_id;
                const winProb = e.actual === 'Home' ? e.home_win : e.actual === 'Away' ? e.away_win : e.draw;
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-800">{home} vs {away}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-medium">{e.home_goals}–{e.away_goals}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{e.model_name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{(winProb * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right">
                      {e.top_pick_correct
                        ? <span className="text-green-700 font-medium">✓</span>
                        : <span className="text-red-600">✗</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right"><Score value={e.brier_score} low /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
