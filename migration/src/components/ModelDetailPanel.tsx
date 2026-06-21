// =============================================================================
// Oloráculo — ModelDetailPanel (redesigned)
// 3-zone compact card: verdict · expected goals · missing-data warning.
// No redundant probability bars, no documentation sections.
// =============================================================================

import { MODEL_TIERS } from '../engine/model-tiers';
import { topPick } from '../engine/probability-helper';
import type { MatchPrediction } from '../types/domain';

interface ModelDetailPanelProps {
  model: MatchPrediction;
  homeName: string;
  awayName: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------
function confLabel(prob: number): { label: string; color: string; bg: string; border: string } {
  if (prob >= 0.65) return { label: 'Alta',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (prob >= 0.50) return { label: 'Moderada', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   };
  return              { label: 'Baja',          color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200'  };
}

// ---------------------------------------------------------------------------
// Match-specific 2-line insight — differential per model type
// ---------------------------------------------------------------------------
function generateSynthesis(model: MatchPrediction, homeName: string, awayName: string): string {
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
      if (abs < 60)  return `Rating casi idéntico (${abs.toFixed(0)} pts). Sin favorito claro; ${Math.round(draw * 100)}% de empate refleja la paridad.`;
      if (abs < 180) return `${leader} tiene leve ventaja (${abs.toFixed(0)} pts). El rival puede revertirlo con una buena actuación.`;
      if (abs < 350) return `Superioridad consolidada de ${leader} (${abs.toFixed(0)} pts). El modelo asigna ${winPct}% de chances; sorpresa posible pero no esperada.`;
      return `${leader} supera ampliamente (${abs.toFixed(0)} pts). A esta distancia la jerarquía rara vez falla: ${winPct}% de victoria.`;
    }

    case 'Forma reciente': {
      const matches = [...((model.explanation ?? '').matchAll(/delta ([+-]?[\d.]+)/g))];
      const homeDelta = matches[0] ? parseFloat(matches[0][1]) : 0;
      const awayDelta = matches[1] ? parseFloat(matches[1][1]) : 0;
      const gap = homeDelta - awayDelta;
      if (Math.abs(gap) < 15) return `Ambos equipos llegan con nivel de forma similar. La racha reciente no añade ventaja diferencial.`;
      if (gap >  45) return `${homeName} llega en un momento notablemente mejor (+${gap.toFixed(0)} delta). La racha refuerza la ventaja del local.`;
      if (gap < -45) return `${awayName} llega en mucho mejor forma (${gap.toFixed(0)} pts delta). La racha visitante compensa parte de la brecha base.`;
      if (gap >  0)  return `${homeName} llega algo mejor en forma (+${gap.toFixed(0)} pts). Suma un argumento extra al pronóstico local.`;
      return `${awayName} llega algo mejor en forma (${Math.abs(gap).toFixed(0)} pts). Reduce levemente la ventaja del local en ratings.`;
    }

    case 'Modelo de goles (Poisson)': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      if (!hg && !ag) return model.explanation ?? '';
      const ratio = ag > 0.01 ? hg / ag : 10;
      if (ratio > 2.8)  return `Brecha goleadora marcada: ${hg.toFixed(2)} vs ${ag.toFixed(2)}. La grilla Poisson concentra probabilidad en victorias locales con margen.`;
      if (ratio > 1.5)  return `El local genera más peligro (${hg.toFixed(2)} vs ${ag.toFixed(2)} xG). Dixon-Coles favorece a ${homeName} en la mayoría de los marcadores.`;
      if (ratio < 0.36) return `Dominio visitante: ${hg.toFixed(2)} vs ${ag.toFixed(2)} xG. La fuerza y vulnerabilidad defensiva local inclinan la grilla hacia ${awayName}.`;
      if (ratio < 0.67) return `Visitante genera más (${hg.toFixed(2)} vs ${ag.toFixed(2)} xG). El modelo Poisson favorece a ${awayName} en la mayoría de escenarios.`;
      return `Partido equilibrado en xG: ${hg.toFixed(2)} vs ${ag.toFixed(2)}. Diferencias pequeñas hacen el empate muy competitivo en la grilla.`;
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
        if (ratio > 20) return `Brecha de plantel extrema: ${richer} vale ${ratio.toFixed(0)}× más que ${cheaper}. Amplifica los xG a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        if (ratio > 4)  return `Gran diferencia de plantel: €${Math.max(homeMv, awayMv).toFixed(0)}M vs €${Math.min(homeMv, awayMv).toFixed(0)}M. Ajusta xG a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        if (ratio > 1.5) return `${richer} tiene ventaja de plantel en valor y ligas top-5. xG ajustado a ${hg.toFixed(2)}-${ag.toFixed(2)}.`;
        return `Planteles de valor similar. El ajuste de potencial no cambia sustancialmente los xG base (${hg.toFixed(2)}-${ag.toFixed(2)}).`;
      }
      return `Sin datos de plantel para uno o ambos equipos. Los xG reflejan el modelo Poisson base sin ajuste.`;
    }

