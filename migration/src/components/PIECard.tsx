// =============================================================================
// PIECard — Prode Intelligence Engine
// Muestra el torneo interno de 100 000 jugadores virtuales.
// Dirección (quién gana): consenso ponderado del top-K adaptativo.
// Marcador exacto: predicción del mejor jugador del top-K que coincide con
// esa dirección — sample determinista de su pool de arquetipo, varía por partido.
// =============================================================================

import type { PIEResult, PIELeaderEntry, ArchetypeId } from '../types/pie';
import { X } from 'lucide-react';

interface PIECardProps {
  result: PIEResult;
  homeName: string;
  awayName: string;
  onClose?: () => void;
  /** LOO out-of-sample accuracy from PerformancePage evaluations (honest model metric) */
  looWinnerAcc?: { correct: number; total: number } | null;
  looExactAcc?: { correct: number; total: number } | null;
}

const ARCHETYPE_META: Record<ArchetypeId, { emoji: string; label: string; desc: string }> = {
  FAVORITO:    { emoji: '📈', label: 'Favorito',   desc: 'Tendencia al favorito, pero flexible' },
  SORPRESA:    { emoji: '💥', label: 'Sorpresero', desc: 'Tendencia al underdog, sin extremos' },
  EMPATE:      { emoji: '🤝', label: 'Empatero',   desc: 'Tendencia al empate, hibrido' },
  EQUILIBRADO: { emoji: '📊', label: 'Híbrido',    desc: 'Sin sesgo dominante — el que gana los prodes' },
  CAOTICO:     { emoji: '🎲', label: 'Caótico',    desc: 'Alta varianza, marcadores impredecibles' },
};

function pickLabel(pick: 'Home' | 'Draw' | 'Away', home: string, away: string) {
  return pick === 'Home' ? home : pick === 'Away' ? away : 'Empate';
}
function pickShort(pick: 'Home' | 'Draw' | 'Away') {
  return pick === 'Home' ? 'L' : pick === 'Away' ? 'V' : 'E';
}
function pickColor(pick: 'Home' | 'Draw' | 'Away') {
  return pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-600';
}

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
function pctInt(n: number) { return `${Math.round(n * 100)}%`; }

function PlayerNum({ id }: { id: string }) {
  const num = id.replace('pie-', '');
  return <span className="text-gray-400 font-mono text-[10px]">#{num}</span>;
}

function LeaderboardRow({ entry, isLeader }: {
  entry: PIELeaderEntry;
  isLeader: boolean;
}) {
  const meta = ARCHETYPE_META[entry.archetype];
  const acc = entry.total > 0 ? entry.correct / entry.total : null;
  const pickC = pickColor(entry.pick);
  const accColor = acc !== null
    ? acc >= 0.60 ? 'text-emerald-700' : acc >= 0.45 ? 'text-amber-600' : 'text-gray-400'
    : 'text-gray-300';
  const exactColor = entry.exactCorrect >= 0.5 ? 'text-purple-700 font-bold' : 'text-gray-300';

  return (
    <tr className={`border-t border-gray-50 ${isLeader ? 'bg-wc-navy/3' : ''}`}>
      <td className="py-2 pl-4 pr-1 w-5">
        <span className={`text-xs font-bold ${isLeader ? 'text-wc-navy' : 'text-gray-400'}`}>
          {isLeader ? '★' : entry.rank}
        </span>
      </td>
      <td className="py-2 px-1 text-sm">{meta.emoji}</td>
      <td className="py-2 px-1"><PlayerNum id={entry.id} /></td>
      <td className="py-2 px-1 text-right tabular-nums">
        <span className={`text-xs font-bold ${accColor}`}>{entry.correct}</span>
        <span className="text-[10px] text-gray-300">/{entry.total}</span>
      </td>
      <td className="py-2 px-1 text-right">
        <span className={`text-xs tabular-nums ${exactColor}`}>{Math.round(entry.exactCorrect * 10) / 10}</span>
      </td>
      <td className="py-2 pl-1 pr-4 text-right">
        <span className={`text-xs font-black ${pickC}`}>{pickShort(entry.pick)}</span>
        <span className="text-[10px] text-gray-400 ml-1 tabular-nums">
          {entry.pickScore.home}-{entry.pickScore.away}
        </span>
      </td>
    </tr>
  );
}

