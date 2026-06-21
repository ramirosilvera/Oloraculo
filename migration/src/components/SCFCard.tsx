// =============================================================================
// SCFCard — Sentido Común Futbolero visual component
// Shows the SCF_SCORE gauge, category breakdown, and top heuristics.
// =============================================================================

import type { SCFResult, SCFCategory, ActiveHeuristic } from '../types/scf';

interface SCFCardProps {
  result: SCFResult;
  homeName: string;
  awayName: string;
}

const CAT_LABEL: Record<SCFCategory, string> = {
  HISTORIA:   'Historia',
  FORMA:      'Forma',
  PLANTEL:    'Plantel',
  TORNEO:     'Torneo',
  LOCALIA:    'Localía',
  PSICOLOGIA: 'Psicología',
};

const CAT_COLOR: Record<SCFCategory, string> = {
  HISTORIA:   'bg-amber-400',
  FORMA:      'bg-emerald-400',
  PLANTEL:    'bg-blue-400',
  TORNEO:     'bg-purple-400',
  LOCALIA:    'bg-orange-300',
  PSICOLOGIA: 'bg-pink-400',
};

const CAT_TEXT: Record<SCFCategory, string> = {
  HISTORIA:   'text-amber-700',
  FORMA:      'text-emerald-700',
  PLANTEL:    'text-blue-700',
  TORNEO:     'text-purple-700',
  LOCALIA:    'text-orange-700',
  PSICOLOGIA: 'text-pink-700',
};

function ScoreGauge({ score, homeName, awayName }: { score: number; homeName: string; awayName: string }) {
  // score: 0-100, 50 = neutral
  const homeWidth  = `${score}%`;
  const awayWidth  = `${100 - score}%`;
  const isHome    = score > 52;
  const isAway    = score < 48;
  const isNeutral = !isHome && !isAway;

  let gaugeColor: string;
  if (score >= 70)       gaugeColor = 'bg-wc-navy';
  else if (score >= 57)  gaugeColor = 'bg-blue-400';
  else if (score >= 43)  gaugeColor = 'bg-gray-400';
  else if (score >= 30)  gaugeColor = 'bg-wc-red/70';
  else                   gaugeColor = 'bg-wc-red';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-semibold">
        <span className={`${isHome ? 'text-wc-navy font-black' : 'text-gray-400'}`}>{homeName}</span>
        <span className={`tabular-nums font-black text-sm ${isHome ? 'text-wc-navy' : isAway ? 'text-wc-red' : 'text-gray-500'}`}>
          {isNeutral ? 'PAREJO' : score.toFixed(0)}
          {!isNeutral && <span className="text-[10px] font-normal ml-0.5">SCF</span>}
        </span>
        <span className={`${isAway ? 'text-wc-red font-black' : 'text-gray-400'}`}>{awayName}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-gray-100 flex">
        <div className={`h-full transition-all ${gaugeColor}`} style={{ width: homeWidth }} />
        <div className="h-full bg-gray-200" style={{ width: awayWidth }} />
      </div>
    </div>
  );
}

