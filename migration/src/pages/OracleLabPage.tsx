// =============================================================================
// OracleLabPage — Compare two teams across the full prediction ladder
// Migrated from: Oloraculo.Web/Components/Pages/OracleLab.razor
// All prediction runs in the browser — no server round-trip
// =============================================================================

import { useState, useMemo } from 'react';
import { useAppData } from '../hooks/useAppData';
import { predictPair } from '../engine/prediction-engine';
import type { MatchPredictionResult, Team } from '../types/domain';

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function ProbBar({ label, home, draw, away }: { label: string; home: number; draw: number; away: number }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="flex h-6 rounded overflow-hidden text-xs font-semibold">
        <div className="bg-blue-600 flex items-center justify-center text-white"
             style={{ width: pct(home) }}>{pct(home)}</div>
        <div className="bg-gray-400 flex items-center justify-center text-white"
             style={{ width: pct(draw) }}>{pct(draw)}</div>
        <div className="bg-orange-500 flex items-center justify-center text-white"
             style={{ width: pct(away) }}>{pct(away)}</div>
      </div>
    </div>
  );
}

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

  if (isLoading) return <div className="p-6 text-gray-500">Cargando datos…</div>;

  const TeamSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div className="flex-1">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— elegir equipo —</option>
        {sortedTeams.map((t: Team) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );

  const ladder = [
    { name: 'L0', label: 'Base', signal: 'probabilidad uniforme' },
    { name: 'L1', label: 'Ranking FIFA', signal: 'puntos externos' },
    { name: 'L2', label: 'Elo', signal: 'fortaleza de largo plazo' },
    { name: 'L3', label: 'Forma reciente', signal: 'resultados de corto plazo' },
    { name: 'L4', label: 'Goles', signal: 'marcadores Poisson' },
    { name: 'L5', label: 'Contexto', signal: 'ajuste con fuentes' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Laboratorio</h1>
        <p className="text-gray-500 mt-1">Compará dos equipos en toda la escalera de predicción.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex gap-4 items-end flex-wrap">
          <TeamSelect value={homeId} onChange={setHomeId} label="Equipo A" />
          <TeamSelect value={awayId} onChange={setAwayId} label="Equipo B" />
          <button
            onClick={predict}
            disabled={busy || !homeId || !awayId || homeId === awayId}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Prediciendo…' : '⚡ Predecir'}
          </button>
        </div>
        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}
      </div>

      {result && (
        <>
          {/* Final prediction */}
          <div className="bg-white border border-blue-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">Final</span>
              <h2 className="text-xl font-semibold">
                {result.homeTeamName} <span className="text-gray-400">vs</span> {result.awayTeamName}
              </h2>
            </div>
            <ProbBar
              label="Probabilidades"
              home={result.bestPrediction.outcome.homeWin}
              draw={result.bestPrediction.outcome.draw}
              away={result.bestPrediction.outcome.awayWin}
            />
            <p className="text-sm text-gray-600">{result.bestPrediction.explanation}</p>
          </div>

          {/* Ladder */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {result.predictions.map(p => (
              <div
                key={p.predictorName}
                className={`bg-white border rounded-xl p-5 space-y-3 ${p.degraded ? 'border-gray-200 opacity-60' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${p.degraded ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}>
                    L{p.predictorPriority}
                  </span>
                  <span className="font-medium text-gray-800">{p.predictorName}</span>
                  {p.degraded && (
                    <span className="ml-auto text-xs text-amber-600 font-medium">↓ degradado</span>
                  )}
                </div>
                {!p.degraded && (
                  <ProbBar
                    label={`${result.homeTeamName} / Empate / ${result.awayTeamName}`}
                    home={p.outcome.homeWin}
                    draw={p.outcome.draw}
                    away={p.outcome.awayWin}
                  />
                )}
                <p className="text-xs text-gray-500">{p.explanation}</p>
                {p.mostLikelyScore && (
                  <p className="text-xs font-medium text-gray-700">
                    Marcador más probable: {p.mostLikelyScore.home}-{p.mostLikelyScore.away}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ladder explanation */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="font-semibold text-gray-800 mb-3">Escalera de modelos</h3>
        <table className="w-full text-sm">
          <tbody>
            {ladder.map(row => (
              <tr key={row.name} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded">{row.name}</span>
                </td>
                <td className="py-2 pr-4 font-medium text-gray-700">{row.label}</td>
                <td className="py-2 text-gray-500">{row.signal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
