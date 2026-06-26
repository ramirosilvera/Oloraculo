import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAppData } from '../hooks/useAppData';
import { useLiveScores, getLiveForFixture } from '../hooks/useLiveScores';
import type { LiveMatch, LiveEvent } from '../hooks/useLiveScores';
import {
  saveMatchSnapshot,
  saveEvaluations,
  deleteEvaluationsForFixtures,
  saveWcActualResult,
  upsertFixtureContext,
  loadEvaluations,
  loadAllMatchGoals,
} from '../services/supabase-client';
import type { MatchGoal } from '../services/supabase-client';
import { GoalList } from '../components/GoalList';
import { TopScorers } from '../components/TopScorers';
import { computeModelWeights } from '../engine/final-selector';
import { buildEvaluationRows } from '../engine/evaluation';
import type { Fixture, FixtureContext, MatchPredictionResult, WcActualResult, DailyPatternSignal, MatchPrediction, PredictionEvaluation, Team, Rating } from '../types/domain';
import { ModelDetailPanel, MiniBar } from '../components/ModelDetailPanel';
import { PIECard } from '../components/PIECard';
import { usePIEForFixture } from '../hooks/usePIE';
import { KnockoutActivationButton } from '../components/KnockoutActivationButton';
import { computeGroupStandingsDisplay } from '../utils/standings';
import { MODEL_TIERS } from '../engine/model-tiers';
import { detectDailyPattern } from '../engine/models/daily-pattern';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  ProbBar,
  ScoreTriple,
  Tooltip,
  SectionTitle,
  SkeletonCard,
  FlagImg,
} from '../components/ui';
import { mostLikelyScorePerOutcome, topPick, DRAW_MARGIN_THRESHOLD } from '../engine/probability-helper';
import {
  ChevronDown, ChevronUp, Save, CheckCircle2, AlertCircle,
  Info, Search, X, ChevronLeft, ChevronRight, Calendar, Loader2,
} from 'lucide-react';

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function fixtureDate(f: Fixture): string | null {
  if (!f.kickoff_utc) return null;
  return new Date(f.kickoff_utc).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
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

function kickoffShortDate(utc: string): string {
  return new Date(utc).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

// StandingRow is imported from standings.ts via computeGroupStandingsDisplay

// ---------------------------------------------------------------------------
// ContextEditor — lets the user enter player availability context
// to unlock L5 (GoalContextModel) predictions
// ---------------------------------------------------------------------------
interface ContextEditorProps {
  fixture: Fixture;
  homeName: string;
  awayName: string;
  existingContext: FixtureContext | null;
  onSave: (ctx: FixtureContext) => Promise<void>;
}

function ContextEditor({ fixture, homeName, awayName, existingContext, onSave }: ContextEditorProps) {
  const [open, setOpen] = useState(false);
  const [homeUnavail,  setHomeUnavail]  = useState(existingContext?.unavailable_home_players ?? 0);
  const [homeAttack,   setHomeAttack]   = useState(Math.round((existingContext?.unavailable_home_attack_impact   ?? 0) * 100));
  const [homeDefense,  setHomeDefense]  = useState(Math.round((existingContext?.unavailable_home_defense_impact  ?? 0) * 100));
  const [awayUnavail,  setAwayUnavail]  = useState(existingContext?.unavailable_away_players ?? 0);
  const [awayAttack,   setAwayAttack]   = useState(Math.round((existingContext?.unavailable_away_attack_impact   ?? 0) * 100));
  const [awayDefense,  setAwayDefense]  = useState(Math.round((existingContext?.unavailable_away_defense_impact  ?? 0) * 100));
  const [hasLineups,   setHasLineups]   = useState(existingContext?.has_lineups ?? false);
  const [hasOdds,      setHasOdds]      = useState(existingContext?.has_odds ?? false);
  const [hasAvailNews, setHasAvailNews] = useState(existingContext?.has_availability_news ?? false);
  const [notes,        setNotes]        = useState(existingContext?.notes ?? '');
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [fetching,     setFetching]     = useState(false);
  const [fetchErr,     setFetchErr]     = useState('');

  async function handleFetchContext() {
    setFetching(true);
    setFetchErr('');
    try {
      const res = await fetch('/api/refresh-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture_id: fixture.id, home_name: homeName, away_name: awayName }),
      });
      const json = await res.json();
      if (!res.ok) { setFetchErr(json.error ?? `Error ${res.status}`); return; }
      setHomeUnavail(json.unavailable_home_players ?? 0);
      setHomeAttack(Math.round((json.unavailable_home_attack_impact ?? 0) * 100));
      setHomeDefense(Math.round((json.unavailable_home_defense_impact ?? 0) * 100));
      setAwayUnavail(json.unavailable_away_players ?? 0);
      setAwayAttack(Math.round((json.unavailable_away_attack_impact ?? 0) * 100));
      setAwayDefense(Math.round((json.unavailable_away_defense_impact ?? 0) * 100));
      setHasAvailNews(true);
      if (json.notes) setNotes(json.notes);
    } catch (e: any) {
      setFetchErr(e?.message ?? 'Error de red');
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const ctx: FixtureContext = {
      fixture_id:                      fixture.id,
      unavailable_home_players:        homeUnavail,
      unavailable_home_attack_impact:  homeAttack  / 100,
      unavailable_home_defense_impact: homeDefense / 100,
      unavailable_away_players:        awayUnavail,
      unavailable_away_attack_impact:  awayAttack  / 100,
      unavailable_away_defense_impact: awayDefense / 100,
      has_lineups:         hasLineups,
      has_odds:            hasOdds,
      has_availability_news: hasAvailNews,
      notes: notes.trim() || null,
      updated_at: '',
    };
    try {
      await onSave(ctx);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  const hasAnyImpact = homeAttack > 0 || homeDefense > 0 || awayAttack > 0 || awayDefense > 0 ||
    homeUnavail > 0 || awayUnavail > 0;

  return (
    <div className="border-t border-blue-100 pt-3 mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-wc-navy hover:opacity-70 transition-opacity active:scale-95"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        Agregar contexto del partido
        {existingContext && hasAnyImpact && <Badge color="green">L5 activo</Badge>}
        {existingContext && !hasAnyImpact && <Badge color="blue">guardado</Badge>}
      </button>

      {open && (
        <div className="mt-3 space-y-4 animate-fade-in">
          <p className="text-[10px] text-gray-400">
            Completá disponibilidad de jugadores para que el Oráculo use el modelo L5 (Goles + Contexto).
            Impacto en ataque/defensa: % de reducción de los goles esperados (ej: 15 = 15% menos goles).
          </p>

          {/* Auto-fetch from Serper + Gemini */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={fetching}
              disabled={fetching}
              onClick={handleFetchContext}
            >
              {fetching
                ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Buscando bajas…</>
                : <><Search className="w-3.5 h-3.5 mr-1" />Buscar bajas automáticamente</>}
            </Button>
            {fetchErr && (
              <span className="text-[10px] text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />{fetchErr}
              </span>
            )}
          </div>

          {/* Home team */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700">{homeName} · Local</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">No disponibles</label>
                <input type="number" min={0} max={11} value={homeUnavail}
                  onChange={e => setHomeUnavail(Math.max(0, Math.min(11, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Impacto ataque %</label>
                <input type="number" min={0} max={30} value={homeAttack}
                  onChange={e => setHomeAttack(Math.max(0, Math.min(30, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Impacto defensa %</label>
                <input type="number" min={0} max={30} value={homeDefense}
                  onChange={e => setHomeDefense(Math.max(0, Math.min(30, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
            </div>
          </div>

          {/* Away team */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700">{awayName} · Visitante</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">No disponibles</label>
                <input type="number" min={0} max={11} value={awayUnavail}
                  onChange={e => setAwayUnavail(Math.max(0, Math.min(11, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Impacto ataque %</label>
                <input type="number" min={0} max={30} value={awayAttack}
                  onChange={e => setAwayAttack(Math.max(0, Math.min(30, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Impacto defensa %</label>
                <input type="number" min={0} max={30} value={awayDefense}
                  onChange={e => setAwayDefense(Math.max(0, Math.min(30, +e.target.value)))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy text-center" />
              </div>
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-4">
            {([
              { label: 'Tengo alineaciones',            val: hasLineups,   set: setHasLineups   },
              { label: 'Tengo cuotas de apuestas',      val: hasOdds,      set: setHasOdds      },
              { label: 'Tengo noticias de disponibilidad', val: hasAvailNews, set: setHasAvailNews },
            ] as const).map(({ label, val, set }) => (
              <label key={label} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                  className="w-3.5 h-3.5 accent-wc-navy" />
                {label}
              </label>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Notas adicionales</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej: Mbappé con molestias, no jugará el 9 titular…"
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-wc-navy resize-none"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={saving || saved}
            onClick={handleSave}
          >
            {saved
              ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Predicción actualizada con L5</>
              : 'Actualizar predicción con contexto'}
          </Button>
        </div>
      )}
    </div>
  );
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
  onContextSaved: (ctx: FixtureContext) => Promise<void>;
  onRecordLiveResult?: (homeGoals: number, awayGoals: number) => Promise<void>;
  homeName: string;
  awayName: string;
  context: FixtureContext | null;
  compact?: boolean;
  bestModelName: string | null;
  bestModelWinnerAcc: number | null;
  liveMatch?: LiveMatch;
  goals?: MatchGoal[];
  // PIE data
  ratings: Rating[];
  allFixtures: Fixture[];
  wcResultsForPIE: WcActualResult[];
  pieLooWinner?: { correct: number; total: number } | null;
  pieLooExact?: { correct: number; total: number } | null;
  modelWeights?: Map<string, number>;
  modelEvalStats?: Map<string, ModelStats>;
}

function FixtureRow({
  fixture, played, pred, isExpanded, isExpanding, isSavingThis, savedSnap, evalDone,
  resultHome, resultAway, err, onExpand, onSaveSnapshot, onRecordResult,
  onResultHome, onResultAway, onContextSaved, onRecordLiveResult, homeName, awayName,
  context, compact, bestModelName, bestModelWinnerAcc, liveMatch, goals,
  ratings, allFixtures, wcResultsForPIE, pieLooWinner, pieLooExact,
  modelWeights, modelEvalStats,
}: FixtureRowProps) {
  const [selectedModelDetail, setSelectedModelDetail] = useState<MatchPrediction | null>(null);
  const [showPIEDetail, setShowPIEDetail] = useState(false);
  const { result: pieResult } = usePIEForFixture({
    fixture,
    ratings,
    allFixtures,
    wcResults: wcResultsForPIE,
    enabled: isExpanded,
  });
  return (
    <div>
      <button
        onClick={onExpand}
        disabled={isExpanding}
        className={`w-full flex items-center gap-2 px-4 py-3 hover:bg-wc-cream/50 active:bg-wc-cream transition-all text-left ${compact ? 'py-2.5' : ''} ${isExpanding ? 'opacity-60' : ''}`}
      >
        <FlagImg id={fixture.home_team_id} />
        <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{homeName}</span>
        <div className="flex flex-col items-center shrink-0 px-1">
          {played ? null : fixture.kickoff_utc && fixture.id.startsWith('ko:') ? (
            <>
              <span className="text-[11px] text-gray-400 font-medium tabular-nums leading-tight">
                {kickoffART(fixture.kickoff_utc)}
              </span>
              <span className="text-[9px] text-gray-300 leading-tight">
                {kickoffShortDate(fixture.kickoff_utc)}
              </span>
            </>
          ) : (
            <span className="text-xs text-gray-400 font-medium">vs</span>
          )}
        </div>
        <span className="flex-1 font-semibold text-gray-900 text-sm truncate text-right">{awayName}</span>
        <FlagImg id={fixture.away_team_id} />
        {played ? (
          <Badge color="green">{played.home_goals} – {played.away_goals}</Badge>
        ) : liveMatch?.status === 'IN_PLAY' || liveMatch?.status === 'PAUSED' ? (
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            {liveMatch.homeGoals ?? 0}–{liveMatch.awayGoals ?? 0}
            {liveMatch.minute ? ` ${liveMatch.minute}'` : ' EN VIVO'}
          </span>
        ) : liveMatch?.status === 'FINISHED' ? (
          <Badge color="green">{liveMatch.homeGoals ?? 0}–{liveMatch.awayGoals ?? 0}</Badge>
        ) : pred ? (() => {
          const pick = topPick(pred.bestPrediction.outcome);
          const { homeWin, draw, awayWin } = pred.bestPrediction.outcome;
          const prob = pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw;
          const label = pick === 'Home' ? 'L' : pick === 'Away' ? 'V' : 'E';
          const cls = pick === 'Home'
            ? 'text-wc-navy bg-blue-50 border-blue-200'
            : pick === 'Away'
            ? 'text-wc-red bg-red-50 border-red-200'
            : 'text-gray-600 bg-gray-50 border-gray-200';
          return (
            <span className={`text-[11px] font-black tabular-nums border px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>
              {label} {Math.round(prob * 100)}%
            </span>
          );
        })() : null}
        <span className="text-gray-400 ml-1 shrink-0">
          {isExpanding
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : isExpanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Goal scorers strip — visible without expanding the card */}
      {played && goals && goals.length > 0 && (
        <GoalList
          fixtureId={fixture.id}
          homeTeamId={fixture.home_team_id}
          awayTeamId={fixture.away_team_id}
          goals={goals}
        />
      )}

      {isExpanded && (
        <div className="px-4 pb-5 pt-3 bg-blue-50/30 border-t border-blue-100 space-y-4">
          {!pred && <p className="text-sm text-gray-500 animate-pulse">Calculando predicción…</p>}

          {pred && (
            <>
              {/* ── Predicción principal: PIE ──────────────────────────────────── */}
              {pieResult && !pieResult.degraded ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color="red">PIE</Badge>
                    {pieResult.leader && (
                      <span className="text-[10px] text-gray-500">
                        Líder #{pieResult.leader.id.replace('pie-', '')}
                        {' '}· {pieResult.leader.correct}/{pieResult.leader.total} ✓
                        {pieResult.leader.exactCorrect >= 0.5 && ` · ${Math.round(pieResult.leader.exactCorrect * 10) / 10} 🎯`}
                      </span>
                    )}
                    {bestModelName && bestModelWinnerAcc !== null && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        ★ {bestModelName} · {Math.round(bestModelWinnerAcc * 100)}%
                      </span>
                    )}
                  </div>
                  <ProbBar
                    home={pieResult.pick_probabilities.home}
                    draw={pieResult.pick_probabilities.draw}
                    away={pieResult.pick_probabilities.away}
                    homeLabel={homeName}
                    awayLabel={awayName}
                  />
                  {pieResult.leader && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Pronóstico del campeón:</span>
                      <span className="font-black text-wc-navy tabular-nums">
                        {pieResult.leader.pickScore.home}–{pieResult.leader.pickScore.away}
                      </span>
                      <span className="text-gray-400">
                        ({pieResult.leader.pick === 'Home' ? homeName
                          : pieResult.leader.pick === 'Away' ? awayName
                          : 'Empate'})
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => { setSelectedModelDetail(null); setShowPIEDetail(prev => !prev); }}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-800 flex items-center gap-1 active:opacity-70 transition-opacity"
                  >
                    Ver análisis de competencia →
                  </button>
                </div>
              ) : (
                /* Sin datos PIE aún: mostrar el mejor modelo estadístico */
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color="blue">{pred.bestPrediction.predictorName}</Badge>
                    {bestModelName && bestModelWinnerAcc !== null && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        ★ {bestModelName} · {Math.round(bestModelWinnerAcc * 100)}% ganador
                      </span>
                    )}
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
                  {pred.bestPrediction.scoreline && (() => {
                    const perOutcome = mostLikelyScorePerOutcome(pred.bestPrediction.scoreline);
                    return (
                      <ScoreTriple
                        scores={perOutcome}
                        homeLabel={homeName}
                        awayLabel={awayName}
                        size="sm"
                      />
                    );
                  })()}
                </div>
              )}

              {/* ── Modelos de referencia ───────────────────────────────────────── */}
              {(() => {
                const hasWeights = modelWeights && modelWeights.size >= 2;
                const topModels = pred.predictions
                  .filter(p => !p.degraded)
                  .sort((a, b) => {
                    const wa = modelWeights?.get(a.predictorName) ?? 0;
                    const wb = modelWeights?.get(b.predictorName) ?? 0;
                    if (Math.abs(wa - wb) > 0.001) return wb - wa;
                    return b.predictorPriority - a.predictorPriority;
                  })
                  .slice(0, 5);
                const picks = topModels.map(p => topPick(p.outcome));
                const allAgree = picks.length >= 2 && picks.every(pk => pk === picks[0]);
                return (
                  <div className="rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-3 py-1.5 bg-gray-50/60 border-b border-gray-50 flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex-1">
                        {hasWeights ? 'Modelos · por peso histórico' : 'Modelos de referencia'}
                      </span>
                      {allAgree && (
                        <span className="text-[10px] font-bold text-emerald-700">
                          ● Consenso · {picks[0] === 'Home' ? homeName : picks[0] === 'Away' ? awayName : 'Empate'}
                        </span>
                      )}
                    </div>
                    {topModels.map((p, idx) => {
                      const pick = topPick(p.outcome);
                      const isBest = p.predictorName === bestModelName;
                      const prob = pick === 'Home' ? p.outcome.homeWin : pick === 'Away' ? p.outcome.awayWin : p.outcome.draw;
                      const pickLabel = pick === 'Home' ? 'L' : pick === 'Away' ? 'V' : 'E';
                      const pickColor = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-600';
                      const isSelected = selectedModelDetail?.predictorName === p.predictorName;
                      const tierInfo = MODEL_TIERS[p.predictorName];
                      const shortName = tierInfo?.shortName ?? p.predictorName;
                      const st = modelEvalStats?.get(p.predictorName);
                      const wt = modelWeights?.get(p.predictorName);
                      const accBadge = st && st.n >= 5 ? (() => {
                        const acc = Math.round(st.winnerAcc * 100);
                        const cls = acc >= 60
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : acc >= 45
                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                            : 'text-red-600 bg-red-50 border-red-200';
                        return <span className={`text-[9px] font-bold px-1 py-0 rounded border tabular-nums shrink-0 ${cls}`}>{acc}%</span>;
                      })() : null;
                      return (
                        <button
                          key={p.predictorName}
                          onClick={() => { setShowPIEDetail(false); setSelectedModelDetail(isSelected ? null : p); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0 text-left transition-all ${isBest ? 'bg-amber-50/60 hover:bg-amber-50' : idx === 0 && hasWeights ? 'bg-wc-cream/30 hover:bg-wc-cream/50' : 'hover:bg-gray-50'} ${isSelected ? 'bg-blue-50/60' : ''}`}
                        >
                          {isBest
                            ? <span className="text-amber-400 shrink-0 text-[10px]">★</span>
                            : idx === 0 && hasWeights
                              ? <span className="text-emerald-500 shrink-0 text-[10px]">▲</span>
                              : <span className="w-3 shrink-0" />}
                          <span className="font-semibold text-gray-700 truncate shrink-0 max-w-[4rem]">{shortName}</span>
                          {accBadge}
                          <MiniBar home={p.outcome.homeWin} draw={p.outcome.draw} away={p.outcome.awayWin} />
                          <span className={`font-black tabular-nums text-sm ${pickColor} w-5 text-center shrink-0`}>{pickLabel}</span>
                          <span className="text-gray-400 tabular-nums w-9 text-right shrink-0">{Math.round(prob * 100)}%</span>
                          {wt != null
                            ? <span className="text-gray-300 tabular-nums text-[9px] w-7 text-right shrink-0">{Math.round(wt * 100)}%w</span>
                            : p.mostLikelyScore
                              ? <span className="text-gray-300 tabular-nums text-[10px] w-7 text-right shrink-0">{p.mostLikelyScore.home}-{p.mostLikelyScore.away}</span>
                              : <span className="w-7 shrink-0" />}
                          <span className="text-gray-300 text-[10px] shrink-0">›</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {selectedModelDetail && (
                <ModelDetailPanel
                  model={selectedModelDetail}
                  homeName={homeName}
                  awayName={awayName}
                  onClose={() => setSelectedModelDetail(null)}
                />
              )}

              {showPIEDetail && pieResult && (
                <PIECard
                  result={pieResult}
                  homeName={homeName}
                  awayName={awayName}
                  onClose={() => setShowPIEDetail(false)}
                  looWinnerAcc={pieLooWinner}
                  looExactAcc={pieLooExact}
                />
              )}

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

                  {/* Auto-fill from live API when match is finished */}
                  {liveMatch?.status === 'FINISHED' && liveMatch.homeGoals != null && liveMatch.awayGoals != null && (
                    <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-emerald-700">Resultado oficial detectado</p>
                        <p className="text-xs text-emerald-600 tabular-nums font-bold">
                          {homeName} {liveMatch.homeGoals} – {liveMatch.awayGoals} {awayName}
                        </p>
                      </div>
                      <Button
                        variant="primary" size="sm" loading={isSavingThis}
                        disabled={isSavingThis || !onRecordLiveResult}
                        onClick={() => onRecordLiveResult?.(liveMatch.homeGoals!, liveMatch.awayGoals!)}
                        className="shrink-0"
                      >
                        Guardar
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Local</label>
                      <input
                        type="number" min="0" max="20"
                        value={liveMatch?.status === 'FINISHED' && liveMatch.homeGoals != null && !resultHome
                          ? String(liveMatch.homeGoals) : resultHome}
                        onChange={e => onResultHome(e.target.value)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-wc-navy/30 focus:border-wc-navy"
                      />
                    </div>
                    <span className="text-gray-400 font-semibold mt-4">–</span>
                    <div className="flex flex-col items-center gap-1">
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Visitante</label>
                      <input
                        type="number" min="0" max="20"
                        value={liveMatch?.status === 'FINISHED' && liveMatch.awayGoals != null && !resultAway
                          ? String(liveMatch.awayGoals) : resultAway}
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

          {pred && !played && !evalDone.has(fixture.id) && (
            <ContextEditor
              key={context?.updated_at ?? 'new'}
              fixture={fixture}
              homeName={homeName}
              awayName={awayName}
              existingContext={context}
              onSave={onContextSaved}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// modelStats — winner + exact-score accuracy for a single model from history.
// Used to show track-record badges in the gradient card header and model rows.
// ---------------------------------------------------------------------------
interface ModelStats { winnerAcc: number; exactAcc: number; n: number }

function modelStats(evals: PredictionEvaluation[], modelName: string): ModelStats {
  let winnerCorrect = 0, exactCorrect = 0, total = 0;
  for (const e of evals) {
    if (e.model_name !== modelName) continue;
    total++;
    if (e.top_pick_correct) winnerCorrect++;
    if (e.exact_score_correct) exactCorrect++;
  }
  return {
    winnerAcc: total > 0 ? winnerCorrect / total : 0,
    exactAcc:  total > 0 ? exactCorrect  / total : 0,
    n: total,
  };
}

// Last 5 FIFA World Cups (2006–2022), 320 matches.
// Compiled match-by-match from Wikipedia / RSSSF / ESPN. Scores at AET when applicable.
const WC_5TOUR_SCORELINES = [
  { score: '1-0', count: 67, pct: 20.9 },
  { score: '2-1', count: 57, pct: 17.8 },
  { score: '2-0', count: 45, pct: 14.1 },
  { score: '0-0', count: 31, pct: 9.7  },
  { score: '1-1', count: 26, pct: 8.1  },
  { score: '3-0', count: 22, pct: 6.9  },
  { score: '3-1', count: 16, pct: 5.0  },
] as const;
const WC_5TOUR_MATCHES = 320;

function TopScorelines({ wcResults }: { wcResults: WcActualResult[] }) {
  const hasLive = wcResults.length >= 3;

  const liveFreq = new Map<string, number>();
  for (const r of wcResults) {
    if (r.home_goals == null || r.away_goals == null) continue;
    const hi = Math.max(r.home_goals, r.away_goals);
    const lo = Math.min(r.home_goals, r.away_goals);
    const key = `${hi}-${lo}`;
    liveFreq.set(key, (liveFreq.get(key) ?? 0) + 1);
  }

  const histMap = new Map<string, number>(WC_5TOUR_SCORELINES.map(h => [h.score, h.pct]));

  const allScores = new Set([
    ...liveFreq.keys(),
    ...WC_5TOUR_SCORELINES.map(h => h.score),
  ]);
  const chips = [...allScores]
    .map(score => {
      const liveCount = liveFreq.get(score) ?? 0;
      const livePct   = wcResults.length > 0 ? (liveCount / wcResults.length) * 100 : 0;
      return { score, livePct, histPct: histMap.get(score) ?? null };
    })
    .sort((a, b) => hasLive ? b.livePct - a.livePct : (b.histPct ?? 0) - (a.histPct ?? 0))
    .slice(0, 6);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-gray-700">Marcadores más repetidos</p>
        {hasLive && (
          <span className="text-[9px] text-wc-gold font-semibold tabular-nums shrink-0">
            WC2026 · {wcResults.length}p
          </span>
        )}
      </div>
      <div className="px-3 pb-2 grid grid-cols-3 gap-1.5">
        {chips.map((chip) => (
          <div key={chip.score} className="bg-gray-50 rounded-xl px-2 py-1.5 text-center">
            <div className="text-sm font-bold text-wc-navy tabular-nums">{chip.score}</div>
            {hasLive ? (
              <>
                <div className="text-[10px] font-semibold text-wc-gold tabular-nums leading-tight">
                  {chip.livePct.toFixed(0)}%
                </div>
                {chip.histPct != null && (
                  <div className="text-[8px] text-gray-400 tabular-nums leading-tight">
                    h.{chip.histPct.toFixed(1)}%
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] text-gray-400 tabular-nums leading-tight">
                {chip.histPct != null ? `${chip.histPct.toFixed(1)}%` : '—'}
              </div>
            )}
          </div>
        ))}
      </div>
      {wcResults.length > 0 && wcResults.length < 16 && (
        <p className="text-[9px] text-amber-600 mx-3 mb-2 bg-amber-50 border border-amber-100 rounded px-2 py-0.5">
          ⚠ Muestra pequeña ({wcResults.length}p) · provisorio
        </p>
      )}
      <p className="text-[8px] text-gray-300 text-right px-3 pb-1.5">
        últimos 5 Mundiales (2006–2022) · {WC_5TOUR_MATCHES}p
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TournamentPace — "Racha del Mundial" journalistic widget
// Compares WC2026 avg goals/match to the historical WC baseline (2.50)
// Also shows the detected daily scoring streak (from daily-pattern.ts)
// ---------------------------------------------------------------------------
const WC_HISTORICAL_GOALS_PER_MATCH = 2.50;

const PATTERN_LABELS: Record<string, { label: string; emoji: string }> = {
  blowout:     { label: 'Días de palazo',    emoji: '💥' },
  decisive:    { label: 'Días definidos',    emoji: '⚽' },
  draw_heavy:  { label: 'Días de empates',   emoji: '🤝' },
  low_scoring: { label: 'Días defensivos',   emoji: '🧱' },
  contested:   { label: 'Días parejos',      emoji: '⚖️' },
};

function TournamentPace({ wcResults, dailySignal }: { wcResults: WcActualResult[]; dailySignal: DailyPatternSignal | null }) {
  if (wcResults.length < 3) return null;

  const totalGoals = wcResults.reduce((s, r) => s + r.home_goals + r.away_goals, 0);
  const avgPerMatch = totalGoals / wcResults.length;
  const factor = avgPerMatch / WC_HISTORICAL_GOALS_PER_MATCH;

  let emoji: string, label: string, sub: string, barColor: string;
  if (factor >= 1.6) {
    emoji = '💥'; label = 'Mundial Explosivo';
    sub = 'Ritmo goleador histórico. El modelo amplifica predicciones de goles.';
    barColor = 'bg-red-500';
  } else if (factor >= 1.3) {
    emoji = '🔥'; label = 'Muy goleador';
    sub = 'El torneo está siendo excepcionalmente abierto y goleador.';
    barColor = 'bg-orange-400';
  } else if (factor >= 1.1) {
    emoji = '⚡'; label = 'Ritmo alto';
    sub = 'Por encima del promedio histórico de mundiales.';
    barColor = 'bg-yellow-400';
  } else if (factor >= 0.9) {
    emoji = '📊'; label = 'Ritmo histórico';
    sub = 'Promedio de goles en línea con los mundiales anteriores.';
    barColor = 'bg-blue-400';
  } else {
    emoji = '🧱'; label = 'Ritmo defensivo';
    sub = 'Torneo de bajo puntaje. Las defensas están dominando.';
    barColor = 'bg-gray-400';
  }

  const barWidth = Math.min(100, Math.round((factor / 2) * 100));
  const streakInfo = dailySignal ? PATTERN_LABELS[dailySignal.currentStreak] : null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Single compact row: emoji + label + factor + mini-bar + stats */}
      <div className="px-4 py-2 flex items-center gap-2">
        <span className="text-base leading-none shrink-0">{emoji}</span>
        <span className="text-xs font-bold text-gray-800 truncate">{label}</span>
        <span className="text-[9px] font-bold text-wc-navy bg-wc-navy/10 px-1 py-px rounded shrink-0">
          ×{factor.toFixed(2)}
        </span>
        <div className="flex-1 bg-gray-100 rounded-full h-1 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
        </div>
        <span className="text-[9px] text-gray-400 tabular-nums shrink-0 whitespace-nowrap">
          {avgPerMatch.toFixed(2)} gol/p
        </span>
        <Tooltip text="Factor de inflación goleadora del torneo: compara el promedio actual del Mundial 2026 contra el histórico de mundiales (2.50 goles/partido). El modelo L6 lo aplica automáticamente para amplificar las predicciones de goles cuando el torneo lo justifica.">
          <Info className="w-3.5 h-3.5 text-gray-300 shrink-0" />
        </Tooltip>
      </div>

      {/* Daily scoring streak — informational only (not used in predictions) */}
      {dailySignal && streakInfo && (
        <div className="px-4 py-1.5 border-t border-gray-100 bg-gray-50/40 flex items-center gap-1.5">
          <span className="text-sm leading-none shrink-0">{streakInfo.emoji}</span>
          <span className="text-[10px] font-semibold text-gray-600 flex-1 min-w-0 truncate">
            {dailySignal.streakDays >= 2
              ? `Racha ${dailySignal.streakDays}d: ${streakInfo.label.toLowerCase()}`
              : `Ayer: ${streakInfo.label.toLowerCase()}`}
          </span>
          <Tooltip text={`Patrón goleador del torneo (informativo). Se necesitan ${3 - dailySignal.streakDays > 0 ? 3 - dailySignal.streakDays : 0} días más para activar en predicciones.`}>
            <Info className="w-3 h-3 text-gray-300 shrink-0" />
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolve an ESPN team name → local slug so FlagImg and teamMap work.
// ESPN sends numeric team IDs which don't match our local slugs.
// We match by display name first, then by slugified name, then overrides.
// ---------------------------------------------------------------------------
const ESPN_NAME_OVERRIDES: Record<string, string> = {
  'usa':                         'united-states',
  'korea republic':              'south-korea',
  'côte d\'ivoire':              'ivory-coast',
  "cote d'ivoire":               'ivory-coast',
  'dr congo':                    'congo-dr',
  'democratic republic of congo':'congo-dr',
  'bosnia-herzegovina':          'bosnia-and-herzegovina',
};

function resolveLocalId(espnName: string, espnId: string | null, teamMap: Map<string, Team>): string {
  if (espnId && teamMap.has(espnId)) return espnId;
  const nameLower = espnName.toLowerCase().trim();
  for (const [id, team] of teamMap) {
    if (team.name.toLowerCase().trim() === nameLower) return id;
  }
  const slugified = nameLower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (teamMap.has(slugified)) return slugified;
  if (ESPN_NAME_OVERRIDES[nameLower]) return ESPN_NAME_OVERRIDES[nameLower];
  return espnId ?? '';
}

// ---------------------------------------------------------------------------
// EventChip — compact goal / card indicator for the live match card
// ---------------------------------------------------------------------------
const EVENT_ICON: Record<string, string> = {
  goal:       '⚽',
  own_goal:   '⚽',
  penalty:    '⚽',
  yellow_card:'🟨',
  red_card:   '🟥',
  yellow_red: '🟨🟥',
};
const EVENT_LABEL: Record<string, string> = {
  own_goal: 'en propia',
  penalty:  'p.',
};

function EventChip({ event, align }: { event: LiveEvent; align: 'left' | 'right' }) {
  const icon  = EVENT_ICON[event.type] ?? '•';
  const extra = EVENT_LABEL[event.type] ?? '';
  const isRight = align === 'right';
  return (
    <span className={`flex items-center gap-1 text-[10px] text-red-200/80 ${isRight ? 'flex-row-reverse' : ''}`}>
      <span className="text-[11px] leading-none">{icon}</span>
      <span className="font-semibold truncate max-w-[90px]">{event.playerName}</span>
      {extra && <span className="text-red-400/70">{extra}</span>}
      <span className="text-red-800/80 tabular-nums shrink-0">{event.minute}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// LiveMatchRow — single live match with a local minute ticker.
// The ticker increments the displayed minute every 60s so the counter
// appears to move even between API polls (which fire every 60s).
// Resets to the API value whenever fresh data arrives.
// ---------------------------------------------------------------------------
function LiveMatchRow({ m, teamMap }: { m: LiveMatch; teamMap: Map<string, Team> }) {
  const [displayMinute, setDisplayMinute] = useState<number | null>(m.minute);

  // Sync whenever the API returns a fresh minute value
  useEffect(() => {
    setDisplayMinute(m.minute);
  }, [m.minute]);

  // Local tick: advance one minute every 60s while the match is IN_PLAY
  useEffect(() => {
    if (m.status !== 'IN_PLAY' || m.minute === null) return;
    const id = setInterval(() => {
      setDisplayMinute(prev => (prev !== null ? Math.min(prev + 1, 95) : null));
    }, 60_000);
    return () => clearInterval(id);
  }, [m.fdId, m.status, m.minute]);

  const homeSlug = resolveLocalId(m.homeTeamFdName, m.homeLocalId, teamMap);
  const awaySlug = resolveLocalId(m.awayTeamFdName, m.awayLocalId, teamMap);
  const home = teamMap.get(homeSlug);
  const away = teamMap.get(awaySlug);
  const hasScore = m.homeGoals != null && m.awayGoals != null;
  const isExplicitlyLive = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const homeEvents = (m.events ?? []).filter(e => e.side === 'home');
  const awayEvents = (m.events ?? []).filter(e => e.side === 'away');
  const hasEvents  = homeEvents.length > 0 || awayEvents.length > 0;

  return (
    <div key={m.fdId}>
      {/* Score row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="text-sm font-bold text-white truncate text-right">
            {home?.name ?? m.homeTeamFdName}
          </span>
          <FlagImg id={homeSlug} className="w-7 h-5 object-cover rounded-[3px] shrink-0 shadow" />
        </div>
        <div className="flex flex-col items-center shrink-0 min-w-[68px]">
          {hasScore ? (
            <span className="text-2xl font-black text-white tabular-nums leading-none tracking-tight">
              {m.homeGoals}–{m.awayGoals}
            </span>
          ) : (
            <span className="text-lg font-black text-white/50 leading-none">vs</span>
          )}
          <span className="text-[10px] font-bold text-red-400 mt-0.5 tabular-nums">
            {m.status === 'PAUSED'
              ? '½ tiempo'
              : displayMinute
              ? `${displayMinute}'`
              : isExplicitlyLive
              ? '···'
              : 'iniciando'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FlagImg id={awaySlug} className="w-7 h-5 object-cover rounded-[3px] shrink-0 shadow" />
          <span className="text-sm font-bold text-white truncate">
            {away?.name ?? m.awayTeamFdName}
          </span>
        </div>
      </div>

      {/* Events row — goals and cards in two columns */}
      {hasEvents && (
        <div className="grid grid-cols-2 gap-x-2 px-4 pb-3 -mt-1">
          <div className="flex flex-col items-end gap-0.5">
            {homeEvents.map((e, i) => (
              <EventChip key={i} event={e} align="right" />
            ))}
          </div>
          <div className="flex flex-col items-start gap-0.5">
            {awayEvents.map((e, i) => (
              <EventChip key={i} event={e} align="left" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduledLiveRow — minimal row for matches detected via fixtures.json when
// ESPN hasn't flipped the status yet (or doesn't have data).
// ---------------------------------------------------------------------------
function ScheduledLiveRow({ fixture, teamMap }: { fixture: Fixture; teamMap: Map<string, Team> }) {
  const kickoff = fixture.kickoff_utc ? new Date(fixture.kickoff_utc).getTime() : 0;
  const [displayMinute, setDisplayMinute] = useState<number>(() =>
    kickoff ? Math.max(0, Math.min(95, Math.floor((Date.now() - kickoff) / 60_000))) : 0,
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (!kickoff) return;
      setDisplayMinute(Math.max(0, Math.min(95, Math.floor((Date.now() - kickoff) / 60_000))));
    }, 60_000);
    return () => clearInterval(id);
  }, [kickoff]);

  const home = teamMap.get(fixture.home_team_id);
  const away = teamMap.get(fixture.away_team_id);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <span className="text-sm font-bold text-white truncate text-right">
          {home?.name ?? fixture.home_team_id}
        </span>
        <FlagImg id={fixture.home_team_id} className="w-7 h-5 object-cover rounded-[3px] shrink-0 shadow" />
      </div>
      <div className="flex flex-col items-center shrink-0 min-w-[68px]">
        <span className="text-lg font-black text-white/50 leading-none">vs</span>
        <span className="text-[10px] font-bold text-red-400 mt-0.5 tabular-nums">
          {displayMinute > 0 ? `~${displayMinute}'` : 'iniciando'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <FlagImg id={fixture.away_team_id} className="w-7 h-5 object-cover rounded-[3px] shrink-0 shadow" />
        <span className="text-sm font-bold text-white truncate">
          {away?.name ?? fixture.away_team_id}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveNow — hero card for matches currently in play.
// Three-pronged detection:
//   1. ESPN says IN_PLAY or PAUSED                       → always shown
//   2. ESPN returns match within [-5, +95] min of m.utcDate → catches lag
//   3. fixtures.json kickoff within [-5, +95] min of now → catches ESPN gaps
// FINISHED / POSTPONED / CANCELLED always excluded.
// ---------------------------------------------------------------------------
function LiveNow({ liveByKey, teamMap, fixtures }: {
  liveByKey: Map<string, LiveMatch>;
  teamMap: Map<string, Team>;
  fixtures: Fixture[];
}) {
  const now = Date.now();

  // Prongs 1 & 2: ESPN-sourced matches
  const espnLive = [...liveByKey.values()].filter(m => {
    if (m.status === 'IN_PLAY' || m.status === 'PAUSED') return true;
    if (m.status === 'FINISHED' || m.status === 'POSTPONED' || m.status === 'CANCELLED') return false;
    const minsFromKickoff = (now - new Date(m.utcDate).getTime()) / 60_000;
    return minsFromKickoff >= -5 && minsFromKickoff <= 95;
  });

  // Build set of slug-pairs already covered by ESPN data
  const espnPairs = new Set(espnLive.map(m => {
    const h = resolveLocalId(m.homeTeamFdName, m.homeLocalId, teamMap);
    const a = resolveLocalId(m.awayTeamFdName, m.awayLocalId, teamMap);
    return `${h}:${a}`;
  }));

  // Prong 3: fixtures.json matches in window not already covered
  const localLive = fixtures.filter(f => {
    if (f.is_played) return false;
    if (!f.kickoff_utc) return false;
    const minsFromKickoff = (now - new Date(f.kickoff_utc).getTime()) / 60_000;
    if (minsFromKickoff < -5 || minsFromKickoff > 95) return false;
    return !espnPairs.has(`${f.home_team_id}:${f.away_team_id}`);
  });

  if (espnLive.length === 0 && localLive.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border border-red-800/40 shadow-lg shadow-red-950/30">
      <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-950 to-gray-900">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="text-[11px] font-black text-red-300 tracking-widest uppercase">En Vivo</span>
        <span className="ml-auto text-[10px] text-red-800 font-medium">Mundial 2026</span>
      </div>
      <div className="bg-gradient-to-br from-red-950/80 to-gray-950 divide-y divide-red-900/30">
        {espnLive.map(m => (
          <LiveMatchRow key={m.fdId} m={m} teamMap={teamMap} />
        ))}
        {localLive.map(f => (
          <ScheduledLiveRow key={f.id} fixture={f} teamMap={teamMap} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TodayFixtureItem — wraps each fixture in the "today" date section so that
// usePIEForFixture can be called as a hook (hooks can't live in .map callbacks)
// ---------------------------------------------------------------------------
interface TodayFixtureItemProps {
  fixture: Fixture;
  i: number;
  homeName: string;
  awayName: string;
  played: WcActualResult | undefined;
  pred: MatchPredictionResult | undefined;
  liveM: LiveMatch | null | undefined;
  expandedId: string | null;
  expandingId: string | null;
  expand: (f: Fixture) => void;
  hasEngine: boolean;
  ratings: Rating[];
  allFixtures: Fixture[];
  wcResults: WcActualResult[];
  fixtureRowProps: (f: Fixture) => FixtureRowProps;
}

function TodayFixtureItem({
  fixture, i, homeName, awayName, played, pred, liveM,
  expandedId, expandingId, expand, hasEngine, ratings, allFixtures, wcResults, fixtureRowProps,
}: TodayFixtureItemProps) {
  const rowIsLive = liveM?.status === 'IN_PLAY' || liveM?.status === 'PAUSED';
  const { result: pieResult } = usePIEForFixture({
    fixture,
    ratings,
    allFixtures,
    wcResults,
    enabled: !played,
  });

  return (
    <div className={`${i > 0 ? 'border-t border-white/10' : ''} ${rowIsLive ? 'border-l-2 border-l-red-500' : ''}`}>
      <button
        onClick={() => expand(fixture)}
        disabled={expandingId === fixture.id}
        className={`w-full flex flex-col px-5 py-3 hover:bg-white/10 active:bg-white/20 transition-all text-left ${expandingId === fixture.id ? 'opacity-70' : ''} ${rowIsLive ? 'bg-red-950/30' : ''}`}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-bold text-wc-gold/80 uppercase tracking-wide">
            Partido {i + 1}
          </span>
          {fixture.kickoff_utc && (
            <>
              <span className="text-white/30 text-[10px]">·</span>
              <span className="text-[10px] font-semibold text-white/60">
                {kickoffART(fixture.kickoff_utc)} ART
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 w-full">
          <FlagImg id={fixture.home_team_id} className="w-6 h-4 object-cover rounded-[2px] shrink-0" />
          <span className="font-bold text-white text-sm truncate flex-1">{homeName}</span>
          <span className="text-white/40 text-xs font-medium shrink-0">vs</span>
          <span className="font-bold text-white text-sm truncate flex-1 text-right">{awayName}</span>
          <FlagImg id={fixture.away_team_id} className="w-6 h-4 object-cover rounded-[2px] shrink-0" />
          <span className="ml-1 shrink-0">
            {played ? (
              <Badge color="green">{played.home_goals}–{played.away_goals}</Badge>
            ) : liveM?.status === 'IN_PLAY' || liveM?.status === 'PAUSED' ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-900/40 border border-red-500/40 px-1.5 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" />
                {liveM.homeGoals ?? 0}–{liveM.awayGoals ?? 0}
                {liveM.minute ? ` ${liveM.minute}'` : ''}
              </span>
            ) : liveM?.status === 'FINISHED' ? (
              <Badge color="green">{liveM.homeGoals ?? 0}–{liveM.awayGoals ?? 0}</Badge>
            ) : (
              <span className="text-xs font-semibold text-wc-gold bg-wc-navy/50 px-2 py-0.5 rounded-md">
                Grp {fixture.group_name}
              </span>
            )}
          </span>
          <span className="text-white/40 shrink-0">
            {expandingId === fixture.id
              ? <Loader2 className="w-4 h-4 animate-spin text-wc-gold" />
              : expandedId === fixture.id
                ? <ChevronUp className="w-4 h-4" />
                : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
        {/* Prediction strip — only for unplayed fixtures */}
        {!played && pred ? (() => {
          // Use the performance-weighted ensemble as probability source.
          // For score string, prefer a model with a scoreline (Patrón de Grupo → Momentum → ensemble).
          const probSrc = pred.bestPrediction;
          const scoreSrc = pred.predictions.find(p => p.predictorName === 'Patrón de Grupo' && !p.degraded && p.scoreline)
            ?? pred.predictions.find(p => p.predictorName === 'Momentum del Mundial' && !p.degraded && p.scoreline)
            ?? pred.bestPrediction;
          const { homeWin, draw, awayWin } = probSrc.outcome;
          const topPickResult = topPick(probSrc.outcome);
          const isMarginDraw = topPickResult === 'Draw' && draw < Math.max(homeWin, awayWin);
          let scoreStr: string | null = null;
          if (scoreSrc.scoreline) {
            const per = mostLikelyScorePerOutcome(scoreSrc.scoreline);
            const dom = topPickResult === 'Home' ? per.homeWin
                      : topPickResult === 'Away' ? per.awayWin : per.draw;
            if (dom) scoreStr = `${dom.home}-${dom.away}`;
          }
          const topPickProb = topPickResult === 'Home' ? homeWin
                           : topPickResult === 'Away' ? awayWin : draw;
          const label = topPickResult === 'Home'
            ? `L ${(homeWin*100).toFixed(0)}%`
            : topPickResult === 'Away'
            ? `V ${(awayWin*100).toFixed(0)}%`
            : isMarginDraw
            ? `~E ${(draw*100).toFixed(0)}%`
            : `E ${(draw*100).toFixed(0)}%`;

          // PIE consenso strip (mostLikelyScore del top-K weighted)
          let consScoreStr: string | null = null;
          let consPickLabel = '';
          let consProbPct = '';
          if (pieResult && !pieResult.degraded) {
            const pp = pieResult.pick_probabilities;
            const labelOf = (pk: 'Home' | 'Draw' | 'Away') => pk === 'Home' ? 'L' : pk === 'Away' ? 'V' : 'E';
            const probOf = (pk: 'Home' | 'Draw' | 'Away') => pk === 'Home' ? pp.home : pk === 'Away' ? pp.away : pp.draw;
            if (pieResult.mostLikelyScore)
              consScoreStr = `${pieResult.mostLikelyScore.home}-${pieResult.mostLikelyScore.away}`;
            consPickLabel = labelOf(pieResult.most_probable_pick);
            consProbPct = `${(probOf(pieResult.most_probable_pick) * 100).toFixed(0)}%`;
          }

          return (
            <div className="mt-2 space-y-1 w-full">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-px h-1.5 rounded-full overflow-hidden">
                  <div className="bg-blue-400/70 shrink-0" style={{ width: `${homeWin*100}%` }} />
                  <div className="bg-white/25 shrink-0"   style={{ width: `${draw*100}%` }} />
                  <div className="bg-red-400/70 shrink-0"  style={{ width: `${awayWin*100}%` }} />
                </div>
                {topPickProb >= 0.65 ? (
                  <span className="shrink-0 text-[10px] font-bold text-amber-300">
                    🔥 {scoreStr ? `${scoreStr} · ` : ''}{(topPickProb*100).toFixed(0)}%
                  </span>
                ) : isMarginDraw ? (
                  <span className="shrink-0 text-[10px] font-semibold text-amber-300/70 tabular-nums">
                    {scoreStr ? `${scoreStr} · ` : ''}{label}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-white/50 tabular-nums">
                    {scoreStr ? `${scoreStr} · ` : ''}{label}
                  </span>
                )}
              </div>
              {pieResult && !pieResult.degraded && (consScoreStr || consPickLabel) && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black text-red-400 tracking-wider">PIE</span>
                  <span className="text-[10px] font-bold text-white/80 tabular-nums">{consScoreStr ?? '—'}</span>
                  <span className="text-[9px] font-semibold text-white/50 tabular-nums">{consPickLabel} {consProbPct}</span>
                </div>
              )}
            </div>
          );
        })() : !played && hasEngine ? (
          <div className="mt-2 h-1.5 rounded-full bg-white/20 animate-pulse" />
        ) : null}
      </button>
      {expandedId === fixture.id && (
        <div className="bg-white">
          <FixtureRow {...fixtureRowProps(fixture)} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MatchesPage
// ---------------------------------------------------------------------------
export function MatchesPage() {
  const { groups, fixtures, teamMap, contextMap, engine, ratingsList, wcResults, wcPlayedMap, isLoading, error } = useAppData();
  const qc = useQueryClient();

  // Live scores from ESPN via Supabase Edge Function (60s polling)
  const { liveByKey } = useLiveScores();

  // Re-key liveByKey by our local team slugs instead of ESPN numeric IDs so
  // getLiveForFixture() can match fixtures by home_team_id / away_team_id.
  const resolvedLiveByKey = useMemo(() => {
    const resolved = new Map<string, LiveMatch>();
    for (const m of liveByKey.values()) {
      const homeId = resolveLocalId(m.homeTeamFdName, m.homeLocalId, teamMap);
      const awayId = resolveLocalId(m.awayTeamFdName, m.awayLocalId, teamMap);
      if (homeId && awayId) resolved.set(`${homeId}:${awayId}`, m);
    }
    return resolved;
  }, [liveByKey, teamMap]);

  // FIFA ranking map for group-stage tiebreaking (teamId → points; higher = better)
  const fifaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratingsList) {
      if (r.type === 'fifa') m.set(r.team_id, r.value);
    }
    return m;
  }, [ratingsList]);

  // Load evaluation history to power ML ensemble blending
  const { data: evalsData } = useQuery({ queryKey: ['evaluations'], queryFn: loadEvaluations, staleTime: 60_000 });

  // Goal scorers — refreshed once per minute (Edge Fn updates once daily, this just stays fresh)
  const { data: matchGoals } = useQuery<MatchGoal[]>({
    queryKey: ['match-goals'],
    queryFn:  loadAllMatchGoals,
    staleTime: 60_000,
  });
  const goalsByFixture = useMemo(() => {
    const map = new Map<string, MatchGoal[]>();
    for (const g of matchGoals ?? []) {
      const list = map.get(g.fixture_id) ?? [];
      list.push(g);
      map.set(g.fixture_id, list);
    }
    return map;
  }, [matchGoals]);
  const modelWeights  = useMemo(() => computeModelWeights(evalsData ?? []), [evalsData]);
  const plantelStats  = useMemo(() => modelStats(evalsData ?? [], 'Potencial del plantel'),  [evalsData]);
  const momentumStats = useMemo(() => modelStats(evalsData ?? [], 'Momentum del Mundial'), [evalsData]);
  const modelEvalStats = useMemo(() => {
    const map = new Map<string, ModelStats>();
    for (const e of (evalsData ?? [])) {
      if (!map.has(e.model_name)) map.set(e.model_name, modelStats(evalsData!, e.model_name));
    }
    return map;
  }, [evalsData]);
  const pieLooMetrics = useMemo(() => {
    const pieEvals = (evalsData ?? []).filter(e => e.model_name === 'PIE Consenso' || e.model_name === 'PIE');
    if (pieEvals.length === 0) return null;
    const winner = { correct: pieEvals.filter(e => e.top_pick_correct).length, total: pieEvals.length };
    const withExact = pieEvals.filter(e => e.exact_score_correct != null);
    const exact = withExact.length > 0
      ? { correct: withExact.filter(e => e.exact_score_correct).length, total: withExact.length }
      : null;
    return { winner, exact };
  }, [evalsData]);

  // Best model by absolute count of correct winner picks (min 5 evals)
  const bestWinnerModelName = useMemo(() => {
    if (!evalsData || evalsData.length === 0) return null;
    const byModel = new Map<string, { wins: number; n: number }>();
    for (const e of evalsData) {
      const acc = byModel.get(e.model_name) ?? { wins: 0, n: 0 };
      acc.n++;
      if (e.top_pick_correct) acc.wins++;
      byModel.set(e.model_name, acc);
    }
    let best: string | null = null, bestCount = -1;
    for (const [name, { wins, n }] of byModel) {
      if (n < 5) continue;
      if (wins > bestCount) { bestCount = wins; best = name; }
    }
    return best;
  }, [evalsData]);
  const bestWinnerModelStats = useMemo(
    () => bestWinnerModelName ? modelStats(evalsData ?? [], bestWinnerModelName) : null,
    [bestWinnerModelName, evalsData],
  );

  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [expandingId, setExpandingId]   = useState<string | null>(null);
  const [predictions, setPredictions]   = useState<Map<string, MatchPredictionResult>>(new Map());
  const [saving, setSaving]             = useState<string | null>(null);
  const [savedSnap, setSavedSnap]       = useState<Set<string>>(new Set());
  const [resultHome, setResultHome]     = useState('');
  const [resultAway, setResultAway]     = useState('');
  const [evalDone, setEvalDone]         = useState<Set<string>>(new Set());
  const [err, setErr]                   = useState('');

  // Holds a fixture that was tapped while the engine was still loading,
  // so we can run the prediction as soon as the engine becomes ready.
  const pendingFixtureRef = useRef<Fixture | null>(null);

  // Filter state
  const [search, setSearch]             = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [openGroups, setOpenGroups]     = useState<Set<string>>(new Set());

  const playedMap = wcPlayedMap;

  // Knockout rounds
  const KO_ROUNDS = ['R32', 'R16', 'QF', 'SF', 'FINAL'] as const;
  type KORound = typeof KO_ROUNDS[number];
  const KO_LABEL: Record<KORound, string> = { R32: '16avos', R16: 'Octavos', QF: 'Cuartos', SF: 'Semis', FINAL: 'Final' };
  const isKoRound = (r: string | null): r is KORound => KO_ROUNDS.includes(r as KORound);
  const knockoutFixtures = useMemo(() => fixtures.filter(f => f.id.startsWith('ko:')), [fixtures]);
  const hasKnockout = knockoutFixtures.length > 0;

  // Track which groups have completed all 6 group-stage matches (MD3 done)
  const groupCompletedMD3 = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const g of groups) {
      const gf = fixtures.filter(f => f.group_name === g.name && !f.id.startsWith('ko:'));
      map.set(g.name, gf.length > 0 && gf.every(f => f.is_played || playedMap.has(f.id)));
    }
    return map;
  }, [groups, fixtures, playedMap]);

  // Live slot map: maps "1A", "2B", etc. → current team_id from live standings.
  // Updates reactively as results are entered — even before a group is fully done.
  const liveSlotMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      const gf = fixtures.filter(f => f.group_name === g.name && !f.id.startsWith('ko:'));
      const anyPlayed = gf.some(f => f.is_played || playedMap.has(f.id));
      if (!anyPlayed) continue;
      const standings = computeGroupStandingsDisplay(g.team_ids, gf, playedMap, fifaMap);
      standings.forEach((row, i) => {
        map.set(`${i + 1}${g.name}`, row.id);
      });
    }
    return map;
  }, [groups, fixtures, playedMap, fifaMap]);

  // Returns the display name for a knockout slot label.
  // Uses live standings so names update as results are entered.
  // - "W(…)": returns slot label until that match resolves
  // - "T3": returns "T3" until bracket activation
  // - "1A", "2B" etc: returns current standing team name (provisional before MD3, confirmed after)
  const resolveKoName = useCallback((slot: string | null | undefined, fallback: string): string => {
    if (!slot) return fallback;
    if (slot.startsWith('W(')) return slot;
    if (slot === 'T3') return 'T3';
    const liveTeamId = liveSlotMap.get(slot);
    if (liveTeamId) return teamMap.get(liveTeamId)?.name ?? liveTeamId;
    return slot;
  }, [liveSlotMap, teamMap]);

  // Returns the live team_id for a slot (for flag display); null if not yet determined.
  const resolveKoTeamId = useCallback((slot: string | null | undefined): string | null => {
    if (!slot || slot.startsWith('W(') || slot === 'T3') return null;
    return liveSlotMap.get(slot) ?? null;
  }, [liveSlotMap]);

  const dailySignal = useMemo(
    () => detectDailyPattern(wcResults ?? [], fixtures, TODAY),
    [wcResults, fixtures],
  );

  // Sorted unique dates that have fixtures (in ART timezone)
  const fixtureDates = useMemo(() =>
    [...new Set(fixtures.map(f => fixtureDate(f)).filter((d): d is string => d !== null))].sort(),
    [fixtures]
  );
  const dateIdx = fixtureDates.indexOf(selectedDate);
  const prevDate = dateIdx > 0 ? fixtureDates[dateIdx - 1] : null;
  const nextDate = dateIdx < fixtureDates.length - 1 ? fixtureDates[dateIdx + 1] : null;

  // When engine finishes loading, complete any prediction that was queued while it was null.
  useEffect(() => {
    if (!engine) return;
    const fixture = pendingFixtureRef.current;
    if (!fixture) return;
    pendingFixtureRef.current = null;
    const ctx = engine.buildContext(fixture, teamMap, ratingsList, contextMap, wcResults ?? [], fixtures);
    const result = engine.predict(ctx, modelWeights.size >= 2 ? modelWeights : undefined);
    setPredictions(prev => new Map(prev).set(fixture.id, result));
    setExpandingId(null);
  }, [engine, teamMap, ratingsList, contextMap, wcResults, fixtures, modelWeights]);

  // Pre-compute predictions for the selected day so the prediction strip in
  // each fixture row renders immediately without waiting for the user to expand.
  useEffect(() => {
    if (!engine || todayFixtures.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const f of todayFixtures) {
        if (cancelled) break;
        await new Promise(r => setTimeout(r, 0));
        if (cancelled) break;
        const ctx = engine.buildContext(f, teamMap, ratingsList, contextMap, wcResults ?? [], fixtures);
        const result = engine.predict(ctx, modelWeights.size >= 2 ? modelWeights : undefined);
        setPredictions(prev => prev.has(f.id) ? prev : new Map(prev).set(f.id, result));
      }
    })();
    return () => { cancelled = true; };
  // Re-run only when the engine becomes ready, the day changes, or weights update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, selectedDate, modelWeights]);

  // Auto-save results when the live API reports a match as FINISHED and we have
  // a prediction for it. Fires on every 60s live-score poll that brings a FINISHED
  // status for a fixture not yet in playedMap/evalDone.
  const autoSavedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!engine) return;
    for (const [key, m] of resolvedLiveByKey) {
      if (m.status !== 'FINISHED' || m.homeGoals == null || m.awayGoals == null) continue;
      const [homeId, awayId] = key.split(':');
      const fixture = fixtures.find(f => f.home_team_id === homeId && f.away_team_id === awayId);
      if (!fixture) continue;
      if (playedMap.has(fixture.id)) continue;
      if (evalDone.has(fixture.id)) continue;
      if (autoSavedRef.current.has(fixture.id)) continue;
      const pred = predictions.get(fixture.id);
      if (!pred) continue;

      autoSavedRef.current.add(fixture.id);
      const hg = m.homeGoals;
      const ag = m.awayGoals;
      (async () => {
        try {
          await saveWcActualResult({ fixture_id: fixture.id, home_goals: hg, away_goals: ag });
          await deleteEvaluationsForFixtures([fixture.id]);
          await saveEvaluations(buildEvaluationRows(pred.predictions, fixture, hg, ag));
          setEvalDone(prev => new Set(prev).add(fixture.id));
          qc.invalidateQueries({ queryKey: ['wc-results'] });
          qc.invalidateQueries({ queryKey: ['evaluations'] });
        } catch {
          // Allow retry on next poll by removing from the in-progress set
          autoSavedRef.current.delete(fixture.id);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLiveByKey, predictions, engine]);

  const expand = useCallback(async (fixture: Fixture) => {
    const isSame = expandedId === fixture.id;
    setExpandedId(isSame ? null : fixture.id);
    setResultHome('');
    setResultAway('');
    setErr('');
    if (isSame || predictions.has(fixture.id)) return;
    setExpandingId(fixture.id);
    if (!engine) {
      // Engine is still warming up — queue the fixture; the useEffect above
      // will run the prediction the moment the engine becomes available.
      pendingFixtureRef.current = fixture;
      return;
    }
    // Yield to browser so the expanded row renders before the heavy compute
    await new Promise(r => setTimeout(r, 0));
    const ctx = engine.buildContext(fixture, teamMap, ratingsList, contextMap, wcResults ?? [], fixtures);
    const result = engine.predict(ctx, modelWeights.size >= 2 ? modelWeights : undefined);
    setPredictions(prev => new Map(prev).set(fixture.id, result));
    setExpandingId(null);
  }, [expandedId, predictions, engine, teamMap, ratingsList, contextMap, wcResults, fixtures, modelWeights]);

  const handleContextSaved = useCallback(async (fixture: Fixture, ctx: FixtureContext) => {
    // Persist to Supabase
    await upsertFixtureContext(ctx);
    // Optimistically re-predict with the new context so L5 can kick in immediately
    if (engine) {
      setPredictions(prev => { const n = new Map(prev); n.delete(fixture.id); return n; });
      setExpandingId(fixture.id);
      await new Promise(r => setTimeout(r, 0));
      const tempCtxMap = new Map(contextMap).set(fixture.id, ctx);
      const c = engine.buildContext(fixture, teamMap, ratingsList, tempCtxMap, wcResults ?? [], fixtures);
      const result = engine.predict(c, modelWeights.size >= 2 ? modelWeights : undefined);
      setPredictions(prev => new Map(prev).set(fixture.id, result));
      setExpandingId(null);
    }
    // Refresh the persisted context map in the background
    qc.invalidateQueries({ queryKey: ['contexts'] });
  }, [engine, contextMap, teamMap, ratingsList, qc, wcResults, fixtures, modelWeights]);

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

  const recordLiveResult = async (fixture: Fixture, hg: number, ag: number) => {
    const pred = predictions.get(fixture.id);
    if (!pred) { setErr('Primero predecí el partido.'); return; }
    setErr('');
    setSaving(fixture.id);
    try {
      await saveWcActualResult({ fixture_id: fixture.id, home_goals: hg, away_goals: ag });
      await deleteEvaluationsForFixtures([fixture.id]);
      await saveEvaluations(buildEvaluationRows(pred.predictions, fixture, hg, ag));
      setEvalDone(prev => new Set(prev).add(fixture.id));
      setResultHome(String(hg));
      setResultAway(String(ag));
      qc.invalidateQueries({ queryKey: ['wc-results'] });
      qc.invalidateQueries({ queryKey: ['evaluations'] });
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
      // Save evaluations for ALL non-degraded ladder models so PerformancePage
      // can compare L2–L6 and the ensemble can learn from each model's track record.
      // Clear any prior rows for this fixture first so re-recording stays idempotent.
      await deleteEvaluationsForFixtures([fixture.id]);
      await saveEvaluations(buildEvaluationRows(pred.predictions, fixture, hg, ag));
      setEvalDone(prev => new Set(prev).add(fixture.id));
      qc.invalidateQueries({ queryKey: ['wc-results'] });
      qc.invalidateQueries({ queryKey: ['evaluations'] });
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
    onContextSaved: (ctx: FixtureContext) => handleContextSaved(fixture, ctx),
    onRecordLiveResult: (hg: number, ag: number) => recordLiveResult(fixture, hg, ag),
    homeName: resolveKoName(fixture.home_slot, teamMap.get(fixture.home_team_id)?.name ?? fixture.home_team_id),
    awayName: resolveKoName(fixture.away_slot, teamMap.get(fixture.away_team_id)?.name ?? fixture.away_team_id),
    context: contextMap.get(fixture.id) ?? null,
    compact,
    bestModelName: bestWinnerModelName,
    bestModelWinnerAcc: bestWinnerModelStats?.winnerAcc ?? null,
    modelWeights,
    modelEvalStats,
    liveMatch: getLiveForFixture(resolvedLiveByKey, fixture.home_team_id, fixture.away_team_id),
    goals: goalsByFixture.get(fixture.id),
    ratings: ratingsList,
    allFixtures: fixtures,
    wcResultsForPIE: wcResults ?? [],
    pieLooWinner: pieLooMetrics?.winner ?? null,
    pieLooExact: pieLooMetrics?.exact ?? null,
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
      {/* KNOCKOUT ACTIVATION                                                  */}
      {/* ------------------------------------------------------------------ */}
      <KnockoutActivationButton
        fixtures={fixtures}
        wcPlayedMap={wcPlayedMap}
        teamMap={teamMap}
      />

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
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 active:scale-90 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* EN VIVO — ESPN; solo aparece cuando hay partidos en curso           */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && (
        <LiveNow liveByKey={liveByKey} teamMap={teamMap} fixtures={fixtures} />
      )}

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
            <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-white/10">
              <div className="flex items-center gap-1.5 text-white">
                <Calendar className="w-3.5 h-3.5 text-wc-gold/60" />
                <span className="font-medium text-xs text-white/70">
                  {selectedDate === TODAY ? 'Hoy · ' : ''}{formatDateLabel(selectedDate)}
                </span>
                {selectedDate === TODAY && (
                  <span className="w-1.5 h-1.5 rounded-full bg-wc-gold shrink-0 animate-pulse" />
                )}
                {selectedDate === TODAY && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-red-300 bg-red-900/30 border border-red-500/30 px-1 py-px rounded ml-1">
                    <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {plantelStats.n > 0 && (
                  <Tooltip text={`L4.5 Plantel — acierto de ganador en ${plantelStats.n} partidos`}>
                    <span className="text-[9px] font-medium text-white/40 shrink-0 cursor-default">
                      L4.5 {(plantelStats.winnerAcc * 100).toFixed(0)}%
                    </span>
                  </Tooltip>
                )}
                {momentumStats.n > 0 && (
                  <Tooltip text={`L6 Momentum — acierto de resultado exacto en ${momentumStats.n} partidos`}>
                    <span className="text-[9px] font-medium text-white/40 shrink-0 cursor-default">
                      L6 {(momentumStats.exactAcc * 100).toFixed(0)}%
                    </span>
                  </Tooltip>
                )}
                <button
                  onClick={() => prevDate && setSelectedDate(prevDate)}
                  disabled={!prevDate}
                  className="p-1 rounded text-white/50 hover:text-white/80 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setSelectedDate(TODAY)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all active:scale-95 ${selectedDate === TODAY ? 'bg-white/15 text-white/90 border border-white/20' : 'text-white/40 hover:text-white/70'}`}
                >
                  Hoy
                </button>
                <button
                  onClick={() => nextDate && setSelectedDate(nextDate)}
                  disabled={!nextDate}
                  className="p-1 rounded text-white/50 hover:text-white/80 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {todayFixtures.length === 0 ? (
              <div className="px-5 pb-4 text-white/50 text-sm">
                No hay partidos este día
              </div>
            ) : (
              <div className="bg-white/5">
                {todayFixtures.map((f, i) => (
                  <TodayFixtureItem
                    key={f.id}
                    fixture={f}
                    i={i}
                    homeName={teamMap.get(f.home_team_id)?.name ?? f.home_team_id}
                    awayName={teamMap.get(f.away_team_id)?.name ?? f.away_team_id}
                    played={playedMap.get(f.id)}
                    pred={predictions.get(f.id)}
                    liveM={getLiveForFixture(resolvedLiveByKey, f.home_team_id, f.away_team_id)}
                    expandedId={expandedId}
                    expandingId={expandingId}
                    expand={expand}
                    hasEngine={!!engine}
                    ratings={ratingsList}
                    allFixtures={fixtures}
                    wcResults={wcResults ?? []}
                    fixtureRowProps={fixtureRowProps}
                  />
                ))}
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
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 active:brightness-90 ${!selectedGroup ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'}`}
          >
            Todos
          </button>
          {groups.map(g => (
            <button
              key={g.name}
              onClick={() => setSelectedGroup(selectedGroup === g.name ? null : g.name)}
              className={`shrink-0 w-9 h-8 rounded-lg text-xs font-bold transition-all active:scale-95 active:brightness-90 ${selectedGroup === g.name ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'}`}
            >
              {g.name}
            </button>
          ))}
          {hasKnockout && (
            <>
              <span className="border-l border-gray-200 h-5 mx-0.5 self-center shrink-0" />
              {KO_ROUNDS.map(round => {
                const count = knockoutFixtures.filter(f => f.group_name === round).length;
                if (count === 0) return null;
                return (
                  <button
                    key={round}
                    onClick={() => setSelectedGroup(selectedGroup === round ? null : round)}
                    className={`shrink-0 px-2.5 h-8 rounded-lg text-xs font-bold transition-all active:scale-95 active:brightness-90 ${selectedGroup === round ? 'bg-wc-gold text-wc-navy' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 active:bg-amber-200'}`}
                  >
                    {KO_LABEL[round]}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* GRUPOS / ELIMINATORIAS: detalle o accordion                         */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && (
        isKoRound(selectedGroup) ? (() => {
          const roundFixtures = knockoutFixtures
            .filter(f => f.group_name === selectedGroup)
            .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''));
          const playedCount = roundFixtures.filter(f => playedMap.has(f.id)).length;
          return (
            <Card key={selectedGroup}>
              <CardHeader className="bg-wc-navy/5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                    {KO_LABEL[selectedGroup]} · {roundFixtures.length} partidos
                  </span>
                  <span className="text-[10px] text-gray-400">{playedCount}/{roundFixtures.length} jugados</span>
                </div>
              </CardHeader>
              <div className="divide-y divide-gray-100">
                {roundFixtures.map(f => (
                  <FixtureRow key={f.id} {...fixtureRowProps(f)} />
                ))}
              </div>
            </Card>
          );
        })() : selectedGroup ? (() => {
          const group = groups.find(g => g.name === selectedGroup);
          if (!group) return null;
          const groupFixtures = fixtures
            .filter(f => f.group_name === selectedGroup)
            .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''));
          const standings = computeGroupStandingsDisplay(group.team_ids, groupFixtures, playedMap, fifaMap);
          const played = groupFixtures.filter(f => playedMap.has(f.id)).length;
          return (
            <Card key={selectedGroup}>
              {/* — Clasificación — */}
              <CardHeader className="bg-wc-navy/5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Clasificación · Grupo {selectedGroup}</span>
                  <span className="text-[10px] text-gray-400">{played}/{groupFixtures.length} partidos</span>
                </div>
              </CardHeader>
              <div className="px-4 py-1">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                      <th className="text-left py-2 font-semibold w-5"></th>
                      <th className="text-left py-2 font-semibold">Equipo</th>
                      <th className="text-center py-2 font-semibold w-7">PJ</th>
                      <th className="text-center py-2 font-semibold w-7">G</th>
                      <th className="text-center py-2 font-semibold w-7">E</th>
                      <th className="text-center py-2 font-semibold w-7">P</th>
                      <th className="text-center py-2 font-semibold w-10">GD</th>
                      <th className="text-center py-2 font-semibold w-8 text-wc-navy">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, i) => (
                      <tr key={row.id} className={`border-t border-gray-50 ${i < 2 ? 'bg-green-50/40' : ''}`}>
                        <td className="py-2.5 text-[11px] text-gray-400 font-medium">{i + 1}</td>
                        <td className="py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <FlagImg id={row.id} className="w-5 h-3.5 object-cover rounded-[2px] shrink-0" />
                            <span className={`text-sm ${i < 2 ? 'font-bold text-gray-800' : 'font-medium text-gray-500'}`}>
                              {teamMap.get(row.id)?.name ?? row.id}
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 text-center text-xs text-gray-500">{row.pj}</td>
                        <td className="py-2.5 text-center text-xs text-gray-500">{row.w}</td>
                        <td className="py-2.5 text-center text-xs text-gray-500">{row.d}</td>
                        <td className="py-2.5 text-center text-xs text-gray-500">{row.l}</td>
                        <td className="py-2.5 text-center text-xs text-gray-500">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                        <td className="py-2.5 text-center text-sm font-black text-wc-navy">{row.pts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* — Partidos — */}
              <div className="border-t border-gray-100">
                <div className="px-4 pt-3 pb-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Partidos</span>
                </div>
                <div className="divide-y divide-gray-50 pb-1">
                  {groupFixtures.map(f => {
                    const result = playedMap.get(f.id);
                    const homeName = teamMap.get(f.home_team_id)?.name ?? f.home_team_id;
                    const awayName = teamMap.get(f.away_team_id)?.name ?? f.away_team_id;
                    const liveG = getLiveForFixture(resolvedLiveByKey, f.home_team_id, f.away_team_id);
                    const isLive = liveG?.status === 'IN_PLAY' || liveG?.status === 'PAUSED';
                    const isFinishedLive = !result && liveG?.status === 'FINISHED';
                    return (
                      <div key={f.id} className="px-4 py-2.5 flex items-center gap-2">
                        {result ? (
                          <>
                            <span className="text-green-500 text-[10px] font-bold shrink-0">✓</span>
                            <FlagImg id={f.home_team_id} />
                            <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{homeName}</span>
                            <span className="text-sm font-black text-wc-navy shrink-0 tabular-nums">{result.home_goals}–{result.away_goals}</span>
                            <span className="flex-1 text-xs font-semibold text-gray-700 truncate text-right">{awayName}</span>
                            <FlagImg id={f.away_team_id} />
                            {f.kickoff_utc && <span className="text-[10px] text-gray-400 shrink-0 ml-1">{kickoffShortDate(f.kickoff_utc)}</span>}
                          </>
                        ) : isLive ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                            <FlagImg id={f.home_team_id} />
                            <span className="flex-1 text-xs font-semibold text-gray-800 truncate">{homeName}</span>
                            <span className="text-sm font-black text-red-600 shrink-0 tabular-nums">
                              {liveG.homeGoals ?? 0}–{liveG.awayGoals ?? 0}
                              {liveG.minute ? <span className="text-[10px] font-normal text-red-400 ml-0.5">{liveG.minute}'</span> : null}
                            </span>
                            <span className="flex-1 text-xs font-semibold text-gray-800 truncate text-right">{awayName}</span>
                            <FlagImg id={f.away_team_id} />
                          </>
                        ) : isFinishedLive ? (
                          <>
                            <span className="text-green-500 text-[10px] font-bold shrink-0">✓</span>
                            <FlagImg id={f.home_team_id} />
                            <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{homeName}</span>
                            <span className="text-sm font-black text-wc-navy shrink-0 tabular-nums">{liveG.homeGoals ?? 0}–{liveG.awayGoals ?? 0}</span>
                            <span className="flex-1 text-xs font-semibold text-gray-700 truncate text-right">{awayName}</span>
                            <FlagImg id={f.away_team_id} />
                          </>
                        ) : (
                          <>
                            <span className="text-gray-300 text-[10px] shrink-0">○</span>
                            <FlagImg id={f.home_team_id} />
                            <span className="flex-1 text-xs font-medium text-gray-500 truncate">{homeName}</span>
                            <span className="text-[11px] text-gray-400 shrink-0 font-medium tabular-nums">
                              {f.kickoff_utc ? kickoffART(f.kickoff_utc) : 'vs'}
                            </span>
                            <span className="flex-1 text-xs font-medium text-gray-500 truncate text-right">{awayName}</span>
                            <FlagImg id={f.away_team_id} />
                            {f.kickoff_utc && <span className="text-[10px] text-gray-400 shrink-0 ml-1">{kickoffShortDate(f.kickoff_utc)}</span>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })() : (
          /* Todos: collapsible accordion by group */
          <div className="space-y-2">
            {groups.map(group => {
              const key = group.name;
              const isOpen = openGroups.has(key);
              const groupFixtures = fixtures
                .filter(f => f.group_name === key)
                .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''));
              const standings = computeGroupStandingsDisplay(group.team_ids, groupFixtures, playedMap, fifaMap);
              const playedCount = groupFixtures.filter(f => playedMap.has(f.id)).length;
              return (
                <Card key={key}>
                  {/* Group header — always visible, clickable to toggle */}
                  <button
                    onClick={() => setOpenGroups(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black text-wc-navy">Grupo {key}</span>
                      <div className="flex items-center gap-1.5">
                        {standings.slice(0, 4).map((row, i) => (
                          <FlagImg key={row.id} id={row.id} className={`w-5 h-3.5 object-cover rounded-[2px] shrink-0 ${i >= 2 ? 'opacity-40' : ''}`} />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-gray-400 font-medium">{playedCount}/{groupFixtures.length}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Match list — only visible when open */}
                  {isOpen && (
                    <div className="border-t border-gray-100">
                      <div className="divide-y divide-gray-50">
                        {groupFixtures.map(f => {
                          const result = playedMap.get(f.id);
                          const fHomeName = teamMap.get(f.home_team_id)?.name ?? f.home_team_id;
                          const fAwayName = teamMap.get(f.away_team_id)?.name ?? f.away_team_id;
                          const liveG = getLiveForFixture(resolvedLiveByKey, f.home_team_id, f.away_team_id);
                          const isLive = liveG?.status === 'IN_PLAY' || liveG?.status === 'PAUSED';
                          const isFinishedLive = !result && liveG?.status === 'FINISHED';
                          return (
                            <div key={f.id} className="px-4 py-2.5 flex items-center gap-2">
                              {result ? (
                                <>
                                  <span className="text-green-500 text-[10px] font-bold shrink-0">✓</span>
                                  <FlagImg id={f.home_team_id} />
                                  <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{fHomeName}</span>
                                  <span className="text-sm font-black text-wc-navy shrink-0 tabular-nums">{result.home_goals}–{result.away_goals}</span>
                                  <span className="flex-1 text-xs font-semibold text-gray-700 truncate text-right">{fAwayName}</span>
                                  <FlagImg id={f.away_team_id} />
                                  {f.kickoff_utc && <span className="text-[10px] text-gray-400 shrink-0 ml-1">{kickoffShortDate(f.kickoff_utc)}</span>}
                                </>
                              ) : isLive ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                                  <FlagImg id={f.home_team_id} />
                                  <span className="flex-1 text-xs font-semibold text-gray-800 truncate">{fHomeName}</span>
                                  <span className="text-sm font-black text-red-600 shrink-0 tabular-nums">
                                    {liveG.homeGoals ?? 0}–{liveG.awayGoals ?? 0}
                                    {liveG.minute ? <span className="text-[10px] font-normal text-red-400 ml-0.5">{liveG.minute}'</span> : null}
                                  </span>
                                  <span className="flex-1 text-xs font-semibold text-gray-800 truncate text-right">{fAwayName}</span>
                                  <FlagImg id={f.away_team_id} />
                                </>
                              ) : isFinishedLive ? (
                                <>
                                  <span className="text-green-500 text-[10px] font-bold shrink-0">✓</span>
                                  <FlagImg id={f.home_team_id} />
                                  <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{fHomeName}</span>
                                  <span className="text-sm font-black text-wc-navy shrink-0 tabular-nums">{liveG.homeGoals ?? 0}–{liveG.awayGoals ?? 0}</span>
                                  <span className="flex-1 text-xs font-semibold text-gray-700 truncate text-right">{fAwayName}</span>
                                  <FlagImg id={f.away_team_id} />
                                </>
                              ) : (
                                <>
                                  <span className="text-gray-300 text-[10px] shrink-0">○</span>
                                  <FlagImg id={f.home_team_id} />
                                  <span className="flex-1 text-xs font-medium text-gray-500 truncate">{fHomeName}</span>
                                  <span className="text-[11px] text-gray-400 shrink-0 font-medium tabular-nums">
                                    {f.kickoff_utc ? kickoffART(f.kickoff_utc) : 'vs'}
                                  </span>
                                  <span className="flex-1 text-xs font-medium text-gray-500 truncate text-right">{fAwayName}</span>
                                  <FlagImg id={f.away_team_id} />
                                  {f.kickoff_utc && <span className="text-[10px] text-gray-400 shrink-0 ml-1">{kickoffShortDate(f.kickoff_utc)}</span>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {/* Eliminatorias accordion — aparece debajo de los grupos cuando hay fixtures ko */}
            {hasKnockout && (
              <div className="space-y-2 pt-1">
                <div className="px-1 pt-2 pb-0.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fase Eliminatoria</span>
                </div>
                {KO_ROUNDS.map(round => {
                  const roundFixtures = knockoutFixtures
                    .filter(f => f.group_name === round)
                    .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''));
                  if (roundFixtures.length === 0) return null;
                  const isOpen = openGroups.has(round);
                  const playedCount = roundFixtures.filter(f => playedMap.has(f.id)).length;
                  return (
                    <Card key={round}>
                      <button
                        onClick={() => setOpenGroups(prev => { const next = new Set(prev); next.has(round) ? next.delete(round) : next.add(round); return next; })}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left rounded-xl"
                      >
                        <span className="text-sm font-black text-wc-navy">{KO_LABEL[round]}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-gray-400 font-medium">{playedCount}/{roundFixtures.length}</span>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="border-t border-gray-100 divide-y divide-gray-50">
                          {roundFixtures.map(f => {
                            const result = playedMap.get(f.id);
                            const fHome = resolveKoName(f.home_slot, teamMap.get(f.home_team_id)?.name ?? f.home_team_id);
                            const fAway = resolveKoName(f.away_slot, teamMap.get(f.away_team_id)?.name ?? f.away_team_id);
                            // confirmed = group fully done; provisional = group has some results
                            const homeGroupLetter = f.home_slot && !f.home_slot.startsWith('W(') && f.home_slot !== 'T3' ? f.home_slot[1] : null;
                            const awayGroupLetter = f.away_slot && !f.away_slot.startsWith('W(') && f.away_slot !== 'T3' ? f.away_slot[1] : null;
                            const homeConfirmed = homeGroupLetter ? (groupCompletedMD3.get(homeGroupLetter) ?? false) : !!f.home_team_id;
                            const awayConfirmed = awayGroupLetter ? (groupCompletedMD3.get(awayGroupLetter) ?? false) : !!f.away_team_id;
                            const homeLiveId = resolveKoTeamId(f.home_slot);
                            const awayLiveId = resolveKoTeamId(f.away_slot);
                            const homeHasTeam = homeConfirmed || !!homeLiveId;
                            const awayHasTeam = awayConfirmed || !!awayLiveId;
                            const homeFlagId = homeLiveId ?? f.home_team_id;
                            const awayFlagId = awayLiveId ?? f.away_team_id;
                            const liveG = getLiveForFixture(resolvedLiveByKey, homeFlagId, awayFlagId);
                            const isLive = liveG?.status === 'IN_PLAY' || liveG?.status === 'PAUSED';
                            return (
                              <div key={f.id} className="px-4 py-2.5 flex items-center gap-2">
                                {result ? (
                                  <>
                                    <span className="text-green-500 text-[10px] font-bold shrink-0">✓</span>
                                    {homeHasTeam && <FlagImg id={homeFlagId} />}
                                    <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{fHome}</span>
                                    <span className="text-sm font-black text-wc-navy shrink-0 tabular-nums">{result.home_goals}–{result.away_goals}</span>
                                    <span className="flex-1 text-xs font-semibold text-gray-700 truncate text-right">{fAway}</span>
                                    {awayHasTeam && <FlagImg id={awayFlagId} />}
                                    {f.kickoff_utc && <span className="text-[10px] text-gray-400 shrink-0 ml-1">{kickoffShortDate(f.kickoff_utc)}</span>}
                                  </>
                                ) : isLive ? (
                                  <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                                    {homeHasTeam && <FlagImg id={homeFlagId} />}
                                    <span className="flex-1 text-xs font-semibold text-gray-800 truncate">{fHome}</span>
                                    <span className="text-sm font-black text-red-600 shrink-0 tabular-nums">
                                      {liveG!.homeGoals ?? 0}–{liveG!.awayGoals ?? 0}
                                      {liveG!.minute ? <span className="text-[10px] font-normal text-red-400 ml-0.5">{liveG!.minute}'</span> : null}
                                    </span>
                                    <span className="flex-1 text-xs font-semibold text-gray-800 truncate text-right">{fAway}</span>
                                    {awayHasTeam && <FlagImg id={awayFlagId} />}
                                  </>
                                ) : (
                                  <>
                                    <span className="text-gray-300 text-[10px] shrink-0">○</span>
                                    {homeHasTeam && <FlagImg id={homeFlagId} />}
                                    <span className={`flex-1 text-xs truncate ${homeConfirmed ? 'font-medium text-gray-500' : homeHasTeam ? 'font-medium text-amber-600 italic' : 'font-bold text-gray-400 italic'}`}>{fHome}</span>
                                    <div className="flex flex-col items-center shrink-0">
                                      <span className="text-[11px] text-gray-400 font-medium tabular-nums leading-tight">
                                        {f.kickoff_utc ? kickoffART(f.kickoff_utc) : 'vs'}
                                      </span>
                                      {f.kickoff_utc && (
                                        <span className="text-[9px] text-gray-300 leading-tight">{kickoffShortDate(f.kickoff_utc)}</span>
                                      )}
                                    </div>
                                    <span className={`flex-1 text-xs truncate text-right ${awayConfirmed ? 'font-medium text-gray-500' : awayHasTeam ? 'font-medium text-amber-600 italic' : 'font-bold text-gray-400 italic'}`}>{fAway}</span>
                                    {awayHasTeam && <FlagImg id={awayFlagId} />}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MARCADORES MÁS REPETIDOS                                            */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && wcResults && (
        <TopScorelines wcResults={wcResults} />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* GOLEADORES                                                           */}
      {/* ------------------------------------------------------------------ */}
      {!isSearching && matchGoals && matchGoals.length > 0 && (
        <TopScorers goals={matchGoals} teamMap={teamMap} />
      )}

    </div>
  );
}
