import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy, BarChart2, Target, CheckCircle2, HelpCircle, RefreshCw, Loader2, X } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import {
  loadEvaluations,
  saveEvaluations,
  deleteEvaluationsForFixtures,
} from '../services/supabase-client';
import { recomputeEvaluations } from '../engine/recompute-evaluations';
import { MODEL_TIERS } from '../engine/model-tiers';
import type { PredictionEvaluation } from '../types/domain';
import {
  Button,
  Card,
  CardHeader,
  Badge,
  SectionTitle,
  SkeletonCard,
  Skeleton,
} from '../components/ui';

// All models in ladder order — shown even if they have no evaluations yet
const ALL_MODELS = [
  'Base',
  'Ranking FIFA',
  'Elo',
  'Forma reciente',
  'Modelo de goles (Poisson)',
  'Potencial del plantel',
  'Goles + contexto reciente',
  'Momentum del Mundial',
  'Estilo de Juego',
];

interface ModelStats {
  name: string;
  n: number;
  winnerCorrect: number;
  exactCorrect: number | null;
  hasExactData: boolean;
}

function buildModelStats(evals: PredictionEvaluation[]): ModelStats[] {
  const byModel = new Map<string, PredictionEvaluation[]>();
  for (const e of evals) {
    const arr = byModel.get(e.model_name) ?? [];
    arr.push(e);
    byModel.set(e.model_name, arr);
  }

  return ALL_MODELS.map(name => {
    const rows = byModel.get(name) ?? [];
    if (rows.length === 0) return { name, n: 0, winnerCorrect: 0, exactCorrect: null, hasExactData: false };
    const winnerCorrect = rows.filter(r => r.top_pick_correct).length;
    const rowsWithExact = rows.filter(r => r.exact_score_correct != null);
    const hasExactData = rowsWithExact.length > 0;
    const exactCorrect = hasExactData ? rowsWithExact.filter(r => r.exact_score_correct).length : null;
    return { name, n: rows.length, winnerCorrect, exactCorrect, hasExactData };
  });
}

function pct(correct: number, total: number): string {
  if (total === 0) return '—';
  return `${((correct / total) * 100).toFixed(0)}%`;
}