export function PIECard({ result, homeName, awayName, onClose, looWinnerAcc, looExactAcc }: PIECardProps) {
  if (result.degraded || !result.leader) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">PIE</span>
          {onClose && <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>}
        </div>
        <p className="text-sm text-gray-400">Sin datos Elo para calcular el torneo.</p>
      </div>
    );
  }

  const { leader, leaderboard, pick_probabilities: cp, elite_probabilities: ep } = result;
  const leaderMeta = ARCHETYPE_META[leader.archetype];
  const leaderAcc = leader.total > 0 ? leader.correct / leader.total : null;
  // cp is the top-K consensus (K adaptive), not the full crowd
  const consensusModal = result.most_probable_pick;

  return (
    <div className="rounded-2xl border border-wc-navy/10 bg-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-wc-navy/5 border-b border-wc-navy/10">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-wc-navy text-white">PIE</span>
          <span className="text-sm font-bold text-wc-navy">Prode Intelligence</span>
          <span className="text-xs text-gray-400 hidden sm:block">· {result.sample_size} jugadores compitiendo</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5">

        {/* Campeón de Prode — el jugador #1 del torneo interno y SU pronóstico propio
            (pick + marcador coherentes, no el del consenso) */}
        <section className={`rounded-xl border px-4 py-3.5 ${
          result.contrarian_signal > 0.15
            ? 'border-amber-300 bg-amber-50/70'
            : 'border-wc-gold/50 bg-wc-gold/5'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base">🏆</span>
                <p className="text-[11px] font-black uppercase tracking-widest text-wc-gold">
                  Campeón de Prode
                </p>
              </div>
              <p className="text-[9px] text-gray-400 mb-1.5 leading-tight">
                El #1 de {result.sample_size.toLocaleString()} jugadores por aciertos en los {leader.total} partidos ya jugados
              </p>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-lg">{leaderMeta.emoji}</span>
                <span className="text-sm font-bold text-wc-navy">{leaderMeta.label}</span>
                <PlayerNum id={leader.id} />
                {result.contrarian_signal > 0.15 && (
                  <span className="text-[10px] font-semibold text-amber-600 ml-1">⚡ va contra la mayoría</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400">{leaderMeta.desc}</p>
            </div>
            {leaderAcc !== null && (
              <div className="text-right shrink-0 space-y-0.5">
                <p className="text-xl font-black tabular-nums text-wc-navy leading-none">
                  {leader.correct}<span className="text-sm font-normal text-gray-400">/{leader.total}</span>
                </p>
                <p className="text-[10px] text-gray-400 tabular-nums">{pctInt(leaderAcc)} aciertos</p>
                {leader.exactCorrect >= 0.5 && (
                  <p className="text-xs font-bold text-purple-700 tabular-nums">
                    {Math.round(leader.exactCorrect * 10) / 10} exactos 🎯
                  </p>
                )}
              </div>
            )}
          </div>

          {/* El pronóstico del campeón para ESTE partido */}
          <div className="flex items-center gap-3 mt-1 pt-3 border-t border-wc-gold/40">
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
                Su pronóstico
              </p>
              <p className={`text-base font-black ${pickColor(leader.pick)}`}>
                {pickLabel(leader.pick, homeName, awayName)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Marcador</p>
              <p className="text-2xl font-black tabular-nums text-wc-navy leading-none">
                {leader.pickScore.home} – {leader.pickScore.away}
              </p>
            </div>
          </div>

          {/* Relación con el consenso del torneo */}
          <div className="mt-2 pt-2 border-t border-wc-gold/40">
            <p className="text-[10px] text-gray-400">
              Consenso top-{result.consensus_k}:{' '}
              <span className={`font-semibold ${pickColor(result.most_probable_pick)}`}>
                {pickLabel(result.most_probable_pick, homeName, awayName)}
              </span>
              {' · '}
              <span className="font-semibold text-wc-navy">
                {Math.round(result.leader_support * result.consensus_k)}/{result.consensus_k}
              </span> de los mejores coinciden
            </p>
          </div>
        </section>

        {/* LOO accuracy — honest out-of-sample model performance */}
        {(looWinnerAcc || looExactAcc) && (
          <section className="rounded-xl border border-wc-navy/10 bg-wc-navy/3 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Eficacia real del modelo · leave-one-out
            </p>
            <p className="text-[9px] text-gray-300 leading-tight">
              Evaluado partido a partido sin ver el propio resultado — métrica honesta fuera de muestra
            </p>
            <div className="flex gap-4 pt-0.5">
              {looWinnerAcc && (
                <div>
                  <p className="text-base font-black tabular-nums text-wc-navy leading-none">
                    {looWinnerAcc.correct}
                    <span className="text-xs font-normal text-gray-400">/{looWinnerAcc.total}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">dirección ✓</p>
                </div>
              )}
              {looExactAcc && (
                <div>
                  <p className="text-base font-black tabular-nums text-purple-700 leading-none">
                    {looExactAcc.correct}
                    <span className="text-xs font-normal text-gray-400">/{looExactAcc.total}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">marcador exacto 🎯</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Competition table */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Top {leaderboard.length} · torneo
          </p>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="py-1.5 pl-4 pr-1 text-left text-[10px] text-gray-400 font-medium w-5">#</th>
                  <th className="py-1.5 px-1 text-[10px] text-gray-400 font-medium"></th>
                  <th className="py-1.5 px-1 text-left text-[10px] text-gray-400 font-medium">ID</th>
                  <th className="py-1.5 px-1 text-right text-[10px] text-gray-400 font-medium">Win</th>
                  <th className="py-1.5 px-1 text-right text-[10px] text-purple-400 font-medium">Exact</th>
                  <th className="py-1.5 pl-1 pr-4 text-right text-[10px] text-gray-400 font-medium">Pronóst.</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => (
                  <LeaderboardRow
                    key={entry.id}
                    entry={entry}
                    isLeader={entry.rank === 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            L = Local · E = Empate · V = Visitante
          </p>
        </section>

        {/* Consensus distribution */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Probabilidades del consenso · top-{result.consensus_k}
          </p>
          <div className="space-y-1.5">
            <MiniBar home={cp.home} draw={cp.draw} away={cp.away} />
            <div className="grid grid-cols-3 text-center text-xs">
              <div>
                <div className={`font-semibold ${consensusModal === 'Home' ? 'text-wc-navy' : 'text-gray-500'} truncate`}>{homeName}</div>
                <div className="tabular-nums text-gray-600">{pct(cp.home)}</div>
              </div>
              <div>
                <div className={`font-semibold ${consensusModal === 'Draw' ? 'text-gray-700' : 'text-gray-400'}`}>Empate</div>
                <div className="tabular-nums text-gray-600">{pct(cp.draw)}</div>
              </div>
              <div>
                <div className={`font-semibold ${consensusModal === 'Away' ? 'text-wc-red' : 'text-gray-500'} truncate`}>{awayName}</div>
                <div className="tabular-nums text-gray-600">{pct(cp.away)}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Elite vs crowd */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Consenso (top {result.consensus_k})</p>
            <p className={`text-sm font-bold ${pickColor(consensusModal)} truncate`}>
              {pickLabel(consensusModal, homeName, awayName)}
            </p>
            <p className="text-[10px] tabular-nums text-gray-400">{pct(Math.max(cp.home, cp.draw, cp.away))}</p>
          </div>
          <div className={`rounded-xl border p-3 ${
            result.elite_pick !== consensusModal ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-gray-50'
          }`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Élite (top 10%)</p>
            <p className={`text-sm font-bold ${pickColor(result.elite_pick)} truncate`}>
              {pickLabel(result.elite_pick, homeName, awayName)}
            </p>
            <p className="text-[10px] tabular-nums text-gray-400">
              {pct(Math.max(ep.home, ep.draw, ep.away))}
            </p>
          </div>
        </section>

        {/* Archetype accuracy */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Rendimiento por arquetipo
          </p>
          <div className="space-y-1.5">
            {(Object.entries(result.archetype_avg_reps) as [ArchetypeId, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([arc, avg]) => {
                const { emoji, label } = ARCHETYPE_META[arc];
                const maxVal = Math.max(...Object.values(result.archetype_avg_reps));
                const barW = maxVal > 0 ? (avg / maxVal) * 100 : 0;
                const isLeaderArch = arc === result.dominant_archetype;
                return (
                  <div key={arc} className="flex items-center gap-2">
                    <span className="w-5 text-sm shrink-0">{emoji}</span>
                    <div className={`w-20 text-[10px] shrink-0 truncate ${isLeaderArch ? 'font-bold text-wc-navy' : 'text-gray-500'}`}>
                      {label}
                    </div>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isLeaderArch ? 'bg-wc-navy' : 'bg-wc-navy/40'}`}
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-gray-400 w-10 text-right shrink-0">
                      {avg > 0 ? pctInt(avg) : '—'}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>

      </div>
    </div>
  );
}
