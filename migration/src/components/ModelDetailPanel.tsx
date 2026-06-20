// =============================================================================
// Oloráculo — ModelDetailPanel
// Inline panel shown below the prediction card grid when the user selects a model.
// Not a modal — it appears/disappears in-flow with animate-fade-in.
// =============================================================================

import { Badge, ProbBar, ScoreTriple } from './ui';
import { MODEL_TIERS } from '../engine/model-tiers';
import { mostLikelyScorePerOutcome, topPick } from '../engine/probability-helper';
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
// Executive summary helpers
// ---------------------------------------------------------------------------

function confidenceLabel(prob: number): { label: string; color: string; bg: string } {
  if (prob >= 0.65) return { label: 'Alta confianza', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
  if (prob >= 0.50) return { label: 'Confianza moderada', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' };
  return { label: 'Baja confianza', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' };
}

/**
 * Generate a match-specific 2-line narrative explaining WHY this model
 * made this prediction. Each model type uses its own structured data
 * (outcome probabilities, expected goals, drivers) to produce a
 * differential insight rather than a generic template.
 */
function generateSynthesis(
  model: MatchPrediction,
  homeName: string,
  awayName: string,
): string {
  const { homeWin, draw, awayWin } = model.outcome;
  const pick = topPick(model.outcome);

  switch (model.predictorName) {

    case 'Ranking FIFA':
    case 'Elo': {
      const raw = model.drivers[0] ?? '';
      const m = raw.match(/([+-]?\d+\.?\d*)/);
      const diff = m ? parseFloat(m[1]) : 0;
      const abs = Math.abs(diff);
      const leader = diff >= 0 ? homeName : awayName;
      const winPct = Math.round((pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw) * 100);

      if (abs < 60)  return `Rating casi idéntico entre ambos equipos (diferencia ${abs.toFixed(0)} pts). Sin favorito claro: el ${Math.round(draw * 100)}% de empate refleja la paridad de jerarquía.`;
      if (abs < 180) return `${leader} tiene leve ventaja (${abs.toFixed(0)} pts). El margen es pequeño; una actuación sólida del rival puede revertirlo fácilmente.`;
      if (abs < 350) return `Superioridad consolidada de ${leader} (${abs.toFixed(0)} pts). El modelo le asigna ${winPct}% de chances; sorpresa posible pero no esperada.`;
      return `${leader} supera ampliamente en el ranking (${abs.toFixed(0)} pts). A esta distancia, la jerarquía rara vez falla: ${winPct}% de probabilidad de victoria.`;
    }

    case 'Forma reciente': {
      const matches = [...((model.explanation ?? '').matchAll(/delta ([+-]?[\d.]+)/g))];
      const homeDelta = matches[0] ? parseFloat(matches[0][1]) : 0;
      const awayDelta = matches[1] ? parseFloat(matches[1][1]) : 0;
      const gap = homeDelta - awayDelta;

      if (Math.abs(gap) < 15)  return `Ambos equipos llegan con nivel de forma similar. La forma reciente no añade ventaja diferencial a ninguno de los dos.`;
      if (gap > 45)   return `${homeName} llega en un momento notablemente mejor (diferencia de forma +${gap.toFixed(0)}). La racha refuerza y amplifica la ventaja del local.`;
      if (gap < -45)  return `${awayName} llega en mucho mejor forma (diferencia ${gap.toFixed(0)}). La racha visitante compensa parte de la brecha de ratings base.`;
      if (gap > 0)    return `${homeName} llega algo mejor en forma (+${gap.toFixed(0)} puntos de delta). No es decisivo, pero suma un argumento extra al pronóstico local.`;
      return `${awayName} llega algo mejor en forma (${Math.abs(gap).toFixed(0)} pts de delta). Reduce levemente la ventaja que el rating base le daría al local.`;
    }

    case 'Modelo de goles (Poisson)': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      if (!hg && !ag) return model.explanation ?? '';
      const ratio = ag > 0.01 ? hg / ag : 10;

      if (ratio > 2.8)  return `Brecha goleadora marcada: el modelo proyecta ${hg.toFixed(2)} goles para ${homeName} vs ${ag.toFixed(2)} para ${awayName}. La grilla Poisson concentra probabilidad en victorias locales con margen.`;
      if (ratio > 1.5)  return `El local genera más peligro: ${hg.toFixed(2)} vs ${ag.toFixed(2)} goles esperados. La distribución Dixon-Coles favorece a ${homeName} en la mayoría de los marcadores posibles.`;
      if (ratio < 0.36) return `Dominio goleador del visitante: ${hg.toFixed(2)} vs ${ag.toFixed(2)}. La fuerza ofensiva y vulnerabilidad defensiva local inclinan la grilla hacia ${awayName} de manera contundente.`;
      if (ratio < 0.67) return `El visitante genera más: ${hg.toFixed(2)} vs ${ag.toFixed(2)} goles esperados. El modelo Poisson favorece a ${awayName} en la mayoría de los escenarios.`;
      return `Partido equilibrado en goles esperados: ${hg.toFixed(2)} vs ${ag.toFixed(2)}. Diferencias pequeñas hacen del empate un resultado muy competitivo en la grilla de marcadores.`;
    }

    case 'Potencial del plantel': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      const mvDriver = model.drivers.find(d => d.includes('Valor de mercado')) ?? '';
      const mvVals = [...mvDriver.matchAll(/€([\d.]+)M/g)];
      const homeMv = mvVals[0] ? parseFloat(mvVals[0][1]) : null;
      const awayMv = mvVals[1] ? parseFloat(mvVals[1][1]) : null;

      if (homeMv !== null && awayMv !== null) {
        const richer = homeMv >= awayMv ? homeName : awayName;
        const cheaper = homeMv < awayMv ? homeName : awayName;
        const safeMin = Math.max(Math.min(homeMv, awayMv), 1);
        const ratio = Math.max(homeMv, awayMv) / safeMin;
        if (ratio > 20) return `Brecha de plantel extrema: ${richer} tiene un valor de mercado ${ratio.toFixed(0)}× mayor que ${cheaper}. El score de potencial amplifica los goles a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        if (ratio > 4)  return `Gran diferencia de plantel: ${richer} (€${Math.max(homeMv, awayMv).toFixed(0)}M) vs ${cheaper} (€${Math.min(homeMv, awayMv).toFixed(0)}M). Ajusta los goles esperados a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        if (ratio > 1.5) return `${richer} tiene ventaja de plantel en valor de mercado y ligas top-5. El modelo ajusta los goles a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        return `Planteles de valor similar (€${homeMv.toFixed(0)}M vs €${awayMv.toFixed(0)}M). El ajuste de potencial no modifica sustancialmente los goles base (${hg.toFixed(2)}-${ag.toFixed(2)}).`;
      }
      return `Sin datos de plantel para uno o ambos equipos. Los goles reflejan el modelo base Poisson sin ajuste por valor de mercado.`;
    }

    case 'Goles + contexto reciente': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      const hasCtx = model.featuresUsed.includes('Disponibilidad de jugadores');
      if (!hasCtx) return `No hay bajas registradas para este partido. Completá la disponibilidad en el panel de contexto para activar el ajuste de L5.`;
      const d = model.drivers[0] ?? '';
      const clean = d.replace('Impacto por rol. ', '').replace('Bajas: ', '');
      return `Bajas activas modificaron los goles esperados a ${hg.toFixed(2)}-${ag.toFixed(2)}. ${clean}`;
    }

    case 'Momentum WC 2026': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      const inflDriver = model.drivers.find(d => d.startsWith('Inflación')) ?? '';
      const inflM = inflDriver.match(/×([\d.]+)/);
      const infl = inflM ? parseFloat(inflM[1]) : 1;
      const inflNote = infl > 1.15
        ? `el torneo está siendo muy goleador (×${infl.toFixed(2)}) — amplifica todos los pronósticos`
        : infl < 0.88
        ? `el torneo registra pocos goles (×${infl.toFixed(2)}) — frena las predicciones`
        : `el ritmo goleador del torneo es normal (×${infl.toFixed(2)})`;
      const momDriver = model.drivers.find(d => d.startsWith('Momentum')) ?? '';
      const pushM = momDriver.match(/push ([+-][\d.]+)/);
      const push = pushM ? parseFloat(pushM[1]) : 0;
      const momNote = Math.abs(push) > 0.05
        ? `El momentum ajusta +${push.toFixed(2)} goles a favor del ${push > 0 ? 'local' : 'visitante'}, llegando a ${hg.toFixed(2)}-${ag.toFixed(2)}.`
        : `Sin diferencial de momentum significativo entre los equipos en el torneo.`;
      return `Contexto del Mundial 2026: ${inflNote}. ${momNote}`;
    }

    case 'Estilo de Juego': {
      const notes = model.drivers.filter(d => d.includes('%') || d.includes('→'));
      if (notes.length === 0) return `Sin asimetría táctica marcada. Los estilos de ambos equipos no generan ventajas en presión, línea defensiva ni pelota parada.`;
      if (notes.length === 1) return notes[0];
      const second = notes[1].charAt(0).toLowerCase() + notes[1].slice(1);
      return `${notes[0]} Además: ${second}`;
    }

    default:
      return model.explanation ?? '';
  }
}

export function ModelDetailPanel({ model, homeName, awayName, onClose }: ModelDetailPanelProps) {
  const tierInfo = MODEL_TIERS[model.predictorName];

  const { homeWin, draw, awayWin } = model.outcome;
  const hasGoals =
    model.expectedHomeGoals !== null && model.expectedAwayGoals !== null;
  const hasDrivers = model.drivers.length > 0;
  const hasFeatures =
    model.featuresUsed.length > 0 || model.featuresMissing.length > 0;
  const hasSources = model.sources.length > 0;

  // Executive summary derived values
  const pick = topPick(model.outcome);
  const pickProb = pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw;
  const pickTeam = pick === 'Home' ? homeName : pick === 'Away' ? awayName : 'Empate';
  const pickColor = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-600';
  const pickBg   = pick === 'Home' ? 'bg-wc-navy/10' : pick === 'Away' ? 'bg-red-50' : 'bg-gray-100';
  const conf = confidenceLabel(pickProb);

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

        {/* ---- Resumen ejecutivo ---- */}
        {!model.degraded && (
          <div className={`rounded-xl border px-4 py-3.5 space-y-2 ${conf.bg}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Resumen ejecutivo</p>
            {/* Veredicto: pick + prob + confianza */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-base font-black ${pickColor} ${pickBg} rounded-lg px-3 py-0.5`}>
                {pickTeam}
              </span>
              <span className="text-2xl font-black text-gray-800 tabular-nums">
                {Math.round(pickProb * 100)}%
              </span>
              <span className={`text-xs font-semibold ${conf.color} ml-1`}>{conf.label}</span>
            </div>
            {/* Probabilidades compactas en línea */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="text-wc-navy font-semibold">L {Math.round(homeWin * 100)}%</span>
              <span className="text-gray-400">·</span>
              <span className="font-semibold">E {Math.round(draw * 100)}%</span>
              <span className="text-gray-400">·</span>
              <span className="text-wc-red font-semibold">V {Math.round(awayWin * 100)}%</span>
              {model.mostLikelyScore && (
                <>
                  <span className="text-gray-300 ml-1">|</span>
                  <span className="font-mono font-bold text-gray-600">
                    {model.mostLikelyScore.home}-{model.mostLikelyScore.away}
                  </span>
                </>
              )}
            </div>
            {/* Match-specific synthesis */}
            <p className="text-xs text-gray-700 leading-relaxed pt-0.5 border-t border-black/5">
              {generateSynthesis(model, homeName, awayName)}
            </p>
          </div>
        )}

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
