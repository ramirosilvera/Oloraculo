import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import {
  saveMatchSnapshot,
  saveEvaluation,
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
import {
  Button,
  Badge,
  Card,
  CardHeader,
  ProbBar,
  Tooltip,
  SectionTitle,
  SkeletonCard,
} from '../components/ui';
import {
  ChevronDown,
  ChevronUp,
  Save,
  CheckCircle2,
  AlertCircle,
  Trophy,
  Info,
} from 'lucide-react';

const FLAGS: Record<string, string> = {
  'argentina': '🇦🇷', 'brazil': '🇧🇷', 'france': '🇫🇷', 'england': '🇬🇧',
  'spain': '🇪🇸', 'germany': '🇩🇪', 'portugal': '🇵🇹', 'netherlands': '🇳🇱',
  'belgium': '🇧🇪', 'colombia': '🇨🇴', 'uruguay': '🇺🇾', 'mexico': '🇲🇽',
  'united-states': '🇺🇸', 'canada': '🇨🇦', 'japan': '🇯🇵', 'south-korea': '🇰🇷',
  'morocco': '🇲🇦', 'senegal': '🇸🇳', 'ecuador': '🇪🇨', 'australia': '🇦🇺',
  'croatia': '🇭🇷', 'switzerland': '🇨🇭', 'norway': '🇳🇴', 'sweden': '🇸🇪',
  'austria': '🇦🇹', 'turkey': '🇹🇷', 'iran': '🇮🇷', 'egypt': '🇪🇬',
  'saudi-arabia': '🇸🇦', 'south-africa': '🇿🇦', 'ghana': '🇬🇭', 'tunisia': '🇹🇳',
  'algeria': '🇩🇿', 'ivory-coast': '🇨🇮', 'nigeria': '🇳🇬', 'cameroon': '🇨🇲',
  'scotland': '🏴󠁧󠁢󠁳󠁣󠁵󠁳󠁿', 'czechia': '🇨🇿', 'poland': '🇵🇱', 'serbia': '🇷🇸',
  'paraguay': '🇵🇾', 'haiti': '🇭🇹', 'panama': '🇵🇦', 'curacao': '🇨🇼',
  'jordan': '🇯🇴', 'iraq': '🇮🇶', 'new-zealand': '🇳🇿', 'cape-verde': '🇨🇻',
  'uzbekistan': '🇺🇿', 'congo-dr': '🇨🇩', 'bosnia-and-herzegovina': '🇧🇦',
  'qatar': '🇶🇦',
};

function flag(teamId: string) {
  return FLAGS[teamId.toLowerCase()] ?? '🏳️';
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function MatchesPage() {
  const { groups, fixtures, teamMap, contextMap, engine, ratingsList, isLoading, error } = useAppData();
  const qc = useQueryClient();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Map<string, MatchPredictionResult>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSnap, setSavedSnap] = useState<Set<string>>(new Set());
  const [resultHome, setResultHome] = useState('');
  const [resultAway, setResultAway] = useState('');
  const [evalDone, setEvalDone] = useState<Set<string>>(new Set());
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
    setSaving(fixture.id);
    setErr('');
    try {
      await saveMatchSnapshot(fixture.id, pred, {
        modelName: pred.bestPrediction.predictorName,
        homeWin: pred.bestPrediction.outcome.homeWin,
        draw: pred.bestPrediction.outcome.draw,
        awayWin: pred.bestPrediction.outcome.awayWin,
        explanation: pred.bestPrediction.explanation,
      });
      setSavedSnap(prev => new Set(prev).add(fixture.id));
      qc.invalidateQueries({ queryKey: ['snapshots', fixture.id] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  };

  const recordResult = async (fixture: Fixture) => {
    const hg = parseInt(resultHome);
    const ag = parseInt(resultAway);
    if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) {
      setErr('Ingresá goles válidos (0 o más).');
      return;
    }
    const pred = predictions.get(fixture.id);
    if (!pred) { setErr('Primero predecí el partido.'); return; }
    setErr('');
    setSaving(fixture.id);
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
      setEvalDone(prev => new Set(prev).add(fixture.id));
      qc.invalidateQueries({ queryKey: ['wc-results'] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando fixtures…">Partidos</SectionTitle>
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <SectionTitle>Partidos</SectionTitle>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{String(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle sub="72 partidos del Mundial 2026 agrupados por grupo. Expandí cada partido para ver la predicción, guardar un snapshot o registrar el resultado real.">
        Partidos
      </SectionTitle>

      {groups.map(group => {
        const groupFixtures = fixtures.filter(f => f.group_name === group.name);
        const teamNames = group.team_ids.map(id => teamMap.get(id)?.name ?? id);

        return (
          <Card key={group.name}>
            <CardHeader className="bg-wc-navy/5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-black text-wc-navy">Grupo {group.name}</span>
                <div className="flex flex-wrap gap-1.5">
                  {teamNames.map(name => (
                    <Badge key={name} color="navy">{name}</Badge>
                  ))}
                </div>
              </div>
            </CardHeader>

            <div className="divide-y divide-gray-100">
              {groupFixtures.map(fixture => {
                const home = teamMap.get(fixture.home_team_id);
                const away = teamMap.get(fixture.away_team_id);
                const pred = predictions.get(fixture.id);
                const isExpanded = expandedId === fixture.id;
                const played = playedMap.get(fixture.id);
                const isSavingThis = saving === fixture.id;
                const homeName = home?.name ?? fixture.home_team_id;
                const awayName = away?.name ?? fixture.away_team_id;

                return (
                  <div key={fixture.id}>
                    <button
                      onClick={() => expand(fixture)}
                      className="w-full flex items-center gap-2 px-4 py-3 hover:bg-wc-cream/50 transition-colors text-left"
                    >
                      <span className="text-2xl leading-none">{flag(fixture.home_team_id)}</span>
                      <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{homeName}</span>
                      <span className="text-xs text-gray-400 font-medium px-1 shrink-0">vs</span>
                      <span className="flex-1 font-semibold text-gray-900 text-sm truncate text-right">{awayName}</span>
                      <span className="text-2xl leading-none">{flag(fixture.away_team_id)}</span>

                      {played && (
                        <Badge color="green">
                          {played.home_goals} – {played.away_goals}
                        </Badge>
                      )}

                      <span className="text-gray-400 ml-1 shrink-0">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-5 pt-3 bg-blue-50/30 border-t border-blue-100 space-y-4">
                        {!pred && (
                          <p className="text-sm text-gray-500 animate-pulse">Calculando predicción…</p>
                        )}

                        {pred && (
                          <>
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge color="blue">{pred.bestPrediction.predictorName}</Badge>
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <Info className="w-3 h-3 shrink-0" />
                                  {pred.bestPrediction.explanation}
                                </span>
                              </div>

                              <ProbBar
                                home={pred.bestPrediction.outcome.homeWin}
                                draw={pred.bestPrediction.outcome.draw}
                                away={pred.bestPrediction.outcome.awayWin}
                                homeLabel={homeName}
                                awayLabel={awayName}
                              />

                              {pred.bestPrediction.mostLikelyScore && (
                                <div className="flex items-center gap-2">
                                  <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="text-xs text-gray-600">
                                    Marcador más probable:
                                  </span>
                                  <Badge color="gold">
                                    {pred.bestPrediction.mostLikelyScore.home} – {pred.bestPrediction.mostLikelyScore.away}
                                  </Badge>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {pred.predictions.map(p => (
                                <div
                                  key={p.predictorName}
                                  className={`text-xs p-2.5 rounded-lg border ${
                                    p.degraded
                                      ? 'border-gray-100 bg-white/50 opacity-60'
                                      : 'border-gray-200 bg-white'
                                  }`}
                                >
                                  <p className="font-semibold text-gray-600 truncate">{p.predictorName}</p>
                                  {p.degraded ? (
                                    <p className="text-gray-400 mt-0.5">↓ degradado</p>
                                  ) : (
                                    <p className="text-gray-500 mt-0.5 tabular-nums">
                                      {pct(p.outcome.homeWin)} / {pct(p.outcome.draw)} / {pct(p.outcome.awayWin)}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Tooltip text="Guardá antes del partido para medir tu accuracy después">
                                <Button
                                  variant={savedSnap.has(fixture.id) ? 'secondary' : 'primary'}
                                  size="sm"
                                  loading={isSavingThis}
                                  disabled={isSavingThis || savedSnap.has(fixture.id)}
                                  onClick={() => saveSnapshot(fixture)}
                                >
                                  {savedSnap.has(fixture.id) ? (
                                    <><CheckCircle2 className="w-3.5 h-3.5" /> Predicción guardada</>
                                  ) : (
                                    <><Save className="w-3.5 h-3.5" /> Guardar predicción</>
                                  )}
                                </Button>
                              </Tooltip>
                            </div>

                            {!played && !evalDone.has(fixture.id) && (
                              <div className="space-y-2 pt-1">
                                <p className="text-xs font-semibold text-gray-600">Resultado real del partido</p>
                                <div className="flex items-center gap-3">
                                  <div className="flex flex-col items-center gap-1">
                                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Local</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="20"
                                      value={resultHome}
                                      onChange={e => setResultHome(e.target.value)}
                                      className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy"
                                    />
                                  </div>
                                  <span className="text-gray-400 font-semibold mt-4">–</span>
                                  <div className="flex flex-col items-center gap-1">
                                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Visitante</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="20"
                                      value={resultAway}
                                      onChange={e => setResultAway(e.target.value)}
                                      className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy"
                                    />
                                  </div>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    loading={isSavingThis}
                                    disabled={isSavingThis || !resultHome || !resultAway}
                                    onClick={() => recordResult(fixture)}
                                    className="mt-4"
                                  >
                                    Registrar resultado
                                  </Button>
                                </div>
                              </div>
                            )}

                            {(played || evalDone.has(fixture.id)) && (
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                                <Badge color="green">
                                  Resultado registrado: {played?.home_goals ?? resultHome} – {played?.away_goals ?? resultAway}
                                </Badge>
                              </div>
                            )}
                          </>
                        )}

                        {err && expandedId === fixture.id && (
                          <div className="flex items-center gap-2 text-red-600">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <p className="text-xs">{err}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
