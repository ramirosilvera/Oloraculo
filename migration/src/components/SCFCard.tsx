// =============================================================================
// SCFCard — Resumen ejecutivo del Sentido Común Futbolero
// Mismo patrón visual que ModelDetailPanel: veredicto · señales · alertas.
// =============================================================================

import type { SCFResult, ActiveHeuristic } from '../types/scf';

interface SCFCardProps {
  result: SCFResult;
  homeName: string;
  awayName: string;
}

// ---------------------------------------------------------------------------
// Confidence badge (mirrors ModelDetailPanel.confLabel)
// ---------------------------------------------------------------------------
function confLabel(prob: number): { label: string; color: string; bg: string; border: string } {
  if (prob >= 0.65) return { label: 'Alta',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (prob >= 0.50) return { label: 'Moderada', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   };
  return              { label: 'Baja',          color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200'  };
}

// ---------------------------------------------------------------------------
// Mini probability bar (same as ModelDetailPanel)
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
// Executive synthesis — 1-2 concrete sentences, decision-oriented
// ---------------------------------------------------------------------------
function generateSCFSynthesis(result: SCFResult, homeName: string, awayName: string): string {
  const { homeWin, draw, awayWin } = result.outcome;
  const score = result.scf_score;

  const pick = homeWin > awayWin && homeWin > draw ? 'home'
             : awayWin > homeWin && awayWin > draw ? 'away' : 'draw';
  const pickName = pick === 'home' ? homeName : pick === 'away' ? awayName : 'empate';
  const pickPct  = Math.round((pick === 'home' ? homeWin : pick === 'away' ? awayWin : draw) * 100);

  const topSignal = result.top_heuristics.find(h => !h.isBias);
  const biasSignal = result.top_heuristics.find(h => h.isBias);

  let verdict: string;
  if (score >= 68 || score <= 32) {
    verdict = `La intuición colectiva empuja fuerte a ${pickName} (${pickPct}%).`;
  } else if (score >= 58 || score <= 42) {
    verdict = `El sentido común se inclina por ${pickName} (${pickPct}%), sin convicción plena.`;
  } else {
    verdict = `Sin consenso claro entre hinchas — señales contrapuestas se anulan.`;
  }

  const reasonPart = topSignal
    ? ` Señal clave: ${topSignal.name.toLowerCase()}.`
    : '';

  const biasPart = biasSignal && result.bias_count >= 1
    ? ` Sesgo detectado: ${biasSignal.name.toLowerCase()} — peso reducido.`
    : '';

  return verdict + reasonPart + biasPart;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SCFCard({ result, homeName, awayName }: SCFCardProps) {
  if (result.degraded) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <span className="text-[10px] font-black uppercase tracking-widest text-wc-navy shrink-0">SCF</span>
          <span className="text-xs font-bold text-gray-800">Sentido Común Futbolero</span>
        </div>
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <span className="text-orange-500 shrink-0">⚠</span>
            <p className="text-xs font-semibold text-orange-700">Sin patrones aplicables para este partido</p>
          </div>
        </div>
      </div>
    );
  }

  const { homeWin, draw, awayWin } = result.outcome;
  const pick = homeWin > awayWin && homeWin > draw ? 'Home'
             : awayWin > homeWin && awayWin > draw ? 'Away' : 'Draw';
  const pickProb = pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw;
  const pickTeam  = pick === 'Home' ? homeName : pick === 'Away' ? awayName : 'Empate';
  const pickColor = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-700';
  const conf = confLabel(pickProb);

  const nonBiasHints   = result.top_heuristics.filter((h: ActiveHeuristic) => !h.isBias).slice(0, 2);
  const biasHints      = result.top_heuristics.filter((h: ActiveHeuristic) => h.isBias).slice(0, 1);
  const synthesis      = generateSCFSynthesis(result, homeName, awayName);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <span className="text-[10px] font-black uppercase tracking-widest text-wc-navy shrink-0">SCF</span>
        <span className="text-xs font-bold text-gray-800 truncate">Sentido Común Futbolero</span>
        <span className="text-[10px] text-gray-400 truncate hidden sm:block">
          · heurísticas de comunidades reales
        </span>
        <span className="ml-auto text-[9px] text-gray-300 tabular-nums shrink-0">
          {result.scf_score.toFixed(0)}/100
        </span>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-3 space-y-2.5">

        {/* ── Zone 1: Veredicto ── */}
        <div className={`rounded-xl border ${conf.border} ${conf.bg} px-3 py-3 space-y-2`}>

          {/* Hero: equipo + % + confianza */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-sm font-black ${pickColor}`}>{pickTeam}</span>
            <span className="text-3xl font-black text-gray-900 tabular-nums leading-none">
              {Math.round(pickProb * 100)}%
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${conf.color}`}>
              {conf.label}
            </span>
          </div>

          {/* Spread L / E / V */}
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <MiniBar home={homeWin} draw={draw} away={awayWin} />
            <span className="font-bold text-wc-navy">L {Math.round(homeWin * 100)}%</span>
            <span className="text-gray-300">·</span>
            <span className="font-bold">E {Math.round(draw * 100)}%</span>
            <span className="text-gray-300">·</span>
            <span className="font-bold text-wc-red">V {Math.round(awayWin * 100)}%</span>
          </div>

          {/* Síntesis ejecutiva */}
          <p className="text-xs text-gray-700 leading-relaxed border-t border-black/5 pt-2">
            {synthesis}
          </p>
        </div>

        {/* ── Zone 2: Señales activas (bullets cortos) ── */}
        {nonBiasHints.length > 0 && (
          <div className="space-y-1 px-1">
            {nonBiasHints.map((h: ActiveHeuristic) => {
              const favors = h.direction > 0.05 ? homeName
                           : h.direction < -0.05 ? awayName : null;
              return (
                <div key={h.id} className="flex items-start gap-1.5 text-xs text-gray-600">
                  <span className="shrink-0 font-bold text-wc-navy mt-px">↗</span>
                  <span>
                    <span className="font-semibold">{h.name}</span>
                    {favors && <span className="text-gray-400"> → {favors}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Zone 3: Alertas de sesgo ── */}
        {biasHints.length > 0 && (
          <div className="flex items-start gap-1.5 text-xs text-orange-700 px-1">
            <span className="shrink-0 font-bold mt-px">⚠</span>
            <span>Sesgo colectivo: {biasHints.map((h: ActiveHeuristic) => h.name.toLowerCase()).join(', ')} — peso reducido en el score</span>
          </div>
        )}

      </div>
    </div>
  );
}
