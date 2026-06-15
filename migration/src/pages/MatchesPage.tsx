import { useState, useCallback, useMemo } from 'react';
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
  ChevronDown, ChevronUp, Save, CheckCircle2, AlertCircle,
  Trophy, Info, Search, X, ChevronLeft, ChevronRight, Calendar, Loader2,
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

const TODAY = '2026-06-15';

function flag(id: string) { return FLAGS[id] ?? '🏳️'; }
function pct(n: number)   { return `${(n * 100).toFixed(1)}%`; }

function fixtureDate(f: Fixture): string | null {
  return f.kickoff_utc ? f.kickoff_utc.slice(0, 10) : null;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function kickoffART(utc: string): string {
  return new Date(utc).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

// ---------------------------------------------------------------------------
// FixtureRow — shared between "Hoy" and "Por grupo"
// ---------------------------------------------------------------------------
interface FixtureRowProps {
  fixture: Fixture;
  played: WcActualResult | undefined;
  pred: MatchPredictionResult | undefined;
  isExpanded: boolean;
  isExpanding: boolean;
  isSavingThis: boolean;
  savedSnap: Set<string>;
  evalDone: Set<string>;
  resultHome: string;
  resultAway: string;
  err: string;
  onExpand: () => void;
  onSaveSnapshot: () => void;
  onRecordResult: () => void;
  onResultHome: (v: string) => void;
  onResultAway: (v: string) => void;
  homeName: string;
  awayName: string;
  compact?: boolean;
}

function FixtureRow({
  fixture, played, pred, isExpanded, isExpanding, isSavingThis, savedSnap, evalDone,
  resultHome, resultAway, err, onExpand, onSaveSnapshot, onRecordResult,
  onResultHome, onResultAway, homeName, awayName, compact,
}: FixtureRowProps) {
  return (
    <div>
      <button
        onClick={onExpand}
        disabled={isExpanding}
        className={`w-full flex items-center gap-2 px-4 py-3 hover:bg-wc-cream/50 transition-colors text-left ${compact ? 'py-2.5' : ''} ${isExpanding ? 'opacity-60' : ''}`}
      >
        <span className="text-2xl leading-none">{flag(fixture.home_team_id)}</span>
        <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{homeName}</span>
        <span className="text-xs text-gray-400 font-medium px-1 shrink-0">vs</span>
        <span className="flex-1 font-semibold text-gray-900 text-sm truncate text-right">{awayName}</span>
        <span className="text-2xl leading-none">{flag(fixture.away_team_id)}</span>
        {played ? (
          <Badge color="green">{played.home_goals} – {played.away_goals}</Badge>
        ) : pred ? (
          <Badge color="blue">calculado</Badge>
        ) : null}
        <span className="text-gray-400 ml-1 shrink-0">
          {isExpanding
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : isExpanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-5 pt-3 bg-blue-50/30 border-t border-blue-100 space-y-4">
          {!pred && <p className="text-sm text-gray-500 animate-pulse">Calculando predicción…</p>}

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
                    <span className="text-xs text-gray-600">Marcador más probable:</span>
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
                    className={`text-xs p-2.5 rounded-lg border ${p.degraded ? 'border-gray-100 bg-white/50 opacity-60' : 'border-gray-200 bg-white'}`}
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
                    onClick={onSaveSnapshot}
                  >
                    {savedSnap.has(fixture.id) ? (
                      <><CheckCircle2 className="w-3.5 h-3.5" /> Guardado</>
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
                        type="number" min="0" max="20" value={resultHome}
                        onChange={e => onResultHome(e.target.value)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy"
                      />
                    </div>
                    <span className="text-gray-400 font-semibold mt-4">–</span>
                    <div className="flex flex-col items-center gap-1">
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Visitante</label>
                      <input
                        type="number" min="0" max="20" value={resultAway}
                        onChange={e => onResultAway(e.target.value)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy"
                      />
                    </div>
                    <Button
                      variant="primary" size="sm" loading={isSavingThis}
                      disabled={isSavingThis || !resultHome || !resultAway}
                      onClick={onRecordResult}
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
                    Resultado: {played?.home_goals ?? resultHome} – {played?.away_goals ?? resultAway}
                  </Badge>
                </div>
              )}
            </>
          )}

          {err && (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-xs">{err}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MatchesPage
// ---------------------------------------------------------------------------
export function MatchesPage() {
  const { groups, fixtures, teamMap, contextMap, engine, ratingsList, isLoading, error } = useAppData();
  const qc = useQueryClient();

  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [expandingId, setExpandingId]   = useState<string | null>(null);
  const [predictions, setPredictions]   = useState<Map<string, MatchPredictionResult>>(new Map());
  const [saving, setSaving]             = useState<string | null>(null);
  const [savedSnap, setSavedSnap]       = useState<Set<string>>(new Set());
  const [resultHome, setResultHome]     = useState('');
  const [resultAway, setResultAway]     = useState('');
  const [evalDone, setEvalDone]         = useState<Set<string>>(new Set());
  const [err, setErr]                   = useState('');

  // Filter state
  const [search, setSearch]             = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(TODAY);

  const { data: wcResults } = useQuery({ queryKey: ['wc-results'], queryFn: loadWcActualResults });
  const playedMap = useMemo(() =>
    new Map<string, WcActualResult>((wcResults ?? []).map(r => [r.fixture_id, r])),
    [wcResults]
  );

  // Sorted unique dates that have fixtures
  const fixtureDates = useMemo(() =>
    [...new Set(fixtures.filter(f => f.kickoff_utc).map(f => f.kickoff_utc!.slice(0, 10)))].sort(),
    [fixtures]
  );
  const dateIdx = fixtureDates.indexOf(selectedDate);
  const prevDate = dateIdx > 0 ? fixtureDates[dateIdx - 1] : null;
  const nextDate = dateIdx < fixtureDates.length - 1 ? fixtureDates[dateIdx + 1] : null;

  const expand = useCallback(async (fixture: Fixture) => {
    const isSame = expandedId === fixture.id;
    setExpandedId(isSame ? null : fixture.id);
    setResultHome('');
    setResultAway('');
    setErr('');
    if (!isSame && !predictions.has(fixture.id) && engine) {
      setExpandingId(fixture.id);
      // Yield to browser so the expanded row renders before the heavy compute
      await new Promise(r => setTimeout(r, 0));
      const ctx = engine.buildContext(fixture, teamMap, ratingsList, contextMap);
      const result = engine.predict(ctx);
      setPredictions(prev => new Map(prev).set(fixture.id, result));
      setExpandingId(null);
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
    } catch (e) { setErr(String(e)); }
    finally { setSaving(null); }
  };

  const recordResult = async (fixture: Fixture) => {
    const hg = parseInt(resultHome), ag = parseInt(resultAway);
    if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) { setErr('Ingresá goles válidos (0 o más).'); return; }
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
        home_goals: hg, away_goals: ag,
        home_win: p.homeWin, draw: p.draw, away_win: p.awayWin, actual,
        brier_score: brierScore(p, actual),
        ranked_probability_score: rankedProbabilityScore(p, actual),
        log_loss: logLoss(p, actual),
        top_pick_correct: topPick(p) === actual,
      });
      setEvalDone(prev => new Set(prev).add(fixture.id));
      qc.invalidateQueries({ queryKey: ['wc-results'] });
    } catch (e) { setErr(String(e)); }
    finally { setSaving(null); }
  };

  const fixtureRowProps = (fixture: Fixture, compact?: boolean) => ({
    fixture,
    played: playedMap.get(fixture.id),
    pred: predictions.get(fixture.id),
    isExpanded: expandedId === fixture.id,
    isExpanding: expandingId === fixture.id,
    isSavingThis: saving === fixture.id,
    savedSnap, evalDone, resultHome, resultAway,
    err: expandedId === fixture.id ? err : '',
    onExpand: () => expand(fixture),
    onSaveSnapshot: () => saveSnapshot(fixture),
    onRecordResult: () => recordResult(fixture),
    onResultHome: setResultHome,
    onResultAway: setResultAway,
    homeName: teamMap.get(fixture.home_team_id)?.name ?? fixture.home_team_id,
    awayName: teamMap.get(fixture.away_team_id)?.name ?? fixture.away_team_id,
    compact,
  });

  // ---- filtered fixtures ----
  const searchTerm = search.toLowerCase().trim();
  const searchResults = useMemo(() => {
    if (!searchTerm) return [];
    return fixtures.filter(f => {
      const home = (teamMap.get(f.home_team_id)?.name ?? f.home_team_id).toLowerCase();
      const away = (teamMap.get(f.away_team_id)?.name ?? f.away_team_id).toLowerCase();
      return home.includes(searchTerm) || away.includes(searchTerm);
    });
  }, [searchTerm, fixtures, teamMap]);

  const todayFixtures = useMemo(() =>
    fixtures
      .filter(f => fixtureDate(f) === selectedDate)
      .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? '')),
    [fixtures, selectedDate]
  );

  const groupsToShow = useMemo(() =>
    selectedGroup ? groups.filter(g => g.name === selectedGroup) : groups,
    [groups, selectedGroup]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando partidos…">Partidos</SectionTitle>
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <SectionTitle>Partidos</SectionTitle>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{String(error)}</p>
        </div>
      </div>
    );
  }

  const isSearching = searchTerm.length > 0;

  return (
    <div className="space-y-5">

      {/* ------------------------------------------------------------------ */}
      {/* BUSCADOR                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar equipo…"
          className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* RESULTADOS DE BÚSQUEDA                                               */}
      {/* ------------------------------------------------------------------ */}
      {isSearching && (
        <div>
          <p className="text-xs text-gray-400 mb-2 px-1">
            {searchResults.length} resultado{searchResults.length !== 1 ? 's' : ''} para "{search}"
          </p>
          {searchResults.length === 0 ? (
            <Card className="p-6 text-center text-gray-400 text-sm">
              No hay partidos que coincidan con "{search}"
            </Card>
          ) : (
            <Card>
              <div className="divide-y divide-gray-100">
                {searchResults.map(f => (
                  <FixtureRow key={f.id} {...fixtureRowProps(f)} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* SECCIÓN "PARTIDOS DE HOY" (solo cuando no busca)                    */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && (
        <div>
          {/* Header con navegación de fecha */}
          <div className="bg-wc-gradient rounded-2xl overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white">
                <Calendar className="w-4 h-4 text-wc-gold" />
                <span className="font-black text-sm">
                  {selectedDate === TODAY ? 'Hoy · ' : ''}{formatDateLabel(selectedDate)}
                </span>
                {selectedDate === TODAY && (
                  <Badge color="gold">En vivo</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => prevDate && setSelectedDate(prevDate)}
                  disabled={!prevDate}
                  className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedDate(TODAY)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${selectedDate === TODAY ? 'bg-wc-gold text-wc-navy' : 'text-white/70 hover:bg-white/10'}`}
                >
                  Hoy
                </button>
                <button
                  onClick={() => nextDate && setSelectedDate(nextDate)}
                  disabled={!nextDate}
                  className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {todayFixtures.length === 0 ? (
              <div className="px-5 pb-4 text-white/50 text-sm">
                No hay partidos este día
              </div>
            ) : (
              <div className="bg-white/5">
                {todayFixtures.map((f, i) => {
                  const homeName = teamMap.get(f.home_team_id)?.name ?? f.home_team_id;
                  const awayName = teamMap.get(f.away_team_id)?.name ?? f.away_team_id;
                  const played = playedMap.get(f.id);
                  const pred = predictions.get(f.id);
                  return (
                    <div key={f.id} className={i > 0 ? 'border-t border-white/10' : ''}>
                      <button
                        onClick={() => expand(f)}
                        disabled={expandingId === f.id}
                        className={`w-full flex flex-col px-5 py-3 hover:bg-white/10 transition-colors text-left ${expandingId === f.id ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[10px] font-bold text-wc-gold/80 uppercase tracking-wide">
                            Partido {i + 1}
                          </span>
                          {f.kickoff_utc && (
                            <>
                              <span className="text-white/30 text-[10px]">·</span>
                              <span className="text-[10px] font-semibold text-white/60">
                                {kickoffART(f.kickoff_utc)} ART
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3 w-full">
                          <span className="text-xl leading-none">{flag(f.home_team_id)}</span>
                          <span className="font-bold text-white text-sm truncate flex-1">{homeName}</span>
                          <span className="text-white/40 text-xs font-medium shrink-0">vs</span>
                          <span className="font-bold text-white text-sm truncate flex-1 text-right">{awayName}</span>
                          <span className="text-xl leading-none">{flag(f.away_team_id)}</span>
                          <span className="ml-1 shrink-0">
                            {played ? (
                              <Badge color="green">{played.home_goals}–{played.away_goals}</Badge>
                            ) : (
                              <span className="text-xs font-semibold text-wc-gold bg-wc-navy/50 px-2 py-0.5 rounded-md">
                                Grp {f.group_name}
                              </span>
                            )}
                          </span>
                          <span className="text-white/40 shrink-0">
                            {expandingId === f.id
                              ? <Loader2 className="w-4 h-4 animate-spin text-wc-gold" />
                              : expandedId === f.id
                                ? <ChevronUp className="w-4 h-4" />
                                : <ChevronDown className="w-4 h-4" />}
                          </span>
                        </div>
                      </button>
                      {expandedId === f.id && (
                        <div className="bg-white">
                          <FixtureRow {...fixtureRowProps(f)} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TABS DE GRUPO (solo cuando no busca)                                */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setSelectedGroup(null)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!selectedGroup ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Todos
          </button>
          {groups.map(g => (
            <button
              key={g.name}
              onClick={() => setSelectedGroup(selectedGroup === g.name ? null : g.name)}
              className={`shrink-0 w-9 h-8 rounded-lg text-xs font-bold transition-colors ${selectedGroup === g.name ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PARTIDOS POR GRUPO (solo cuando no busca)                           */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && groupsToShow.map(group => {
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
              {groupFixtures.map(f => (
                <FixtureRow key={f.id} {...fixtureRowProps(f, true)} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
