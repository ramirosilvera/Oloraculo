// =============================================================================
// PIECard — Prode Intelligence Engine
// Muestra el consenso colectivo de 500 pronosticadores virtuales con
// distintas personalidades, ponderados por reputación histórica.
// =============================================================================

import type { PIEResult, ArchetypeId } from '../types/pie';
import { X } from 'lucide-react';

interface PIECardProps {
  result: PIEResult;
  homeName: string;
  awayName: string;
  onClose?: () => void;
}

const ARCHETYPE_LABELS: Record<ArchetypeId, { label: string; emoji: string; desc: string }> = {
  FAVORITO:    { label: 'Seguidor del favorito', emoji: '📈', desc: 'Apuesta al más fuerte' },
  SORPRESA:    { label: 'Cazador de sorpresas',  emoji: '💥', desc: 'Busca la sorpresa' },
  EMPATE:      { label: 'Empatero crónico',      emoji: '🤝', desc: 'El empate siempre llega' },
  EQUILIBRADO: { label: 'Analítico neutral',     emoji: '📊', desc: 'Frío, sin sesgo marcado' },
  CAOTICO:     { label: 'Caótico puro',          emoji: '🎲', desc: 'Imposible de predecir' },
};

function MiniBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden w-full">
      <div className="bg-wc-navy/80" style={{ width: `${home * 100}%` }} />
      <div className="bg-gray-300"   style={{ width: `${draw * 100}%` }} />
      <div className="bg-wc-red/70"  style={{ width: `${away * 100}%` }} />
    </div>
  );
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function PickLabel({
  pick, homeLabel, awayLabel, prob, size = 'md',
}: {
  pick: 'Home' | 'Draw' | 'Away';
  homeLabel: string;
  awayLabel: string;
  prob: number;
  size?: 'sm' | 'md';
}) {
  const name = pick === 'Home' ? homeLabel : pick === 'Away' ? awayLabel : 'Empate';
  const color = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-600';
  const probColor = prob >= 0.55 ? 'text-emerald-700' : prob >= 0.42 ? 'text-amber-600' : 'text-gray-500';
  return (
    <div className="text-center">
      <div className={`font-bold truncate ${size === 'md' ? 'text-base' : 'text-sm'} ${color}`}>{name}</div>
      <div className={`text-xs font-semibold tabular-nums ${probColor}`}>{pct(prob)}</div>
    </div>
  );
}

function ContrarianBadge({ signal }: { signal: number }) {
  if (signal < 0.05) return <span className="text-xs text-gray-400">Elites y masa alineadas</span>;
  if (signal < 0.15) return <span className="text-xs text-amber-600">Leve divergencia élite</span>;
  return <span className="text-xs font-semibold text-red-600">⚡ Señal contraria: élites discrepan</span>;
}

