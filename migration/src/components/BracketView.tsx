import { useState, useMemo } from 'react';
import { Trophy, ChevronDown } from 'lucide-react';
import { FlagImg } from './ui';
import type { Team, TournamentProjection, Fixture } from '../types/domain';

// ─── Real dates from knockout-fixtures.json (ART), shown per round ────────────
function artDateShort(utc?: string | null): string | null {
  if (!utc) return null;
  return new Date(utc).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires',
  });
}
function roundDateRange(koByNum: Map<number, string>, from: number, to: number): string {
  const ds: string[] = [];
  for (let n = from; n <= to; n++) { const k = koByNum.get(n); if (k) ds.push(k); }
  if (!ds.length) return '';
  ds.sort();
  const a = artDateShort(ds[0]);
  const b = artDateShort(ds[ds.length - 1]);
  return a === b ? (a ?? '') : `${a} – ${b}`;
}

// ─── Layout constants ────────────────────────────────────────────────────────
const CARD_W   = 78;          // px — card width
const CARD_H   = 36;          // px — card height (2 rows × 18px)
const SLOT_H   = 46;          // px — slot height per R32 match
const CONN_W   = 18;          // px — SVG connector column width
const LABEL_H  = 20;          // px — round label row height
const LINE_CLR = 'rgba(255,255,255,0.3)';
const TOTAL_H  = 8 * SLOT_H; // 368px — total bracket height (8 R32 slots per side)

// ─── Butterfly bracket match groups ──────────────────────────────────────────
// Left half → SF101 → Final; right half → SF102 → Final.
// Adjacent pairs in each array feed the same next-round match.

// Left half (feeds SF101)
// R32 pairs: (73,75)→M90  (74,77)→M89  (81,82)→M94  (83,84)→M93
const LEFT_R32  = [73, 75, 74, 77, 81, 82, 83, 84];
// R16 pairs: (90,89)→M97  (94,93)→M99
const LEFT_R16  = [90, 89, 94, 93];
// QF pair: (97,99)→M101
const LEFT_QF   = [97, 99];
const LEFT_SF   = [101];

// Right half (feeds SF102)
const RIGHT_SF  = [102];
// QF pair: (98,100)→M102
const RIGHT_QF  = [98, 100];
// R16 pairs: (91,92)→M98  (96,95)→M100
const RIGHT_R16 = [91, 92, 96, 95];
// R32 pairs: (76,78)→M91  (79,80)→M92  (85,87)→M96  (86,88)→M95
const RIGHT_R32 = [76, 78, 79, 80, 85, 87, 86, 88];

const FINAL_ID  = 104;