function WinnerBar({ correct, total }: { correct: number; total: number }) {
  if (total === 0) return <span className="text-gray-300 text-sm">—</span>;
  const p = correct / total;
  const color = p >= 0.6 ? 'bg-green-500' : p >= 0.4 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${p * 100}%` }} />
      </div>
      <span className={`text-sm font-bold tabular-nums ${p >= 0.6 ? 'text-green-700' : p >= 0.4 ? 'text-amber-600' : 'text-red-600'}`}>
        {correct}/{total}
      </span>
      <span className="text-xs text-gray-400">{pct(correct, total)}</span>
    </div>
  );
}

export function PerformancePage() {
  const { teamMap, wcResults, engine, fixtures, ratingsList, contextMap } = useAppData();
  const qc = useQueryClient();
  const { data: evals, isLoading, status: evalStatus, fetchStatus: evalFetchStatus, error: evalError } = useQuery({
    queryKey: ['evaluations'],
    queryFn: loadEvaluations,
  });
  // DEBUG — remove once loading issue is diagnosed
  console.log('[Rendimientos DEBUG]', { evalStatus, evalFetchStatus, evalError, isLoading });

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Must be before any early return (React Rules of Hooks)
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const stats = buildModelStats(evals ?? []);
  const selectedEvals = useMemo(() => {
    if (!selectedModel || !evals) return [];
    const hasExact = stats.find(s => s.name === selectedModel)?.hasExactData ?? false;
    return evals
      .filter(e => e.model_name === selectedModel)
      .sort((a, b) => {
        const winnerDiff = Number(b.top_pick_correct) - Number(a.top_pick_correct);
        if (winnerDiff !== 0) return winnerDiff;
        if (hasExact) return Number(b.exact_score_correct ?? false) - Number(a.exact_score_correct ?? false);
        return 0;
      });
  }, [selectedModel, evals, stats]);

  async function handleRecompute() {
    if (!engine) {
      setRecomputeMsg({ kind: 'err', text: 'El motor todavía se está cargando. Probá de nuevo en unos segundos.' });
      return;
    }
    setRecomputing(true);
    setRecomputeMsg(null);
    try {
      const { rows, fixtureIds, matchesProcessed, matchesSkipped } = recomputeEvaluations({
        engine, fixtures, teamMap, ratingsList, contextMap, wcResults,
      });
      if (matchesProcessed === 0) {
        setRecomputeMsg({ kind: 'err', text: 'No hay partidos jugados para evaluar todavía.' });
        return;
      }
      // Replace stale rows for the recomputed fixtures, then insert fresh ones.
      await deleteEvaluationsForFixtures(fixtureIds);
      await saveEvaluations(rows);
      await qc.invalidateQueries({ queryKey: ['evaluations'] });
      const skip = matchesSkipped > 0 ? ` · ${matchesSkipped} omitido${matchesSkipped !== 1 ? 's' : ''}` : '';
      setRecomputeMsg({
        kind: 'ok',
        text: `Recalculado: ${matchesProcessed} partido${matchesProcessed !== 1 ? 's' : ''}, ${rows.length} evaluaciones${skip}.`,
      });
    } catch (e) {
      setRecomputeMsg({ kind: 'err', text: `Error al recalcular: ${String(e)}` });
    } finally {
      setRecomputing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando evaluaciones…">Rendimiento</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <Card>
          <CardHeader><Skeleton className="h-4 w-40" /></CardHeader>
          <div className="p-5 space-y-3">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </Card>
      </div>
    );
  }

  const hasData = evals && evals.length > 0;

  // Only count results that correspond to a real fixture (guards against orphaned
  // Supabase entries saved with a wrong/reversed fixture_id).
  const validFixtureIds = useMemo(() => new Set(fixtures.map(f => f.id)), [fixtures]);
  const totalMatches = useMemo(
    () => wcResults.filter(r => validFixtureIds.has(r.fixture_id)).length,
    [wcResults, validFixtureIds],
  );
  const totalEvals = evals?.length ?? 0;
  const hasExactData = stats.some(s => s.hasExactData);

  // Best model by absolute count of correct winner picks (min 3 evals).
  const bestWinnerModel: string | null = stats
    .filter(s => s.n >= 3)
    .sort((a, b) => b.winnerCorrect - a.winnerCorrect)
    [0]?.name ?? null;

  // Best model by exact score accuracy (min 5 evals with exact data, at least 1 correct)
  const exactEligible = stats.filter(
    s => s.hasExactData && s.exactCorrect !== null && s.n >= 5 && s.exactCorrect > 0
  );
  const bestExactModel: string | null = exactEligible.length === 0
    ? null
    : exactEligible.sort((a, b) => (b.exactCorrect! / b.n) - (a.exactCorrect! / a.n))[0].name;

  // Summary totals across all models
  const overallWinner = hasData ? evals!.filter(e => e.top_pick_correct).length : 0;
  const overallN = totalEvals;

  const handleModelClick = (name: string) =>
    setSelectedModel(prev => (prev === name ? null : name));
  const selectedModelStats = selectedModel ? stats.find(s => s.name === selectedModel) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <SectionTitle sub={`Comparación de modelos · ${totalMatches} partido${totalMatches !== 1 ? 's' : ''} jugado${totalMatches !== 1 ? 's' : ''}`}>
          Rendimiento
        </SectionTitle>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRecompute}
          disabled={recomputing || !engine || totalMatches === 0}
          className="shrink-0"
        >
          {recomputing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Recalculando…</>
            : <><RefreshCw className="w-4 h-4" /> Recalcular evaluaciones</>}
        </Button>
      </div>

      {recomputeMsg && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm border ${
          recomputeMsg.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {recomputeMsg.kind === 'ok'
            ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            : <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{recomputeMsg.text}</span>
        </div>
      )}

      <p className="text-xs text-gray-400 -mt-2">
        Recalcular vuelve a evaluar todos los partidos jugados con los modelos actuales
        (necesario tras cambiar un modelo, como el de plantel) y completa los aciertos de marcador exacto.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Summary chips                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-wc-navy/10 rounded-xl flex items-center justify-center shrink-0">
            <BarChart2 className="w-5 h-5 text-wc-navy" />
          </div>
          <div>
            <p className="text-2xl font-black text-wc-navy tabular-nums">{totalMatches}</p>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Partidos</p>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-black text-green-700 tabular-nums">
              {overallN > 0 ? `${((overallWinner / overallN) * 100).toFixed(0)}%` : '—'}
            </p>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Ganador (prom.)</p>
          </div>
        </div>
        {/* Award 1: best winner/draw accuracy */}
        <div className="bg-white border border-amber-100 rounded-2xl p-3 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-amber-700 truncate">
              {bestWinnerModel ?? '—'}
            </p>
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide leading-tight">
              Mejor Ganador
            </p>
          </div>
        </div>
        {/* Award 2: best exact score accuracy */}
        <div className="bg-white border border-teal-100 rounded-2xl p-3 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
            <Target className="w-4 h-4 text-teal-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-teal-700 truncate">
              {bestExactModel ?? (hasExactData ? '—' : 'Sin datos')}
            </p>
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide leading-tight">
              Mejor Exacto
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Model comparison table                                               */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-wc-navy" />
            <span className="font-semibold text-wc-navy text-sm">Comparación de modelos</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Aciertos de ganador (Local / Empate / Visitante) y marcador exacto por modelo.
          </p>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold sticky left-0 bg-gray-50">Modelo</th>
                <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Partidos</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Ganador ✓</th>
                <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">
                  <span className="flex items-center gap-1 justify-center">
                    Marcador exacto
                    {!hasExactData && (
                      <HelpCircle className="w-3 h-3 text-gray-300" />
                    )}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.map(row => {
                const tier = MODEL_TIERS[row.name];
                const isWinnerBest = row.name === bestWinnerModel;
                const isExactBest  = row.name === bestExactModel;
                const isSelected   = row.name === selectedModel;
                const awardBg = isWinnerBest && isExactBest ? 'bg-amber-50/40'
                  : isWinnerBest ? 'bg-amber-50/60'
                  : isExactBest  ? 'bg-teal-50/60'
                  : '';
                const rowBg = isSelected
                  ? `ring-2 ring-inset ring-wc-navy/25 ${awardBg || 'bg-wc-navy/5'}`
                  : awardBg || 'hover:bg-wc-cream/30';
                const cellBg = isSelected
                  ? (awardBg || 'bg-wc-navy/5')
                  : (awardBg || 'bg-white');
                return (
                  <tr
                    key={row.name}
                    onClick={() => handleModelClick(row.name)}
                    className={`transition-colors cursor-pointer ${rowBg}`}
                  >
                    <td className={`px-5 py-3 sticky left-0 ${cellBg}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isWinnerBest && <span className="text-amber-500 text-base leading-none">★</span>}
                        {isExactBest  && <span className="text-teal-500 text-base leading-none">🎯</span>}
                        <div>
                          <span className="font-semibold text-gray-800">{row.name}</span>
                          {tier && (
                            <span className="ml-1.5 text-xs text-gray-400 font-mono">{tier.tier}</span>
                          )}
                        </div>
                        {isWinnerBest && <Badge color="gold">Líder</Badge>}
                        {isExactBest  && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-700">
                            Exacto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.n > 0 ? (
                        <span className="font-semibold text-gray-700 tabular-nums">{row.n}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.name === 'Base' ? (
                        <span className="text-xs text-gray-400 italic">Siempre degradado (uniforme)</span>
                      ) : row.n > 0 ? (
                        <WinnerBar correct={row.winnerCorrect} total={row.n} />
                      ) : (
                        <span className="text-gray-300 text-sm">Sin datos</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!row.hasExactData ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (
                        <span className={`font-bold tabular-nums text-sm ${
                          (row.exactCorrect ?? 0) > 0 ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          {row.exactCorrect ?? 0}/{row.n} {' '}
                          <span className="text-xs font-normal text-gray-400">
                            ({pct(row.exactCorrect ?? 0, row.n)})
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!hasExactData && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-gray-300 shrink-0" />
            <p className="text-xs text-gray-400">
              Los aciertos de marcador exacto estarán disponibles al registrar nuevos resultados.
            </p>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Match detail — collapsed until user taps a model row               */}
      {/* ------------------------------------------------------------------ */}
      {hasData && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-wc-navy text-sm">
                  {selectedModel ? `Detalle · ${selectedModel}` : 'Detalle por partido'}
                </p>
                {selectedModel && selectedModelStats && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedModelStats.winnerCorrect}/{selectedModelStats.n} ganador
                    {selectedModelStats.hasExactData
                      ? ` · ${selectedModelStats.exactCorrect ?? 0}/${selectedModelStats.n} exacto`
                      : ''}
                  </p>
                )}
              </div>
              {selectedModel && (
                <button
                  onClick={() => setSelectedModel(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </CardHeader>

          {!selectedModel ? (
            <div className="px-5 py-8 text-center">
              <Target className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Tocá un modelo para ver el detalle</p>
            </div>
          ) : selectedEvals.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-gray-400">Sin evaluaciones para este modelo.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold">Partido</th>
                    <th className="text-left px-4 py-3 font-semibold">Resultado</th>
                    <th className="text-center px-4 py-3 font-semibold">Ganador ✓</th>
                    {selectedModelStats?.hasExactData && (
                      <th className="text-center px-4 py-3 font-semibold">Exacto ✓</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedEvals.map(e => {
                    const home = teamMap.get(e.home_team_id)?.name ?? e.home_team_id;
                    const away = teamMap.get(e.away_team_id)?.name ?? e.away_team_id;
                    const rowColor = e.exact_score_correct
                      ? 'hover:bg-green-50/50'
                      : e.top_pick_correct
                        ? 'hover:bg-green-50/20'
                        : 'hover:bg-wc-cream/30';
                    return (
                      <tr key={e.id} className={`transition-colors ${rowColor}`}>
                        <td className="px-5 py-2.5 text-gray-800 font-medium">{home} vs {away}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-bold tabular-nums">
                          {e.home_goals}–{e.away_goals}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {e.top_pick_correct
                            ? <span className="text-green-600 font-bold">✓</span>
                            : <span className="text-red-400">✗</span>}
                        </td>
                        {selectedModelStats?.hasExactData && (
                          <td className="px-4 py-2.5 text-center">
                            {e.exact_score_correct == null
                              ? <span className="text-gray-300">—</span>
                              : e.exact_score_correct
                                ? <span className="text-green-600 font-bold">✓</span>
                                : <span className="text-red-400">✗</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!hasData && (
        <Card className="p-10 text-center">
          <BarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Aún no hay evaluaciones disponibles.</p>
          <p className="text-sm text-gray-400 mt-1">
            Registrá resultados reales en la página de <strong>Partidos</strong> para ver las métricas.
          </p>
        </Card>
      )}
    </div>
  );
}