    case 'Goles + contexto reciente': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      const hasCtx = model.featuresUsed.includes('Disponibilidad de jugadores');
      if (!hasCtx) return `Sin bajas registradas. Completá disponibilidad en el panel de contexto para activar L5.`;
      const d = (model.drivers[0] ?? '').replace('Impacto por rol. ', '').replace('Bajas: ', '');
      return `Bajas modificaron los xG a ${hg.toFixed(2)}-${ag.toFixed(2)}. ${d}`;
    }

    case 'Momentum del Mundial': {
      const hg = model.expectedHomeGoals ?? 0;
      const ag = model.expectedAwayGoals ?? 0;
      const inflM = (model.drivers.find(d => d.startsWith('Inflación')) ?? '').match(/×([\d.]+)/);
      const infl = inflM ? parseFloat(inflM[1]) : 1;
      const inflNote = infl > 1.15 ? `torneo muy goleador (×${infl.toFixed(2)})` : infl < 0.88 ? `torneo con pocos goles (×${infl.toFixed(2)})` : `ritmo goleador normal (×${infl.toFixed(2)})`;
      const pushM = (model.drivers.find(d => d.startsWith('Momentum')) ?? '').match(/push ([+-][\d.]+)/);
      const push = pushM ? parseFloat(pushM[1]) : 0;
      const momNote = Math.abs(push) > 0.05
        ? `Momentum ajusta +${push.toFixed(2)} goles al ${push > 0 ? 'local' : 'visitante'} → xG ${hg.toFixed(2)}-${ag.toFixed(2)}.`
        : `Sin diferencial de momentum entre equipos en el torneo.`;
      return `Mundial 2026: ${inflNote}. ${momNote}`;
    }

    default:
      return model.explanation ?? '';
  }
}

// ---------------------------------------------------------------------------
// Mini probability bar (L · E · V) — 3 colored segments
// ---------------------------------------------------------------------------
function MiniBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-1 rounded-full overflow-hidden w-16 shrink-0">
      <div className="bg-wc-navy/80" style={{ width: `${home * 100}%` }} />
      <div className="bg-gray-300"   style={{ width: `${draw * 100}%` }} />
      <div className="bg-wc-red/70"  style={{ width: `${away * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ModelDetailPanel({ model, homeName, awayName, onClose }: ModelDetailPanelProps) {
  const tierInfo = MODEL_TIERS[model.predictorName];
  const { homeWin, draw, awayWin } = model.outcome;
  const pick = topPick(model.outcome);
  const pickProb = pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw;
  const pickTeam  = pick === 'Home' ? homeName : pick === 'Away' ? awayName : 'Empate';
  const pickColor = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-700';
  const conf = confLabel(pickProb);
  const hasGoals = model.expectedHomeGoals != null && model.expectedAwayGoals != null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm animate-fade-in overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {tierInfo && (
            <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${tierInfo.color}`}>
              {tierInfo.tier}
            </span>
          )}
          <span className="text-xs font-bold text-gray-800 truncate">
            {tierInfo?.shortName ?? model.predictorName}
          </span>
          {tierInfo && (
            <span className="text-[10px] text-gray-400 truncate hidden sm:block">{tierInfo.desc}</span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="shrink-0 ml-2 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-3 space-y-2.5">

        {/* Degraded */}
        {model.degraded && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <span className="text-orange-500 shrink-0">⚠</span>
            <p className="text-xs font-semibold text-orange-700">Sin datos suficientes — resultado no confiable</p>
          </div>
        )}

        {!model.degraded && (
          <>
            {/* ── Zone 1: Verdict ── */}
            <div className={`rounded-xl border ${conf.border} ${conf.bg} px-3 py-3 space-y-2`}>

              {/* Hero: team + % + confidence */}
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-sm font-black ${pickColor}`}>{pickTeam}</span>
                <span className="text-3xl font-black text-gray-900 tabular-nums leading-none">
                  {Math.round(pickProb * 100)}%
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${conf.color}`}>
                  {conf.label}
                </span>
              </div>

              {/* Spread + scoreline */}
              <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                <MiniBar home={homeWin} draw={draw} away={awayWin} />
                <span className="font-bold text-wc-navy">L {Math.round(homeWin * 100)}%</span>
                <span className="text-gray-300">·</span>
                <span className="font-bold">E {Math.round(draw * 100)}%</span>
                <span className="text-gray-300">·</span>
                <span className="font-bold text-wc-red">V {Math.round(awayWin * 100)}%</span>
                {model.mostLikelyScore && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span className="font-mono font-bold text-gray-600 tracking-tight">
                      {model.mostLikelyScore.home}-{model.mostLikelyScore.away}
                    </span>
                  </>
                )}
              </div>

              {/* Match-specific insight */}
              <p className="text-xs text-gray-700 leading-relaxed border-t border-black/5 pt-2">
                {generateSynthesis(model, homeName, awayName)}
              </p>
            </div>

            {/* ── Zone 2: Expected goals (Poisson-based models only) ── */}
            {hasGoals && (
              <div className="flex items-center gap-2 px-1 text-xs">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide shrink-0">xG</span>
                <span className="font-bold text-wc-navy">{model.expectedHomeGoals!.toFixed(2)}</span>
                <span className="text-gray-300">–</span>
                <span className="font-bold text-wc-red">{model.expectedAwayGoals!.toFixed(2)}</span>
              </div>
            )}

            {/* ── Zone 3: Missing features (warning only, no ✓ list) ── */}
            {model.featuresMissing.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs text-orange-700 px-1">
                <span className="shrink-0 font-bold mt-px">✗</span>
                <span>Falta: {model.featuresMissing.slice(0, 2).join(', ')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Re-export MiniBar for use in MatchesPage model table
export { MiniBar };
