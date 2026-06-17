import { useQuery } from '@tanstack/react-query';
import { BarChart2, TrendingDown, CheckCircle2, Zap, AlertTriangle, Info } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { loadEvaluations } from '../services/supabase-client';
import type { ModelPerformanceRow, PredictionEvaluation, WcActualResult } from '../types/domain';
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  Tooltip,
  SectionTitle,
  SkeletonCard,
  Skeleton,
} from '../components/ui';

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

const WC_HISTORICAL_GOALS_PER_MATCH = 2.50;
const BASE_BOOST = 0.28;  // keep in sync with tournament-momentum.ts

// ---------------------------------------------------------------------------
// CalibrationCard — analyzes actual WC results vs model predictions
// to show if BOOST needs tuning
// ---------------------------------------------------------------------------
function CalibrationCard({ evals, wcResults }: { evals: PredictionEvaluation[]; wcResults: WcActualResult[] }) {
  if (evals.length < 3) {
    return (
      <div className="p-5 text-center text-gray-400 text-sm">
        Necesitás al menos 3 resultados evaluados para ver la calibración.
      </div>
    );
  }

  const n = evals.length;

  // Actual WC goals
  const totalActualGoals = wcResults.reduce((s, r) => s + r.home_goals + r.away_goals, 0);
  const evalTotalGoals = evals.reduce((s, e) => s + e.home_goals + e.away_goals, 0);
  const evalN = wcResults.length > 0 ? wcResults.length : n;
  const actualGoalsPerMatch = wcResults.length > 0
    ? totalActualGoals / wcResults.length
    : evalTotalGoals / n;
  const inflationFactor = actualGoalsPerMatch / WC_HISTORICAL_GOALS_PER_MATCH;

  // Draw calibration
  const actualDrawRate = evals.filter(e => e.actual === 'Draw').length / n;
  const avgModelDrawProb = evals.reduce((s, e) => s + e.draw, 0) / n;
  const drawBias = actualDrawRate - avgModelDrawProb;

  // Goal margin calibration
  const avgActualMargin = evals.reduce((s, e) => s + Math.abs(e.home_goals - e.away_goals), 0) / n;

  // Dynamic boost (mirror of tournament-momentum.ts logic)
  const currentDynamicBoost = Math.min(0.88, Math.max(0.28, BASE_BOOST * Math.sqrt(inflationFactor)));

  // BOOST recommendation
  let boostSignal: 'ok' | 'high' | 'low' = 'ok';
  let boostMessage = '';
  if (drawBias > 0.06) {
    boostSignal = 'high';
    boostMessage = `El modelo predice muy pocos empates (${(avgModelDrawProb * 100).toFixed(1)}%) vs los reales (${(actualDrawRate * 100).toFixed(1)}%). El momentum es demasiado agresivo.`;
  } else if (drawBias < -0.06) {
    boostSignal = 'low';
    boostMessage = `El modelo predice demasiados empates (${(avgModelDrawProb * 100).toFixed(1)}%) vs los reales (${(actualDrawRate * 100).toFixed(1)}%). El momentum es muy conservador.`;
  } else {
    boostMessage = `Tasa de empates calibrada: real ${(actualDrawRate * 100).toFixed(1)}% vs modelo ${(avgModelDrawProb * 100).toFixed(1)}%.`;
  }

  const rows = [
    {
      label: 'Goles por partido (WC2026)',
      value: actualGoalsPerMatch.toFixed(2),
      sub: `${evalN} partidos · histórico 2.50`,
      highlight: inflationFactor >= 1.3 ? 'text-orange-600' : inflationFactor <= 0.9 ? 'text-blue-600' : 'text-gray-800',
    },
    {
      label: 'Factor de inflación',
      value: `×${inflationFactor.toFixed(2)}`,
      sub: inflationFactor >= 1.5 ? '🔥 Mundial muy goleador' : inflationFactor >= 1.15 ? '⚡ Ritmo alto' : inflationFactor >= 0.9 ? '📊 Ritmo histórico' : '🧱 Ritmo defensivo',
      highlight: inflationFactor >= 1.3 ? 'text-orange-600' : 'text-gray-800',
    },
    {
      label: 'Margen goleador promedio',
      value: avgActualMargin.toFixed(2),
      sub: '|goles local − goles visitante| real',
      highlight: 'text-gray-800',
    },
    {
      label: 'Empates reales vs predichos',
      value: `${(actualDrawRate * 100).toFixed(1)}% vs ${(avgModelDrawProb * 100).toFixed(1)}%`,
      sub: drawBias > 0.06 ? '↑ modelo subestima empates' : drawBias < -0.06 ? '↓ modelo sobrestima empates' : '✓ calibrado',
      highlight: Math.abs(drawBias) > 0.06 ? 'text-amber-600' : 'text-green-700',
    },
    {
      label: 'Boost dinámico actual (L6)',
      value: `×${currentDynamicBoost.toFixed(2)}`,
      sub: `BASE(${BASE_BOOST}) × √inflación(${inflationFactor.toFixed(2)})`,
      highlight: 'text-wc-navy',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rows.map(r => (
          <div key={r.label} className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">{r.label}</p>
            <p className={`text-xl font-black tabular-nums ${r.highlight}`}>{r.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{r.sub}</p>
          </div>
        ))}
      </div>

      <div className={`flex items-start gap-3 p-4 rounded-xl ${
        boostSignal === 'high' ? 'bg-amber-50 border border-amber-200' :
        boostSignal === 'low' ? 'bg-blue-50 border border-blue-200' :
        'bg-green-50 border border-green-200'
      }`}>
        {boostSignal === 'ok'
          ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        }
        <div>
          <p className={`font-bold text-sm ${boostSignal === 'ok' ? 'text-green-700' : 'text-amber-700'}`}>
            {boostSignal === 'ok' ? 'Momentum bien calibrado' : boostSignal === 'high' ? 'Momentum demasiado agresivo' : 'Momentum muy conservador'}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">{boostMessage}</p>
          {boostSignal !== 'ok' && n >= 5 && (
            <p className="text-xs text-gray-500 mt-1">
              Boost recomendado: ≈ ×{Math.min(0.88, Math.max(0.28, currentDynamicBoost * (avgModelDrawProb / Math.max(0.01, actualDrawRate)))).toFixed(2)}
              {' '}(ajuste manual en <code className="bg-gray-100 px-1 rounded">tournament-momentum.ts → BASE_BOOST</code>)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreCell({ value, low = false }: { value: number; low?: boolean }) {
  const color = low
    ? value < 0.2 ? 'text-green-700' : value < 0.3 ? 'text-amber-600' : 'text-red-600'
    : value > 0.7 ? 'text-green-700' : value > 0.5 ? 'text-amber-600' : 'text-red-600';
  return <span className={`font-semibold tabular-nums ${color}`}>{value.toFixed(3)}</span>;
}

export function PerformancePage() {
  const { teamMap, wcResults } = useAppData();
  const { data: evals, isLoading } = useQuery({
    queryKey: ['evaluations'],
    queryFn: loadEvaluations,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando evaluaciones…">Rendimiento del Modelo</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <Card>
          <CardHeader><Skeleton className="h-4 w-40" /></CardHeader>
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </Card>
      </div>
    );
  }

  if (!evals || evals.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Precisión de los modelos comparada con resultados reales.">
          Rendimiento del Modelo
        </SectionTitle>
        <Card className="p-10 text-center">
          <BarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Aún no hay evaluaciones disponibles.</p>
          <p className="text-sm text-gray-400 mt-1">
            Registrá resultados reales en la página de <strong>Partidos</strong> para ver las métricas.
          </p>
        </Card>
      </div>
    );
  }

  const rows = groupEvaluations(evals);

  const totalPreds = evals.length;
  const avgBrier = evals.reduce((s, e) => s + e.brier_score, 0) / evals.length;
  const avgRps = evals.reduce((s, e) => s + e.ranked_probability_score, 0) / evals.length;
  const accuracy = evals.filter(e => e.top_pick_correct).length / evals.length;

  return (
    <div className="space-y-6">
      <SectionTitle sub={`Precisión de los modelos comparada con ${evals.length} resultado${evals.length !== 1 ? 's' : ''} real${evals.length !== 1 ? 'es' : ''}.`}>
        Rendimiento del Modelo
      </SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total predicciones"
          value={totalPreds}
          icon={<BarChart2 className="w-5 h-5" />}
        />
        <StatCard
          label="Brier Score prom."
          value={avgBrier.toFixed(3)}
          icon={<TrendingDown className="w-5 h-5" />}
          color={avgBrier < 0.2 ? 'text-green-600' : avgBrier < 0.3 ? 'text-amber-600' : 'text-wc-red'}
        />
        <StatCard
          label="RPS promedio"
          value={avgRps.toFixed(3)}
          icon={<TrendingDown className="w-5 h-5" />}
          color={avgRps < 0.2 ? 'text-green-600' : avgRps < 0.3 ? 'text-amber-600' : 'text-wc-red'}
        />
        <StatCard
          label="Accuracy (top pick)"
          value={`${(accuracy * 100).toFixed(1)}%`}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color={accuracy > 0.6 ? 'text-green-600' : accuracy > 0.45 ? 'text-amber-600' : 'text-wc-red'}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-wc-gold" />
            <p className="font-semibold text-wc-navy">Calibración del Momentum (L6)</p>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Analiza si el boost de momentum está bien ajustado comparando empates reales vs predichos.
          </p>
        </CardHeader>
        <div className="p-4">
          <CalibrationCard evals={evals} wcResults={wcResults} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <p className="font-semibold text-wc-navy">Métricas por modelo</p>
          <p className="text-xs text-gray-400 mt-0.5">Brier Score y LogLoss: menor = mejor · Aciertos: mayor = mejor</p>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Modelo</th>
                <th className="text-right px-4 py-3 font-semibold">N</th>
                <th className="text-right px-4 py-3 font-semibold">Aciertos</th>
                <th className="text-right px-4 py-3 font-semibold">
                  <Tooltip text="Mide la calibración: diferencia al cuadrado entre prob. asignada y resultado. Rango 0–2, menor es mejor.">
                    <span className="underline decoration-dotted cursor-help">Brier ↓</span>
                  </Tooltip>
                </th>
                <th className="text-right px-4 py-3 font-semibold hidden sm:table-cell">
                  <Tooltip text="Ranked Probability Score: penaliza errores de forma ordenada. Menor es mejor.">
                    <span className="underline decoration-dotted cursor-help">RPS ↓</span>
                  </Tooltip>
                </th>
                <th className="text-right px-5 py-3 font-semibold hidden sm:table-cell">
                  <Tooltip text="Log Loss: penaliza fuertemente las probabilidades bajas asignadas al resultado correcto. Menor es mejor.">
                    <span className="underline decoration-dotted cursor-help">LogLoss ↓</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={row.modelName} className={`hover:bg-wc-cream/30 transition-colors ${i === 0 ? 'bg-green-50/40' : ''}`}>
                  <td className="px-5 py-3 font-semibold text-gray-800 flex items-center gap-1.5">
                    {i === 0 && <span className="text-amber-500">★</span>}
                    {row.modelName}
                    {i === 0 && <Badge color="green">mejor</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{row.count}</td>
                  <td className="px-4 py-3 text-right"><ScoreCell value={row.topPickAccuracy} /></td>
                  <td className="px-4 py-3 text-right"><ScoreCell value={row.avgBrierScore} low /></td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell"><ScoreCell value={row.avgRps} low /></td>
                  <td className="px-5 py-3 text-right hidden sm:table-cell"><ScoreCell value={row.avgLogLoss} low /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <p className="font-semibold text-wc-navy">Detalle por partido</p>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Partido</th>
                <th className="text-left px-4 py-3 font-semibold">Resultado</th>
                <th className="text-left px-4 py-3 font-semibold">Modelo</th>
                <th className="text-right px-4 py-3 font-semibold">Prob. ganador</th>
                <th className="text-right px-4 py-3 font-semibold">
                  <Tooltip text="Brier Score: menor es mejor (rango 0–2).">
                    <span className="underline decoration-dotted cursor-help">Brier</span>
                  </Tooltip>
                </th>
                <th className="text-right px-4 py-3 font-semibold hidden sm:table-cell">
                  <Tooltip text="Ranked Probability Score: menor es mejor.">
                    <span className="underline decoration-dotted cursor-help">RPS</span>
                  </Tooltip>
                </th>
                <th className="text-right px-5 py-3 font-semibold hidden sm:table-cell">
                  <Tooltip text="Log Loss: penaliza probabilidades bajas al resultado correcto.">
                    <span className="underline decoration-dotted cursor-help">LogLoss</span>
                  </Tooltip>
                </th>
                <th className="text-center px-4 py-3 font-semibold">Top ✓</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {evals.map(e => {
                const home = teamMap.get(e.home_team_id)?.name ?? e.home_team_id;
                const away = teamMap.get(e.away_team_id)?.name ?? e.away_team_id;
                const winProb = e.actual === 'Home' ? e.home_win : e.actual === 'Away' ? e.away_win : e.draw;
                return (
                  <tr key={e.id} className="hover:bg-wc-cream/30 transition-colors">
                    <td className="px-5 py-2.5 text-gray-800 font-medium whitespace-nowrap">{home} vs {away}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-semibold tabular-nums">{e.home_goals}–{e.away_goals}</td>
                    <td className="px-4 py-2.5">
                      <Badge color="navy">{e.model_name}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{(winProb * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right"><ScoreCell value={e.brier_score} low /></td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell"><ScoreCell value={e.ranked_probability_score} low /></td>
                    <td className="px-5 py-2.5 text-right hidden sm:table-cell"><ScoreCell value={e.log_loss} low /></td>
                    <td className="px-4 py-2.5 text-center">
                      {e.top_pick_correct
                        ? <span className="text-green-600 font-bold">✓</span>
                        : <span className="text-red-500">✗</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
