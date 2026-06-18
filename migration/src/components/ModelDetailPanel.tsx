// =============================================================================
// Oloráculo — ModelDetailPanel
// Inline panel shown below the prediction card grid when the user selects a model.
// Not a modal — it appears/disappears in-flow with animate-fade-in.
// =============================================================================

import { Badge, ProbBar, ScoreTriple } from './ui';
import { MODEL_TIERS } from '../engine/model-tiers';
import { mostLikelyScorePerOutcome } from '../engine/probability-helper';
import type { MatchPrediction } from '../types/domain';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ModelDetailPanelProps {
  model: MatchPrediction;
  homeName: string;
  awayName: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helper — format a probability as "XX.X%"
// ---------------------------------------------------------------------------
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelDetailPanel({ model, homeName, awayName, onClose }: ModelDetailPanelProps) {
  const tierInfo = MODEL_TIERS[model.predictorName];

  const { homeWin, draw, awayWin } = model.outcome;
  const hasGoals =
    model.expectedHomeGoals !== null && model.expectedAwayGoals !== null;
  const hasDrivers = model.drivers.length > 0;
  const hasFeatures =
    model.featuresUsed.length > 0 || model.featuresMissing.length > 0;
  const hasSources = model.sources.length > 0;

  // Drivers — show at most 5
  const visibleDrivers = model.drivers.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm animate-fade-in overflow-hidden">

      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {tierInfo ? (
              <span className={`text-xs font-black uppercase tracking-widest ${tierInfo.color}`}>
                {tierInfo.tier}
              </span>
            ) : null}
            <Badge color="navy">{model.predictorName}</Badge>
          </div>
          {tierInfo ? (
            <p className="mt-1 text-xs text-gray-400">{tierInfo.desc}</p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar panel"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Body                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="px-5 py-4 space-y-5">

        {/* ---- Cómo calcula ---- */}
        {tierInfo?.how ? (
          <div className="bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Cómo calcula
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{tierInfo.how}</p>
          </div>
        ) : null}

        {/* ---- Degraded banner ---- */}
        {model.degraded && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5">
            <span className="text-orange-500 text-base leading-none">⚠</span>
            <p className="text-xs font-semibold text-orange-700">
              Modelo degradado — resultado no confiable
            </p>
          </div>
        )}

        {/* ---- Probabilidades ---- */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Probabilidades
          </p>
          <ProbBar
            home={homeWin}
            draw={draw}
            away={awayWin}
            homeLabel={homeName}
            awayLabel={awayName}
            size="md"
          />
          {/* Chips debajo de la barra */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-wc-navy/10 text-wc-navy text-xs font-bold rounded-full">
              Local {pct(homeWin)}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded-full">
              Empate {pct(draw)}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-wc-red text-xs font-bold rounded-full">
              Visita {pct(awayWin)}
            </span>
          </div>
        </div>

        {/* ---- Goles esperados ---- */}
        {hasGoals && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Goles esperados
            </p>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-2 bg-wc-navy/5 rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-gray-600 truncate max-w-[7rem]">
                  {homeName}
                </span>
                <span className="text-xl font-black text-wc-navy">
                  {model.expectedHomeGoals!.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-red-50 rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-gray-600 truncate max-w-[7rem]">
                  {awayName}
                </span>
                <span className="text-xl font-black text-wc-red">
                  {model.expectedAwayGoals!.toFixed(2)}
                </span>
              </div>
            </div>
            {model.scoreline && (
              <ScoreTriple
                scores={mostLikelyScorePerOutcome(model.scoreline)}
                homeLabel={homeName}
                awayLabel={awayName}
                size="sm"
              />
            )}
          </div>
        )}

        {/* ---- Drivers ---- */}
        {hasDrivers && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Factores clave
            </p>
            <ul className="space-y-1.5">
              {visibleDrivers.map((driver, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-wc-navy/40 translate-y-[5px]" />
                  {driver}
                </li>
              ))}
              {model.drivers.length > 5 && (
                <li className="text-xs text-gray-400 pl-3.5">
                  +{model.drivers.length - 5} factores más…
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ---- Features usadas / faltantes ---- */}
        {hasFeatures && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Datos utilizados
            </p>
            <ul className="space-y-1">
              {model.featuresUsed.map((f, i) => (
                <li key={`used-${i}`} className="flex items-center gap-2 text-sm text-green-700">
                  <span className="shrink-0 text-green-500 font-bold">✓</span>
                  {f}
                </li>
              ))}
              {model.featuresMissing.map((f, i) => (
                <li key={`missing-${i}`} className="flex items-center gap-2 text-sm text-orange-700">
                  <span className="shrink-0 text-orange-500 font-bold">✗</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- Fuentes ---- */}
        {hasSources && (
          <div className="pt-1 border-t border-gray-100">
            <p className="text-[10px] text-gray-400">
              <span className="font-semibold">Fuentes: </span>
              {model.sources.map(s => s.name).join(', ')}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
