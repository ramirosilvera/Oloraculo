// =============================================================================
// MatchesPage — All 72 WC2026 group fixtures with inline prediction
// Migrated from: Oloraculo.Web/Components/Pages/Matches.razor
// =============================================================================

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import {
  saveMatchSnapshot,
  saveEvaluation,
  loadMatchSnapshots,
  saveWcActualResult,
  loadWcActualResults,
} from '../services/supabase-client';
import {
  brierScore,
  rankedProbabilityScore,
  logLoss,
  topPick,
} from '../engine/probability-helper';
import type { Fixture, MatchPredictionResult, WcActualResult } from '../types/domain';

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function ProbBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-5 rounded overflow-hidden text-[10px] font-semibold">
      <div className="bg-blue-600 flex items-center justify-center text-white transition-all" style={{ width: pct(home) }}>{pct(home)}</div>
      <div className="bg-gray-400 flex items-center justify-center text-white transition-all" style={{ width: pct(draw) }}>{pct(draw)}</div>
      <div className="bg-orange-500 flex items-center justify-center text-white transition-all" style={{ width: pct(away) }}>{pct(away)}</div>
    </div>
  );
}

export function MatchesPage() {
  const { groups, fixtures, teamMap, contextMap, engine, ratingsList, isLoading } = useAppData();
  const qc = useQueryClient();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Map<string, MatchPredictionResult>>(new Map());
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [resultHome, setResultHome] = useState('');
  const [resultAway, setResultAway] = useState('');
  const [evalDone, setEvalDone] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const { data: wcResults } = useQuery({
    queryKey: ['wc-results'],
    queryFn: loadWcActualResults,
  });

  const playedMap = new Map<string, WcActualResult>(
    (wcResults ?? []).map(r => [r.fixture_id, r]),
  );

  const expand = useCallback((fixture: Fixture) => {
    const isSame = expandedId === fixture.id;
    setExpandedId(isSame ? null : fixture.id);
    setSavedId(null);
    setEvalDone(null);
    setResultHome('');
    setResultAway('');
    setErr('');

    if (!isSame && !predictions.has(fixture.id) && engine) {
      const ctx = engine.buildContext(fixture, teamMap, ratingsList, contextMap);
      const result = engine.predict(ctx);
      setPredictions(prev => new Map(prev).set(fixture.id, result));
    }
  }, [expandedId, predictions, engine, teamMap, ratingsList, contextMap]);

  const saveSnapshot = async (fixture: Fixture) => {
    const pred = predictions.get(fixture.id);
    if (!pred) return;
    setSaving(true);
    setErr('');
    try {
      await saveMatchSnapshot(fixture.id, pred, {
        modelName: pred.bestPrediction.predictorName,
        homeWin: pred.bestPrediction.outcome.homeWin,
        draw: pred.bestPrediction.outcome.draw,
        awayWin: pred.bestPrediction.outcome.awayWin,
        explanation: pred.bestPrediction.explanation,
      });
      setSavedId(fixture.id);
      qc.invalidateQueries({ queryKey: ['snapshots', fixture.id] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const recordResult = async (fixture: Fixture) => {
    const hg = parseInt(resultHome);
    const ag = parseInt(resultAway);
    if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) { setErr('Ingresá goles válidos (0 o más).'); return; }
    const pred = predictions.get(fixture.id);
    if (!pred) { setErr('Primero predecí el partido.'); return; }
    setErr('');
    setSaving(true);
    try {
      await saveWcActualResult({ fixture_id: fixture.id, home_goals: hg, away_goals: ag });
      const actual = hg > ag ? 'Home' : hg === ag ? 'Draw' : 'Away';
      const p = pred.bestPrediction.outcome;
      await saveEvaluation({
        model_name: pred.bestPrediction.predictorName,
        fixture_id: fixture.id,
        home_team_id: fixture.home_team_id,
        away_team_id: fixture.away_team_id,
        home_goals: hg,
        away_goals: ag,
        home_win: p.homeWin,
        draw: p.draw,
        away_win: p.awayWin,
        actual,
        brier_score: brierScore(p, actual),
        ranked_probability_score: rankedProbabilityScore(p, actual),
        log_loss: logLoss(p, actual),
        top_pick_correct: topPick(p) === actual,
      });
      setEvalDone(fixture.id);
      qc.invalidateQueries({ queryKey: ['wc-results'] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-gray-500">Cargando datos…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Partidos</h1>
        <p className="text-gray-500 mt-1">Predecí cualquier partido del grupo, guardá snapshots y registrá resultados reales.</p>
      </div>

      {groups.map(group => {
        const groupFixtures = fixtures.filter(f => f.group_name === group.name);
        return (
          <div key={group.name} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="font-semibold text-gray-800">Grupo {group.name}</span>
              <span className="ml-3 text-sm text-gray-500">
                {group.team_ids.map(id => teamMap.get(id)?.name ?? id).join(' · ')}
              </span>
            </div>

            <div className="divide-y divide-gray-50">
              {groupFixtures.map(fixture => {
                const home = teamMap.get(fixture.home_team_id);
                const away = teamMap.get(fixture.away_team_id);
                const pred = predictions.get(fixture.id);
                const isExpanded = expandedId === fixture.id;
                const played = playedMap.get(fixture.id);

                return (
                  <div key={fixture.id}>
                    {/* Row */}
                    <button
                      onClick={() => expand(fixture)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-blue-50 transition-colors text-left"
                    >
                      <span className="flex-1 font-medium text-gray-800 text-sm">{home?.name ?? fixture.home_team_id}</span>
                      <span className="text-gray-400 text-xs">vs</span>
                      <span className="flex-1 font-medium text-gray-800 text-sm text-right">{away?.name ?? fixture.away_team_id}</span>
                      {played && (
                        <span className="ml-3 text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">
                          {played.home_goals} – {played.away_goals}
                        </span>
                      )}
                      {!played && pred && (
                        <span className="ml-3 text-xs text-blue-600">▸ predicción</span>
                      )}
                      <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-1 bg-blue-50/30 space-y-4 border-t border-blue-100">
                        {!pred && (
                          <p className="text-sm text-gray-500">Calculando predicción…</p>
                        )}

                        {pred && (
                          <>
                            {/* Best prediction */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                                  {pred.bestPrediction.predictorName}
                                </span>
                                <span className="text-sm text-gray-600">{pred.bestPrediction.explanation}</span>
                              </div>
                              <ProbBar
                                home={pred.bestPrediction.outcome.homeWin}
                                draw={pred.bestPrediction.outcome.draw}
                                away={pred.bestPrediction.outcome.awayWin}
                              />
                              <div className="flex text-xs text-gray-500 justify-between">
                                <span>{home?.name}</span>
                                <span>Empate</span>
                                <span>{away?.name}</span>
                              </div>
                              {pred.bestPrediction.mostLikelyScore && (
                                <p className="text-xs text-gray-600">
                                  Marcador más probable: {pred.bestPrediction.mostLikelyScore.home}–{pred.bestPrediction.mostLikelyScore.away}
                                </p>
                              )}
                            </div>

                            {/* All ladder levels */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {pred.predictions.map(p => (
                                <div
                                  key={p.predictorName}
                                  className={`text-xs p-2 rounded border ${p.degraded ? 'border-gray-100 bg-white/50 opacity-60' : 'border-gray-200 bg-white'}`}
                                >
                                  <span className="font-semibold text-gray-600">{p.predictorName}</span>
                                  {!p.degraded && (
                                    <div className="mt-1">
                                      {pct(p.outcome.homeWin)} / {pct(p.outcome.draw)} / {pct(p.outcome.awayWin)}
                                    </div>
                                  )}
                                  {p.degraded && <span className="text-gray-400 ml-1">↓ degradado</span>}
                                </div>
                              ))}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap gap-2 items-center">
                              <button
                                onClick={() => saveSnapshot(fixture)}
                                disabled={saving || savedId === fixture.id}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
                              >
                                {savedId === fixture.id ? '✓ Guardado' : saving ? 'Guardando…' : '💾 Guardar snapshot'}
                              </button>
                            </div>

                            {/* Enter actual result */}
                            {!played && (
                              <div className="flex items-center gap-2 pt-1">
                                <span className="text-xs text-gray-600 font-medium">Resultado real:</span>
                                <input
                                  type="number" min="0" max="20" value={resultHome}
                                  onChange={e => setResultHome(e.target.value)}
                                  className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                                  placeholder="L"
                                />
                                <span className="text-gray-400">–</span>
                                <input
                                  type="number" min="0" max="20" value={resultAway}
                                  onChange={e => setResultAway(e.target.value)}
                                  className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                                  placeholder="V"
                                />
                                <button
                                  onClick={() => recordResult(fixture)}
                                  disabled={saving || !resultHome || !resultAway}
                                  className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                                >
                                  {saving ? '…' : 'Registrar'}
                                </button>
                                {evalDone === fixture.id && (
                                  <span className="text-xs text-green-700">✓ Evaluación guardada</span>
                                )}
                              </div>
                            )}
                            {played && (
                              <p className="text-xs text-green-700 font-medium">
                                Resultado registrado: {played.home_goals} – {played.away_goals}
                              </p>
                            )}
                          </>
                        )}

                        {err && (
                          <p className="text-xs text-red-600">{err}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
