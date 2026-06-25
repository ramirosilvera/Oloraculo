// =============================================================================
// Oloráculo — KnockoutActivationButton
// Shows group-stage completion status and lets the user signal Claude to
// generate the knockout bracket. Writes to Supabase `app_events` table.
// =============================================================================

import { useState, useMemo } from 'react';
import { Trophy, X, CheckCircle2, AlertTriangle, Copy, Send, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { Fixture, Team, WcActualResult } from '../types/domain';
import { calculateGroupStandings, rankThirdPlaceTeams } from '../utils/standings';
import { writeAppEvent } from '../services/supabase-client';

interface Props {
  fixtures: Fixture[];
  wcPlayedMap: Map<string, WcActualResult>;
  teamMap: Map<string, Team>;
}

const GROUP_TOTAL = 72;

export function KnockoutActivationButton({ fixtures, wcPlayedMap, teamMap }: Props) {
  const [open, setOpen]             = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [sending, setSending]       = useState(false);
  const [sent, setSent]             = useState(false);
  const [sendError, setSendError]   = useState('');
  const [copied, setCopied]         = useState(false);

  const groupFixtures = useMemo(
    () => fixtures.filter(f => !f.id.startsWith('ko:')),
    [fixtures],
  );

  const playedCount = useMemo(
    () => groupFixtures.filter(f => wcPlayedMap.has(f.id)).length,
    [groupFixtures, wcPlayedMap],
  );

  const allDone = playedCount >= GROUP_TOTAL;
  const pending = GROUP_TOTAL - playedCount;
  const pct = Math.round((playedCount / GROUP_TOTAL) * 100);

  const name = (id: string) => teamMap.get(id)?.name ?? id;

  // Build standings from Supabase results (authoritative) merged into fixtures
  const mergedFixtures = useMemo(() => groupFixtures.map(f => {
    const r = wcPlayedMap.get(f.id);
    if (!r) return f;
    return { ...f, is_played: true, home_goals: r.home_goals, away_goals: r.away_goals };
  }), [groupFixtures, wcPlayedMap]);

  const standings = useMemo(
    () => calculateGroupStandings(mergedFixtures),
    [mergedFixtures],
  );

  const bestThirds = useMemo(
    () => rankThirdPlaceTeams(standings, 8),
    [standings],
  );

  async function handleSendSignal() {
    setSending(true);
    setSendError('');
    try {
      await writeAppEvent('KNOCKOUT_ACTIVATION_REQUESTED', {
        requestedAt: new Date().toISOString(),
        playedCount,
        standings: Object.fromEntries(
          Object.entries(standings).map(([g, rows]) => [
            g,
            rows.map(r => ({ teamId: r.teamId, pts: r.points, gd: r.goalDiff, gf: r.goalsFor })),
          ]),
        ),
        bestThirds: bestThirds.map(t => ({
          teamId: t.teamId,
          group: t.groupName,
          pts: t.points,
          gd: t.goalDiff,
          gf: t.goalsFor,
        })),
      });
      setSent(true);
    } catch (e) {
      setSendError((e as Error).message ?? 'Error al enviar');
    } finally {
      setSending(false);
    }
  }

  function copyText() {
    const groups = 'ABCDEFGHIJKL'.split('');
    // Correct R32 pairings — official FIFA WC 2026 draw
    // Format: [matchId, homeSlot, awaySlot]  ('T3(X/Y/Z)' = best third from those groups)
    const R32: [string, string, string][] = [
      ['M73', '2A', '2B'],
      ['M74', '1E', 'T3(A/B/C/D/F)'],
      ['M75', '1F', '2C'],
      ['M76', '1C', '2F'],
      ['M77', '1I', 'T3(C/D/F/G/H)'],
      ['M78', '2E', '2I'],
      ['M79', '1A', 'T3(C/E/F/H/I)'],
      ['M80', '1L', 'T3(E/H/I/J/K)'],
      ['M81', '1D', 'T3(B/E/F/I/J)'],
      ['M82', '1G', 'T3(A/E/H/I/J)'],
      ['M83', '2K', '2L'],
      ['M84', '1H', '2J'],
      ['M85', '1B', 'T3(E/F/G/I/J)'],
      ['M86', '1J', '2H'],
      ['M87', '1K', 'T3(D/E/I/J/L)'],
      ['M88', '2D', '2G'],
    ];
    function resolveSlotName(slot: string): string {
      const m = slot.match(/^([12])([A-L])$/);
      if (!m) return slot; // T3 label — pass through
      const teamId = standings[m[2]]?.[parseInt(m[1]) - 1]?.teamId;
      return teamId ? name(teamId) : slot;
    }
    const lines = ['=== ACTIVAR KNOCKOUT WC 2026 ===', ''];
    lines.push('R32 CRUCES:');
    for (const [id, hl, al] of R32) {
      lines.push(`  ${id}: ${hl}(${resolveSlotName(hl)}) vs ${al}(${resolveSlotName(al)})`);
    }
    lines.push('', 'POSICIONES FINALES:');
    for (const g of groups) {
      const s = standings[g];
      if (!s) continue;
      lines.push(`  Grupo ${g}: 1º${name(s[0]?.teamId??'')}  2º${name(s[1]?.teamId??'')}  3º${name(s[2]?.teamId??'')}(${s[2]?.points}pts ${(s[2]?.goalDiff??0)>=0?'+':''}${s[2]?.goalDiff??0}GD)`);
    }
    lines.push('', 'MEJORES 8 TERCEROS:');
    bestThirds.forEach((t, i) =>
      lines.push(`  ${i+1}. [${t.groupName}] ${name(t.teamId)} — ${t.points}pts ${t.goalDiff>=0?'+':''}${t.goalDiff}GD ${t.goalsFor}GF`),
    );
    lines.push('', '→ Verificar slots T3 (M74,M77,M79,M80,M81,M82,M85,M87) con tabla FIFA Anexo C y llamar generateKnockoutFixtures().');
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      {/* ── Trigger pill ─────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-left transition-all
          ${allDone
            ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
          }`}
      >
        <Trophy className={`w-4 h-4 shrink-0 ${allDone ? 'text-amber-500' : 'text-gray-400'}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${allDone ? 'text-amber-700' : 'text-gray-600'}`}>
            {allDone ? '¡Fase de grupos completada!' : 'Fase de Eliminación'}
          </p>
          <p className="text-[10px] text-gray-400">
            {allDone
              ? 'Presioná para activar el bracket de knockout'
              : `${playedCount}/${GROUP_TOTAL} partidos completados · ${pending} pendientes`}
          </p>
        </div>
        <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0
          ${allDone ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
          {pct}%
        </div>
      </button>

      {/* ── Modal ───────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className={`px-5 py-4 flex items-center justify-between shrink-0
              ${allDone ? 'bg-amber-500' : 'bg-gray-700'}`}>
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-white" />
                <span className="font-bold text-white text-sm">Activar Fase de Eliminación</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* ── Status ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700">Partidos de grupos</span>
                  <span className="font-bold text-gray-900">{playedCount}/{GROUP_TOTAL}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${allDone ? 'bg-amber-500' : 'bg-blue-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {allDone ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">¡Todos los grupos terminaron! Podés activar el bracket.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      <span className="font-bold">Fase de grupos incompleta.</span>{' '}
                      Faltan {pending} partido{pending !== 1 ? 's' : ''}.
                      Podés enviar la señal igual para reservar el request.
                    </span>
                  </div>
                )}
              </div>

              {/* ── Standings toggle ── */}
              {playedCount > 0 && (
                <div>
                  <button
                    onClick={() => setStandingsOpen(v => !v)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-gray-600 hover:text-gray-800 py-1.5"
                  >
                    <span>Posiciones actuales</span>
                    {standingsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {standingsOpen && (
                    <div className="rounded-xl border border-gray-100 overflow-hidden text-[11px]">
                      {('ABCDEFGHIJKL'.split('') as string[]).map(g => {
                        const s = standings[g];
                        if (!s || s.length < 2) return null;
                        return (
                          <div key={g} className="px-3 py-1.5 even:bg-gray-50 flex items-baseline gap-2">
                            <span className="font-bold text-gray-500 w-5 shrink-0">Grp {g}</span>
                            <span className="flex-1 truncate text-gray-800">
                              <span className="font-semibold">{name(s[0]?.teamId ?? '')}</span>
                              <span className="text-gray-400"> · {name(s[1]?.teamId ?? '')}</span>
                              {s[2] && <span className="text-gray-300"> · {name(s[2].teamId)}</span>}
                            </span>
                            <span className="text-gray-400 shrink-0">{s[0]?.points}pts</span>
                          </div>
                        );
                      })}
                      {bestThirds.length > 0 && (
                        <div className="px-3 py-2 bg-blue-50 border-t border-blue-100">
                          <p className="font-bold text-blue-700 mb-1">Mejores 8 terceros:</p>
                          {bestThirds.map((t, i) => (
                            <div key={t.teamId} className="flex items-center gap-1.5">
                              <span className="text-blue-400 w-3">{i+1}.</span>
                              <span className="font-medium text-blue-800">{name(t.teamId)}</span>
                              <span className="text-blue-400">[{t.groupName}]</span>
                              <span className="ml-auto text-blue-600">{t.points}pts {t.goalDiff >= 0 ? '+' : ''}{t.goalDiff}GD</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Explanation ── */}
              <div className="text-[11px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5 space-y-1">
                <p className="font-semibold text-gray-700">¿Qué hace esto?</p>
                <p>Envía una señal a Supabase que Claude detecta al iniciar la próxima sesión.</p>
                <p>Claude calculará los clasificados, pedirá la tabla oficial de FIFA para los 8 slots de terceros (M74,M77,M79,M80,M81,M82,M85,M87), y generará los 32 fixtures del bracket.</p>
              </div>

            </div>

            {/* ── Footer actions ── */}
            <div className="px-5 py-4 border-t border-gray-100 flex gap-2 shrink-0">
              <button
                onClick={copyText}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? '¡Copiado!' : 'Copiar datos'}
              </button>

              <button
                onClick={handleSendSignal}
                disabled={sending || sent}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all
                  ${sent
                    ? 'bg-green-100 text-green-700 border border-green-200 cursor-default'
                    : 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm active:scale-95'
                  }`}
              >
                {sending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…</>
                ) : sent ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Señal enviada — Claude la procesará</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Activar knockout</>
                )}
              </button>
            </div>
            {sendError && (
              <p className="px-5 pb-3 text-[11px] text-red-600">{sendError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