export function PIECard({ result, homeName, awayName, onClose }: PIECardProps) {
  if (result.degraded) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">PIE</span>
          {onClose && <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>}
        </div>
        <p className="text-sm text-gray-400">Sin datos Elo suficientes para calcular el consenso.</p>
      </div>
    );
  }

  const { pick_probabilities: cp, elite_probabilities: ep } = result;
  const crowdProb  = result.most_probable_pick === 'Home' ? cp.home : result.most_probable_pick === 'Away' ? cp.away : cp.draw;
  const eliteProb  = result.elite_pick === 'Home' ? ep.home : result.elite_pick === 'Away' ? ep.away : ep.draw;

  // Sort archetypes by avg rep descending
  const archetypesSorted = (Object.entries(result.archetype_avg_reps) as [ArchetypeId, number][])
    .sort((a, b) => b[1] - a[1]);

  const topArchetype = result.dominant_archetype ? ARCHETYPE_LABELS[result.dominant_archetype] : null;

  return (
    <div className="rounded-2xl border border-wc-navy/10 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-wc-navy/5 border-b border-wc-navy/10">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-wc-navy text-white">PIE</span>
          <span className="text-sm font-bold text-wc-navy">Prode Intelligence Engine</span>
          <span className="text-xs text-gray-400 hidden sm:block">· 500 pronosticadores</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Crowd consensus */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Consenso colectivo (500 jugadores)</p>
          <div className="space-y-1.5">
            <MiniBar home={cp.home} draw={cp.draw} away={cp.away} />
            <div className="grid grid-cols-3 text-center text-xs">
              <div>
                <div className="font-semibold text-wc-navy truncate">{homeName}</div>
                <div className="tabular-nums text-gray-600">{pct(cp.home)}</div>
              </div>
              <div>
                <div className="font-semibold text-gray-500">Empate</div>
                <div className="tabular-nums text-gray-600">{pct(cp.draw)}</div>
              </div>
              <div>
                <div className="font-semibold text-wc-red truncate">{awayName}</div>
                <div className="tabular-nums text-gray-600">{pct(cp.away)}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Picks comparison */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Masa</p>
            <PickLabel pick={result.most_probable_pick} homeLabel={homeName} awayLabel={awayName} prob={crowdProb} />
          </div>
          <div className={`rounded-xl border p-3 space-y-1.5 ${result.contrarian_signal >= 0.15 ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-gray-50'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Élite (top 10%)</p>
            <PickLabel pick={result.elite_pick} homeLabel={homeName} awayLabel={awayName} prob={eliteProb} size="sm" />
          </div>
        </section>

        {/* Contrarian signal */}
        <div className="flex items-center gap-2">
          <ContrarianBadge signal={result.contrarian_signal} />
        </div>

        {/* Elite bar */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Consenso élite</p>
          <div className="space-y-1">
            <MiniBar home={ep.home} draw={ep.draw} away={ep.away} />
            <div className="flex justify-between text-[10px] text-gray-400 tabular-nums">
              <span>{pct(ep.home)}</span>
              <span>{pct(ep.draw)}</span>
              <span>{pct(ep.away)}</span>
            </div>
          </div>
        </section>

        {/* Dominant archetype */}
        {topArchetype && (
          <section className="rounded-xl border border-wc-navy/10 bg-wc-navy/3 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Arquetipo dominante</p>
            <div className="flex items-center gap-2">
              <span className="text-xl">{topArchetype.emoji}</span>
              <div>
                <p className="text-sm font-bold text-wc-navy">{topArchetype.label}</p>
                <p className="text-xs text-gray-400">{topArchetype.desc}</p>
              </div>
            </div>
          </section>
        )}

        {/* Archetype breakdown */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Reputación por arquetipo</p>
          <div className="space-y-1.5">
            {archetypesSorted.map(([arc, avg]) => {
              const { label, emoji } = ARCHETYPE_LABELS[arc];
              const max = archetypesSorted[0][1];
              const barW = max > 0 ? (avg / max) * 100 : 0;
              return (
                <div key={arc} className="flex items-center gap-2">
                  <span className="w-5 text-sm shrink-0">{emoji}</span>
                  <div className="w-20 text-[10px] text-gray-500 shrink-0 truncate">{label.split(' ')[0]}</div>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-wc-navy/60 rounded-full" style={{ width: `${barW}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-gray-400 w-8 text-right shrink-0">{(avg * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Most likely score + meta */}
        <section className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-100">
          {result.mostLikelyScore && (
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">Marcador más probable</p>
              <p className="text-lg font-black tabular-nums text-wc-navy">
                {result.mostLikelyScore.home} — {result.mostLikelyScore.away}
              </p>
            </div>
          )}
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">Confianza</p>
            <p className={`text-sm font-bold tabular-nums ${result.confidence >= 0.55 ? 'text-emerald-700' : result.confidence >= 0.42 ? 'text-amber-600' : 'text-gray-500'}`}>
              {pct(result.confidence)}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