// ─── Slot labels ─────────────────────────────────────────────────────────────
const SLOT_LABELS: Record<number, [string, string]> = {
  73: ['2A','2B'],  74: ['1E','T3'],   75: ['1F','2C'],  76: ['1C','2F'],
  77: ['1I','T3'],  78: ['2E','2I'],   79: ['1A','T3'],  80: ['1L','T3'],
  81: ['1D','T3'],  82: ['1G','T3'],   83: ['2K','2L'],  84: ['1H','2J'],
  85: ['1B','T3'],  86: ['1J','2H'],   87: ['1K','T3'],  88: ['2D','2G'],
  89: ['W74','W77'], 90: ['W73','W75'], 91: ['W76','W78'], 92: ['W79','W80'],
  93: ['W83','W84'], 94: ['W81','W82'], 95: ['W86','W88'], 96: ['W85','W87'],
  97: ['W89','W90'], 98: ['W91','W92'], 99: ['W93','W94'], 100: ['W95','W96'],
  101: ['W97','W99'], 102: ['W98','W100'],
  104: ['W101','W102'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shortCode(name: string): string {
  const w = name.split(/[\s\-]/);
  return (w.length >= 2 ? w.map(s => s[0]).join('') : name).slice(0, 3).toUpperCase();
}

function getSlotTeams(
  matchId: number,
  occ: Record<number, Record<string, number>> | undefined,
  sims: number,
): { teamId: string; freq: number }[] {
  if (!occ?.[matchId] || sims === 0) return [];
  return Object.entries(occ[matchId])
    .map(([teamId, count]) => ({ teamId, freq: count / sims }))
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 2);
}

// ─── MiniTeamRow ─────────────────────────────────────────────────────────────
function MiniTeamRow({
  teamId, label, winProb, highlighted, teamMap,
}: {
  teamId?: string;
  label: string;
  winProb?: number;
  highlighted: boolean;
  teamMap: Map<string, Team>;
}) {
  const team = teamId ? teamMap.get(teamId) : undefined;
  const tooltip = team
    ? `${team.name}${winProb != null ? ` — ${(winProb * 100).toFixed(1)}% de ganar el torneo` : ''}`
    : label;
  return (
    <div
      title={tooltip}
      className={`flex items-center gap-[3px] px-[5px] select-none ${
        highlighted ? 'bg-amber-50' : ''
      }`}
      style={{ height: 18 }}
    >
      {team ? (
        <>
          <FlagImg
            id={teamId!}
            className="shrink-0 object-cover rounded-[1px] w-4 h-[10px]"
          />
          <span
            className={`flex-1 truncate leading-none font-bold tracking-tight ${
              highlighted ? 'text-amber-700' : 'text-gray-700'
            }`}
            style={{ fontSize: 9 }}
          >
            {shortCode(team.name)}
          </span>
          {winProb != null && (
            <span
              className={`tabular-nums shrink-0 leading-none ${
                highlighted ? 'text-amber-600 font-bold' : 'text-gray-400'
              }`}
              style={{ fontSize: 8 }}
            >
              {(winProb * 100).toFixed(0)}
            </span>
          )}
        </>
      ) : (
        <span className="italic truncate text-gray-300 leading-none" style={{ fontSize: 8 }}>
          {label}
        </span>
      )}
    </div>
  );
}

// ─── MiniCard ────────────────────────────────────────────────────────────────
function MiniCard({
  matchId, slotTeams, projMap, highlightTeamId, teamMap,
}: {
  matchId: number;
  slotTeams: { teamId: string; freq: number }[];
  projMap: Map<string, { winTournament: number }>;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
}) {
  const [homeSlot, awaySlot] = [slotTeams[0], slotTeams[1]];
  const [hLabel, aLabel] = SLOT_LABELS[matchId] ?? ['?', '?'];
  const hHi = !!homeSlot && homeSlot.teamId === highlightTeamId;
  const aHi = !!awaySlot && awaySlot.teamId === highlightTeamId;

  return (
    <div
      className={`rounded border overflow-hidden shrink-0 bg-white ${
        hHi || aHi ? 'border-amber-400 shadow-[0_0_0_1px_#f59e0b]' : 'border-gray-200'
      }`}
      style={{ width: CARD_W, height: CARD_H }}
    >
      <MiniTeamRow
        teamId={homeSlot?.teamId}
        label={hLabel}
        winProb={homeSlot ? projMap.get(homeSlot.teamId)?.winTournament : undefined}
        highlighted={hHi}
        teamMap={teamMap}
      />
      <div className="border-t border-gray-100" />
      <MiniTeamRow
        teamId={awaySlot?.teamId}
        label={aLabel}
        winProb={awaySlot ? projMap.get(awaySlot.teamId)?.winTournament : undefined}
        highlighted={aHi}
        teamMap={teamMap}
      />
    </div>
  );
}

// ─── ConnectorSvg ─────────────────────────────────────────────────────────────
// Draws `pairs` L-connectors. flipped=true mirrors horizontally (for right half).
// Each pair occupies 2 × srcSlotH px vertically.
function ConnectorSvg({
  pairs, srcSlotH, flipped = false,
}: {
  pairs: number;
  srcSlotH: number;
  flipped?: boolean;
}) {
  const h  = pairs * 2 * srcSlotH;
  const mx = CONN_W / 2;
  return (
    <svg width={CONN_W} height={h} className="shrink-0" style={{ display: 'block' }}>
      {Array.from({ length: pairs }, (_, i) => {
        const topY = (i * 2 + 0.5) * srcSlotH;
        const botY = (i * 2 + 1.5) * srcSlotH;
        const midY = (i * 2 + 1.0) * srcSlotH;
        return flipped ? (
          <g key={i} stroke={LINE_CLR} strokeWidth={1} fill="none">
            <line x1={CONN_W} y1={topY} x2={mx}     y2={topY} />
            <line x1={mx}     y1={topY} x2={mx}     y2={botY} />
            <line x1={CONN_W} y1={botY} x2={mx}     y2={botY} />
            <line x1={mx}     y1={midY} x2={0}      y2={midY} />
          </g>
        ) : (
          <g key={i} stroke={LINE_CLR} strokeWidth={1} fill="none">
            <line x1={0}   y1={topY} x2={mx}     y2={topY} />
            <line x1={mx}  y1={topY} x2={mx}     y2={botY} />
            <line x1={0}   y1={botY} x2={mx}     y2={botY} />
            <line x1={mx}  y1={midY} x2={CONN_W} y2={midY} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── StraightConnector ────────────────────────────────────────────────────────
// Horizontal line connecting SF to the center Final card.
function StraightConnector({ flipped = false }: { flipped?: boolean }) {
  const midY = TOTAL_H / 2;
  return (
    <svg
      width={CONN_W}
      height={TOTAL_H}
      className="shrink-0"
      style={{ display: 'block', marginTop: LABEL_H }}
    >
      <line
        x1={flipped ? CONN_W : 0}
        y1={midY}
        x2={flipped ? 0 : CONN_W}
        y2={midY}
        stroke={LINE_CLR}
        strokeWidth={1}
      />
    </svg>
  );
}

// ─── RoundColumn ─────────────────────────────────────────────────────────────
function RoundColumn({
  label, dateLabel, matchIds, slotH, occ, sims, projMap, highlightTeamId, teamMap,
}: {
  label: string;
  dateLabel?: string;
  matchIds: number[];
  slotH: number;
  occ: Record<number, Record<string, number>> | undefined;
  sims: number;
  projMap: Map<string, { winTournament: number }>;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
}) {
  return (
    <div className="shrink-0 flex flex-col" style={{ width: CARD_W }}>
      <div
        className="text-center font-bold text-blue-300 uppercase tracking-widest"
        style={{ height: LABEL_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
      >
        <span style={{ fontSize: 8 }}>{label}</span>
        {dateLabel && (
          <span style={{ fontSize: 6, fontWeight: 400, color: 'rgba(147,197,253,0.6)', marginTop: 1 }}>
            {dateLabel}
          </span>
        )}
      </div>
      {matchIds.map(id => (
        <div
          key={id}
          className="flex items-center justify-center"
          style={{ height: slotH }}
        >
          <MiniCard
            matchId={id}
            slotTeams={getSlotTeams(id, occ, sims)}
            projMap={projMap}
            highlightTeamId={highlightTeamId}
            teamMap={teamMap}
          />
        </div>
      ))}
    </div>
  );
}

// ─── FinalCenter ─────────────────────────────────────────────────────────────
// Center column: trophy icon, label, and Final match card — all vertically centered.
function FinalCenter({
  occ, sims, projMap, highlightTeamId, teamMap, finalLine,
}: {
  occ: Record<number, Record<string, number>> | undefined;
  sims: number;
  projMap: Map<string, { winTournament: number }>;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
  finalLine?: string;
}) {
  return (
    <div
      className="shrink-0 flex flex-col items-center"
      style={{ width: CARD_W + 28, height: TOTAL_H + LABEL_H }}
    >
      <div style={{ height: LABEL_H }} />
      <div className="flex-1 flex flex-col items-center justify-center gap-1">
        <Trophy className="w-5 h-5 text-yellow-400" />
        <div
          className="text-center font-bold text-white uppercase tracking-widest leading-tight"
          style={{ fontSize: 7 }}
        >
          Final
        </div>
        {finalLine && (
          <div
            className="text-center leading-tight"
            style={{ fontSize: 6.5, color: 'rgba(255,255,255,0.55)' }}
          >
            {finalLine}
          </div>
        )}
        <div className="mt-0.5">
          <MiniCard
            matchId={FINAL_ID}
            slotTeams={getSlotTeams(FINAL_ID, occ, sims)}
            projMap={projMap}
            highlightTeamId={highlightTeamId}
            teamMap={teamMap}
          />
        </div>
      </div>
    </div>
  );
}

// ─── BracketView ─────────────────────────────────────────────────────────────
export interface BracketViewProps {
  projection: TournamentProjection | null;
  teamMap: Map<string, Team>;
  highlightTeamId?: string;
  koFixtures?: Fixture[];   // knockout-fixtures.json — real FIFA dates/venues
}

export function BracketView({ projection, teamMap, highlightTeamId, koFixtures }: BracketViewProps) {
  const [open, setOpen] = useState(false);

  const occ  = projection?.slotOccupancy;
  const sims = projection?.simulations ?? 1;

  const projMap = useMemo(
    () => new Map(projection?.teams.map(t => [t.teamId, { winTournament: t.winTournament }]) ?? []),
    [projection],
  );

  // Map match number → kickoff_utc / venue from the real bracket data, so the
  // round labels and the Final show official FIFA dates instead of hardcoded text.
  const { roundDates, finalLine } = useMemo(() => {
    const byNum = new Map<number, string>();
    let finalFx: Fixture | undefined;
    for (const f of koFixtures ?? []) {
      const m = f.id.match(/m(\d+)$/);
      if (!m) continue;
      const n = +m[1];
      if (f.kickoff_utc) byNum.set(n, f.kickoff_utc);
      if (n === FINAL_ID) finalFx = f;
    }
    const fDate = artDateShort(finalFx?.kickoff_utc);
    const fVenue = finalFx?.city || finalFx?.venue || '';
    return {
      roundDates: {
        r32: roundDateRange(byNum, 73, 88),
        r16: roundDateRange(byNum, 89, 96),
        qf:  roundDateRange(byNum, 97, 100),
        sf:  roundDateRange(byNum, 101, 102),
      },
      finalLine: fDate ? `${fDate}${fVenue ? ` · ${fVenue}` : ''}` : '',
    };
  }, [koFixtures]);

  const colProps = { occ, sims, projMap, highlightTeamId, teamMap };

  return (
    <div className="bg-[#0c1a3b] rounded-xl shadow-sm border border-blue-900/50">
      {/* ── Toggle header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-bold text-white flex items-center gap-2 text-sm">
          <Trophy className="w-4 h-4 text-yellow-400" />
          Bracket del torneo
          {projection && (
            <span className="font-normal text-blue-300 ml-1" style={{ fontSize: 11 }}>
              · {(sims / 1000).toFixed(0)}k sims
            </span>
          )}
          {!projection && (
            <span className="font-normal ml-1" style={{ fontSize: 11, color: 'rgba(147,197,253,0.5)' }}>
              · corré la simulación para ver equipos
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-blue-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Bracket body ── */}
      {open && (
        <div className="border-t border-blue-900/50 overflow-x-auto">
          <div
            className="flex p-3 gap-0 items-start"
            style={{ minWidth: 'max-content', height: TOTAL_H + LABEL_H + 24 }}
          >
            {/* ══ LEFT HALF ══ */}

            {/* R32 left */}
            <RoundColumn label="16avos" dateLabel={roundDates.r32} matchIds={LEFT_R32} slotH={SLOT_H}     {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={4} srcSlotH={SLOT_H} />
            </div>

            {/* R16 left */}
            <RoundColumn label="8avos"  dateLabel={roundDates.r16} matchIds={LEFT_R16} slotH={SLOT_H * 2} {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={2} srcSlotH={SLOT_H * 2} />
            </div>

            {/* QF left */}
            <RoundColumn label="4tos"   dateLabel={roundDates.qf} matchIds={LEFT_QF}  slotH={SLOT_H * 4} {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={1} srcSlotH={SLOT_H * 4} />
            </div>

            {/* SF left */}
            <RoundColumn label="Semis"  dateLabel={roundDates.sf} matchIds={LEFT_SF}  slotH={SLOT_H * 8} {...colProps} />
            <StraightConnector />

            {/* ══ CENTER: FINAL ══ */}
            <FinalCenter {...colProps} finalLine={finalLine} />

            {/* ══ RIGHT HALF ══ */}

            {/* SF right */}
            <StraightConnector flipped />
            <RoundColumn label="Semis"  dateLabel={roundDates.sf} matchIds={RIGHT_SF}  slotH={SLOT_H * 8} {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={1} srcSlotH={SLOT_H * 4} flipped />
            </div>

            {/* QF right */}
            <RoundColumn label="4tos"   dateLabel={roundDates.qf} matchIds={RIGHT_QF}  slotH={SLOT_H * 4} {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={2} srcSlotH={SLOT_H * 2} flipped />
            </div>

            {/* R16 right */}
            <RoundColumn label="8avos"  dateLabel={roundDates.r16} matchIds={RIGHT_R16} slotH={SLOT_H * 2} {...colProps} />
            <div style={{ paddingTop: LABEL_H }}>
              <ConnectorSvg pairs={4} srcSlotH={SLOT_H} flipped />
            </div>

            {/* R32 right */}
            <RoundColumn label="16avos" dateLabel={roundDates.r32} matchIds={RIGHT_R32} slotH={SLOT_H}     {...colProps} />
          </div>
        </div>
      )}
    </div>
  );
}
