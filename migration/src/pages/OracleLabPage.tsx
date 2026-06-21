import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FlaskConical } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { predictPair } from '../engine/prediction-engine';
import { computeModelWeights } from '../engine/final-selector';
import { loadEvaluations } from '../services/supabase-client';
import type { MatchPrediction, MatchPredictionResult, Team } from '../types/domain';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  ProbBar,
  ScoreTriple,
  SectionTitle,
  SkeletonCard,
} from '../components/ui';
import { mostLikelyScorePerOutcome } from '../engine/probability-helper';
import { ModelDetailPanel } from '../components/ModelDetailPanel';

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

const ladder = [
  { name: 'L0',   label: 'Base',              signal: 'probabilidad uniforme' },
  { name: 'L2',   label: 'Elo',               signal: 'fortaleza de largo plazo' },
  { name: 'L3',   label: 'Forma reciente',    signal: 'resultados de corto plazo' },
  { name: 'L4',   label: 'Goles',             signal: 'marcadores Poisson' },
  { name: 'L4.5', label: 'Plantel',           signal: 'valor de mercado, top-5 ligas' },
  { name: 'L5',   label: 'Contexto',          signal: 'disponibilidad de jugadores' },
  { name: 'L6',   label: 'Momentum',          signal: 'inflación WC + momentum en torneo' },
];

export function OracleLabPage() {
  const { teams, teamMap, ratingsList, results, fixtures, contextMap, wcResults, engine, isLoading } = useAppData();
  const [homeId, setHomeId] = useState<string>('');
  const [awayId, setAwayId] = useState<string>('');
  const [result, setResult] = useState<MatchPredictionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState<MatchPrediction | null>(null);

  const { data: evalsData } = useQuery({ queryKey: ['evaluations'], queryFn: loadEvaluations, staleTime: 60_000 });
  const modelWeights = useMemo(() => computeModelWeights(evalsData ?? []), [evalsData]);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  function predict() {
    if (!homeId || !awayId || homeId === awayId) return;
    setBusy(true);
    setError('');
    setSelectedModel(null);
    try {
      const r = predictPair(homeId, awayId, teamMap, ratingsList, results, {
        engine: engine ?? undefined,
        wcResults,
        allFixtures: fixtures,
        fixtureContexts: contextMap,
        modelWeights: modelWeights.size >= 2 ? modelWeights : undefined,
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando datos…">Laboratorio</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  const TeamSelect = ({
    value, onChange, label,
  }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div className="flex-1 min-w-0">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy transition-colors"
      >
        <option value="">— elegir equipo —</option>
        {sortedTeams.map((t: Team) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionTitle sub="Comparar dos equipos en toda la escalera de predicción, sin necesidad de que estén en el fixture oficial.">
        Laboratorio
      </SectionTitle>

      <Card className="p-5">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <TeamSelect value={homeId} onChange={setHomeId} label="Local" />
          <TeamSelect value={awayId} onChange={setAwayId} label="Visitante" />
          <Button
            variant="primary"
            size="md"
            loading={busy}
            disabled={busy || !homeId || !awayId || homeId === awayId}
            onClick={predict}
            className="shrink-0 w-full sm:w-auto"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Prediciendo…</> : 'Predecir'}
          </Button>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader className="bg-wc-navy/5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="navy">{result.bestPrediction.predictorName}</Badge>
                <span className="font-bold text-wc-navy text-base">
                  {result.homeTeamName} <span className="text-gray-400 font-normal">vs</span> {result.awayTeamName}
                </span>
              </div>
            </CardHeader>
            <div className="p-5 space-y-4">
              <ProbBar
                home={result.bestPrediction.outcome.homeWin}
                draw={result.bestPrediction.outcome.draw}
                away={result.bestPrediction.outcome.awayWin}
                homeLabel={result.homeTeamName}
                awayLabel={result.awayTeamName}
              />
              {result.bestPrediction.scoreline && (
                <ScoreTriple
                  scores={mostLikelyScorePerOutcome(result.bestPrediction.scoreline)}
                  homeLabel={result.homeTeamName}
                  awayLabel={result.awayTeamName}
                />
              )}
              <p className="text-sm text-gray-500">{result.bestPrediction.explanation}</p>
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {result.predictions.map(p => {
              const isSelected = selectedModel?.predictorName === p.predictorName;
              return (
                <button
                  key={p.predictorName}
                  onClick={() => setSelectedModel(isSelected ? null : p)}
                  className={`text-left p-4 rounded-2xl border transition-all space-y-2 ${
                    isSelected
                      ? 'border-wc-navy bg-wc-navy/5 ring-1 ring-wc-navy/20'
                      : p.degraded
                        ? 'border-gray-100 bg-white opacity-60 hover:opacity-80'
                        : 'border-gray-200 bg-white hover:border-wc-navy/30 hover:bg-blue-50/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge color={p.degraded ? 'gray' : 'navy'}>L{p.predictorPriority}</Badge>
                    <span className="text-xs font-semibold text-gray-700 truncate">{p.predictorName}</span>
                    {p.degraded && (
                      <span className="ml-auto text-xs text-amber-600 font-medium shrink-0">↓</span>
                    )}
                  </div>
                  {p.degraded ? (
                    <p className="text-xs text-gray-400">Sin datos suficientes</p>
                  ) : (
                    <p className="text-xs text-gray-500 tabular-nums">
                      {pct(p.outcome.homeWin)} / {pct(p.outcome.draw)} / {pct(p.outcome.awayWin)}
                    </p>
                  )}
                  {p.mostLikelyScore && !p.degraded && (
                    <p className="text-xs font-medium text-gray-500">
                      {p.mostLikelyScore.home}-{p.mostLikelyScore.away}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-300">{isSelected ? '▲ cerrar' : '▼ detalle'}</p>
                </button>
              );
            })}
          </div>

          {selectedModel && (
            <ModelDetailPanel
              model={selectedModel}
              homeName={result.homeTeamName}
              awayName={result.awayTeamName}
              onClose={() => setSelectedModel(null)}
            />
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-wc-navy" />
            <span className="font-semibold text-wc-navy text-sm">Escalera de modelos</span>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {ladder.map(row => (
                <tr key={row.name} className="hover:bg-wc-cream/40 transition-colors">
                  <td className="py-2.5 px-5 w-14">
                    <Badge color="navy">{row.name}</Badge>
                  </td>
                  <td className="py-2.5 px-4 font-semibold text-gray-700 whitespace-nowrap">{row.label}</td>
                  <td className="py-2.5 px-5 text-gray-400 text-xs">{row.signal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