function HeuristicChip({ h, homeName, awayName }: { h: ActiveHeuristic; homeName: string; awayName: string }) {
  const favors = h.direction > 0.05 ? homeName : h.direction < -0.05 ? awayName : null;
  const catColor = CAT_TEXT[h.category];
  const catBg = h.category === 'HISTORIA' ? 'bg-amber-50' :
                h.category === 'FORMA' ? 'bg-emerald-50' :
                h.category === 'PLANTEL' ? 'bg-blue-50' :
                h.category === 'TORNEO' ? 'bg-purple-50' :
                h.category === 'LOCALIA' ? 'bg-orange-50' :
                'bg-pink-50';
  return (
    <div className={`rounded-xl px-2.5 py-2 border border-gray-100 ${h.isBias ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-1.5">
        <span className={`text-[9px] font-black uppercase tracking-wide shrink-0 mt-px ${catColor} ${catBg} px-1 py-px rounded`}>
          {CAT_LABEL[h.category]}
        </span>
        {h.isBias && (
          <span className="text-[9px] font-bold text-orange-500 bg-orange-50 border border-orange-100 px-1 py-px rounded shrink-0">
            sesgo
          </span>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-700 mt-1 leading-tight">{h.name}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{h.note}</p>
      {favors && (
        <p className="text-[10px] font-bold mt-1 text-wc-navy">→ {favors}</p>
      )}
    </div>
  );
}

function CategoryBar({ breakdown, homeName, awayName }: {
  breakdown: SCFResult['category_breakdown'];
  homeName: string;
  awayName: string;
}) {
  const active = breakdown.filter(c => c.activeCount + c.biasCount > 0);
  if (active.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {active.map(cat => {
        // score is -1..+1, map to 0..100 for bar
        const pct = Math.round((cat.score + 1) / 2 * 100);
        const favors = cat.score > 0.05 ? homeName : cat.score < -0.05 ? awayName : null;
        return (
          <div key={cat.category} className="flex items-center gap-2">
            <span className={`text-[9px] font-bold w-16 shrink-0 ${CAT_TEXT[cat.category]}`}>
              {CAT_LABEL[cat.category]}
            </span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-100 flex">
              <div className={`h-full rounded-full transition-all ${CAT_COLOR[cat.category]}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[9px] text-gray-400 w-10 text-right shrink-0 tabular-nums">
              {favors ? favors.slice(0, 4) + '.' : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SCFCard({ result, homeName, awayName }: SCFCardProps) {
  if (result.degraded) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">SCF</span>
          <span className="text-xs font-bold text-gray-500">Sentido Común Futbolero</span>
        </div>
        <p className="text-xs text-gray-400">Sin señales aplicables para este partido.</p>
      </div>
    );
  }

  const nonBiasHeuristics = result.top_heuristics.filter(h => !h.isBias);
  const biasHeuristics    = result.top_heuristics.filter(h => h.isBias);
  const confidencePct = Math.round(result.confidence * 100);
  const confLabel = result.confidence >= 0.65 ? 'Alta' : result.confidence >= 0.4 ? 'Mod.' : 'Baja';
  const confColor = result.confidence >= 0.65 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : result.confidence >= 0.4  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  :                             'text-orange-700 bg-orange-50 border-orange-200';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-wc-navy">SCF</span>
          <span className="text-xs font-bold text-gray-700">Sentido Común Futbolero</span>
          <span className="text-[9px] text-gray-400 hidden sm:block">· inteligencia colectiva</span>
        </div>
        <span className={`text-[9px] font-bold border rounded-full px-1.5 py-px ${confColor}`}>
          {confLabel} · {confidencePct}%
        </span>
      </div>

      <div className="p-3 space-y-3">

        {/* Score gauge */}
        <ScoreGauge score={result.scf_score} homeName={homeName} awayName={awayName} />

        {/* Outcome probabilities */}
        <div className="flex items-center gap-3 text-xs text-center">
          <div className="flex-1">
            <div className="text-sm font-black text-wc-navy">{Math.round(result.outcome.homeWin * 100)}%</div>
            <div className="text-[9px] text-gray-400">L</div>
          </div>
          <div className="flex-1">
            <div className="text-sm font-black text-gray-500">{Math.round(result.outcome.draw * 100)}%</div>
            <div className="text-[9px] text-gray-400">E</div>
          </div>
          <div className="flex-1">
            <div className="text-sm font-black text-wc-red">{Math.round(result.outcome.awayWin * 100)}%</div>
            <div className="text-[9px] text-gray-400">V</div>
          </div>
        </div>

        {/* Category breakdown */}
        <CategoryBar breakdown={result.category_breakdown} homeName={homeName} awayName={awayName} />

        {/* Top heuristics */}
        {nonBiasHeuristics.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Señales activas</p>
            <div className="grid gap-1.5">
              {nonBiasHeuristics.map(h => (
                <HeuristicChip key={h.id} h={h} homeName={homeName} awayName={awayName} />
              ))}
            </div>
          </div>
        )}

        {/* Bias heuristics */}
        {biasHeuristics.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-orange-400">
              Sesgos detectados ({biasHeuristics.length}) · peso reducido
            </p>
            <div className="grid gap-1.5">
              {biasHeuristics.map(h => (
                <HeuristicChip key={h.id} h={h} homeName={homeName} awayName={awayName} />
              ))}
            </div>
          </div>
        )}

        <p className="text-[8px] text-gray-300 text-right">
          {result.top_heuristics.length} señal{result.top_heuristics.length !== 1 ? 'es' : ''} ·
          {' '}{result.bias_count} sesgo{result.bias_count !== 1 ? 's' : ''} ·
          {' '}heurísticas observadas en comunidades reales
        </p>
      </div>
    </div>
  );
}
