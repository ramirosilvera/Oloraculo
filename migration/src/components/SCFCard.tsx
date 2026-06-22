// =============================================================================
// SCFCard — Corazón Futbolero
// Veredicto colectivo + Prode interno con 6 jugadores virtuales.
// El jugador con más aciertos en partidos anteriores es el "líder del prode"
// y su pronóstico para este partido se destaca como la mejor apuesta.
// =============================================================================

import type { SCFResult, ActiveHeuristic, ProdeStanding } from '../types/scf';
import { PRODE_PLAYERS, computePlayerPick } from '../engine/scf/prode';

interface SCFCardProps {
  result: SCFResult;
  homeName: string;
  awayName: string;
  standings: ProdeStanding[];
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------
function confLabel(prob: number): { label: string; color: string; bg: string; border: string } {
  if (prob >= 0.65) return { label: 'Alta',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (prob >= 0.50) return { label: 'Moderada', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   };
  return              { label: 'Baja',          color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200'  };
}

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
// Synthesis
// ---------------------------------------------------------------------------
function generateSCFSynthesis(result: SCFResult, homeName: string, awayName: string): string {
  const { homeWin, draw, awayWin } = result.outcome;
  const score = result.scf_score;

  const pick = homeWin > awayWin && homeWin > draw ? 'home'
             : awayWin > homeWin && awayWin > draw ? 'away' : 'draw';
  const pickName = pick === 'home' ? homeName : pick === 'away' ? awayName : 'empate';
  const pickPct  = Math.round((pick === 'home' ? homeWin : pick === 'away' ? awayWin : draw) * 100);

  const topSignal  = result.top_heuristics.find(h => !h.isBias);
  const biasSignal = result.top_heuristics.find(h => h.isBias);

  let verdict: string;
  if (score >= 68 || score <= 32) {
    verdict = `La intuición colectiva empuja fuerte a ${pickName} (${pickPct}%).`;
  } else if (score >= 58 || score <= 42) {
    verdict = `El corazón futbolero se inclina por ${pickName} (${pickPct}%), sin convicción plena.`;
  } else {
    verdict = `Sin consenso claro — señales contrapuestas se anulan.`;
  }

  const reasonPart = topSignal ? ` Señal clave: ${topSignal.name.toLowerCase()}.` : '';
  const biasPart   = biasSignal && result.bias_count >= 1
    ? ` Sesgo: ${biasSignal.name.toLowerCase()} — peso reducido.`
    : '';

  return verdict + reasonPart + biasPart;
}

// ---------------------------------------------------------------------------
// Prode section
// ---------------------------------------------------------------------------
function ProdeSection({
  outcome,
  fixtureId,
  standings,
  homeName,
  awayName,
}: {
  outcome: { homeWin: number; draw: number; awayWin: number };
  fixtureId: string;
  standings: ProdeStanding[];
  homeName: string;
  awayName: string;
}) {
  // Merge standings (sorted by correct desc) with current picks
  const hasHistory = standings.length > 0 && standings[0].total > 0;

  const rows = (hasHistory ? standings : PRODE_PLAYERS.map(p => ({ player: p, correct: 0, total: 0 }))).map(
    (s, idx) => ({
      ...s,
      currentPick: computePlayerPick(s.player, outcome, fixtureId),
      isLeader: hasHistory && idx === 0,
    }),
  );

  const gamesPlayed = hasHistory ? standings[0].total : 0;

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-3 py-1.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Prode interno</span>
        {gamesPlayed > 0 ? (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {gamesPlayed} partido{gamesPlayed !== 1 ? 's' : ''} jugado{gamesPlayed !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[10px] text-gray-300 italic">sin historial aún</span>
        )}
      </div>

      {rows.map(({ player, correct, total, currentPick, isLeader }) => {
        const pick = currentPick.pick;
        const pickLabel = pick === 'Home' ? 'L' : pick === 'Away' ? 'V' : 'E';
        const pickName  = pick === 'Home' ? homeName : pick === 'Away' ? awayName : 'Empate';
        const pickColor = pick === 'Home' ? 'text-wc-navy font-black'
                        : pick === 'Away' ? 'text-wc-red font-black'
                        : 'text-gray-600 font-black';

        return (
          <div
            key={player.id}
            className={`flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0 transition-colors ${
              isLeader ? 'bg-amber-50/70' : 'hover:bg-gray-50/60'
            }`}
          >
            {/* Leader star or spacer */}
            {isLeader
              ? <span className="text-amber-400 text-[10px] shrink-0">★</span>
              : <span className="w-3 shrink-0" />}

            {/* Emoji */}
            <span className="text-base leading-none shrink-0">{player.emoji}</span>

            {/* Name */}
            <span className={`min-w-0 flex-1 truncate ${isLeader ? 'font-bold text-amber-800' : 'font-medium text-gray-600'}`}>
              {player.name}
            </span>

            {/* Record */}
            {total > 0 ? (
              <span className={`tabular-nums text-[10px] shrink-0 ${isLeader ? 'font-bold text-amber-700' : 'text-gray-400'}`}>
                {correct}/{total}
              </span>
            ) : (
              <span className="text-gray-300 text-[10px] shrink-0">—</span>
            )}

            {/* Pick label */}
            <span className={`${pickColor} text-sm w-4 text-center shrink-0`}>{pickLabel}</span>

            {/* Pick name — truncated */}
            <span className={`text-[10px] truncate max-w-[52px] shrink-0 ${isLeader ? 'text-amber-700' : 'text-gray-400'}`}>
              {pickName}
            </span>

            {/* Score */}
            {currentPick.score ? (
              <span className="text-gray-300 tabular-nums text-[10px] font-mono w-7 text-right shrink-0">
                {currentPick.score.home}-{currentPick.score.away}
              </span>
            ) : (
              <span className="w-7 shrink-0" />
            )}
          </div>
        );
      })}

      {/* Leader call-out */}
      {hasHistory && rows[0] && (
        <div className="px-3 py-2 bg-amber-50/50 border-t border-amber-100 flex items-center gap-1.5">
          <span className="text-amber-400 text-[10px]">★</span>
          <span className="text-[10px] text-amber-700 font-semibold">
            Mejor pronosticador: {rows[0].player.name} ({rows[0].correct}/{rows[0].total})
            {' — '}pronóstico líder:{' '}
            <span className="font-black">
              {rows[0].currentPick.pick === 'Home' ? homeName
               : rows[0].currentPick.pick === 'Away' ? awayName
               : 'Empate'}
              {rows[0].currentPick.score
                ? ` ${rows[0].currentPick.score.home}-${rows[0].currentPick.score.away}`
                : ''}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SCFCard({ result, homeName, awayName, standings, onClose }: SCFCardProps) {
  if (result.degraded) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <div className="flex items-center gap-1.5">
            <span className="text-base leading-none">❤️</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-wc-navy shrink-0">CF</span>
            <span className="text-xs font-bold text-gray-800">Corazón Futbolero</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="shrink-0 ml-2 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-sm leading-none">✕</button>
          )}
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
  const pickProb  = pick === 'Home' ? homeWin : pick === 'Away' ? awayWin : draw;
  const pickTeam  = pick === 'Home' ? homeName : pick === 'Away' ? awayName : 'Empate';
  const pickColor = pick === 'Home' ? 'text-wc-navy' : pick === 'Away' ? 'text-wc-red' : 'text-gray-700';
  const conf = confLabel(pickProb);

  const nonBiasHints = result.top_heuristics.filter((h: ActiveHeuristic) => !h.isBias).slice(0, 2);
  const biasHints    = result.top_heuristics.filter((h: ActiveHeuristic) => h.isBias).slice(0, 1);
  const synthesis    = generateSCFSynthesis(result, homeName, awayName);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-base leading-none shrink-0">❤️</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-wc-navy shrink-0">CF</span>
          <span className="text-xs font-bold text-gray-800 truncate">Corazón Futbolero</span>
          <span className="text-[10px] text-gray-400 truncate hidden sm:block">· heurísticas + prode</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-gray-300 tabular-nums">{result.scf_score.toFixed(0)}/100</span>
          {onClose && (
            <button onClick={onClose} aria-label="Cerrar" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-sm leading-none">✕</button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-3 space-y-2.5">

        {/* ── Zone 1: Veredicto ── */}
        <div className={`rounded-xl border ${conf.border} ${conf.bg} px-3 py-3 space-y-2`}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-sm font-black ${pickColor}`}>{pickTeam}</span>
            <span className="text-3xl font-black text-gray-900 tabular-nums leading-none">
              {Math.round(pickProb * 100)}%
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${conf.color}`}>
              {conf.label}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <MiniBar home={homeWin} draw={draw} away={awayWin} />
            <span className="font-bold text-wc-navy">L {Math.round(homeWin * 100)}%</span>
            <span className="text-gray-300">·</span>
            <span className="font-bold">E {Math.round(draw * 100)}%</span>
            <span className="text-gray-300">·</span>
            <span className="font-bold text-wc-red">V {Math.round(awayWin * 100)}%</span>
            {result.mostLikelyScore && (
              <>
                <span className="text-gray-300">|</span>
                <span className="font-mono font-bold text-gray-600 tracking-tight">
                  {result.mostLikelyScore.home}-{result.mostLikelyScore.away}
                </span>
              </>
            )}
          </div>

          <p className="text-xs text-gray-700 leading-relaxed border-t border-black/5 pt-2">
            {synthesis}
          </p>
        </div>

        {/* ── Zone 2: Prode interno ── */}
        <ProdeSection
          outcome={{ homeWin, draw, awayWin }}
          fixtureId={result.fixture_id}
          standings={standings}
          homeName={homeName}
          awayName={awayName}
        />

        {/* ── Zone 3: Señales activas ── */}
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

        {/* ── Zone 4: Alertas de sesgo ── */}
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
