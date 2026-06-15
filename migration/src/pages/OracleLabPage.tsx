import { useState, useMemo } from 'react';
import { Loader2, Trophy, FlaskConical } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { predictPair } from '../engine/prediction-engine';
import type { MatchPredictionResult, Team } from '../types/domain';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  ProbBar,
  SectionTitle,
  SkeletonCard,
} from '../components/ui';

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

const ladder = [
  { name: 'L0', label: 'Base',         signal: 'probabilidad uniforme' },
  { name: 'L1', label: 'Ranking FIFA', signal: 'puntos externos' },
  { name: 'L2', label: 'Elo',          signal: 'fortaleza de largo plazo' },
  { name: 'L3', label: 'Forma reciente', signal: 'resultados de corto plazo' },
  { name: 'L4', label: 'Goles',        signal: 'marcadores Poisson' },
  { name: 'L5', label: 'Contexto',     signal: 'ajuste con fuentes' },
];

export function OracleLabPage() {
  const { teams, teamMap, ratingsList, results, isLoading } = useAppData();
  const [homeId, setHomeId] = useState<string>('');
  const [awayId, setAwayId] = useState<string>('');
  const [result, setResult] = useState<MatchPredictionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  function predict() {
    if (!homeId || !awayId || homeId === awayId) return;
    setBusy(true);
    setError('');
    try {
      const r = predictPair(homeId, awayId, teamMap, ratingsList, results);
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
              {result.bestPrediction.mostLikelyScore && (
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-sm text-gray-600">Marcador más probable:</span>
                  <Badge color="gold">
                    {result.bestPrediction.mostLikelyScore.home} – {result.bestPrediction.mostLikelyScore.away}
                  </Badge>
                </div>
              )}
              <p className="text-sm text-gray-500">{result.bestPrediction.explanation}</p>
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {result.predictions.map(p => (
              <Card
                key={p.predictorName}
                className={`p-4 space-y-2 ${p.degraded ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <Badge color={p.degraded ? 'gray' : 'navy'}>L{p.predictorPriority}</Badge>
                  <span className="text-xs font-semibold text-gray-700 truncate">{p.predictorName}</span>
                  {p.degraded && (
                    <span className="ml-auto text-[10px] text-amber-600 font-medium shrink-0">↓ degradado</span>
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
                  <p className="text-[10px] font-medium text-gray-500">
                    {p.mostLikelyScore.home}-{p.mostLikelyScore.away}
                  </p>
                )}
                <p className="text-[10px] text-gray-400 leading-relaxed">{p.explanation}</p>
              </Card>
            ))}
          </div>
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
