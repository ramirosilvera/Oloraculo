import { useState, useMemo } from 'react';
import { Trophy, ChevronDown } from 'lucide-react';
import { FlagImg } from './ui';
import type { Team, TournamentProjection } from '../types/domain';

// ─── Layout constants ────────────────────────────────────────────────────────
const CARD_W   = 80;          // px — card width
const CARD_H   = 38;          // px — card height (2 team rows × 18px + 2px border)
const SLOT_H   = 46;          // px — slot height (card + top/bottom breathing room)
const CONN_W   = 22;          // px — SVG connector column width
const LINE_CLR = '#d1d5db';   // gray-300

// ─── Static bracket order (top → bottom within each round) ──────────────────
// LEFT half (slots 0-7) → feeds SF m101; RIGHT half (slots 8-15) → feeds SF m102
const R32_ORDER = [74, 77, 73, 75, 83, 84, 81, 82,  76, 78, 79, 80, 86, 88, 85, 87];
const R16_ORDER = [89, 90, 93, 94,  91, 92, 95, 96];
const QF_ORDER  = [97, 98,  99, 100];
const SF_ORDER  = [101, 102];
const FINAL_ID  = 104;

// ─── Slot labels (shown pre-simulation or as tooltip suffix) ─────────────────
const SLOT_LABELS: Record<number, [string, string]> = {
  // R32
  73: ['2A','2B'],   74: ['1E','T3'],   75: ['1F','2C'],   76: ['1C','2F'],
  77: ['1I','T3'],   78: ['2E','2I'],   79: ['1A','T3'],   80: ['1L','T3'],
  81: ['1D','T3'],   82: ['1G','T3'],   83: ['2K','2L'],   84: ['1H','2J'],
  85: ['1B','T3'],   86: ['1J','2H'],   87: ['1K','T3'],   88: ['2D','2G'],
  // R16
  89: ['W74','W77'], 90: ['W73','W75'], 91: ['W76','W78'], 92: ['W79','W80'],
  93: ['W83','W84'], 94: ['W81','W82'], 95: ['W86','W88'], 96: ['W85','W87'],
  // QF
  97: ['W89','W90'], 98: ['W93','W94'], 99: ['W91','W92'], 100: ['W95','W96'],
  // SF
  101: ['W97','W98'], 102: ['W99','W100'],
  // Final
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

// ─── MiniTeamRow — one team line inside a card ───────────────────────────────
function MiniTeamRow({
  teamId, label, winProb, highlighted, teamMap,
}: {
  teamId?: string;
  label: string;
  winProb?: number;       // probability of WINNING THE TOURNAMENT (from projection.teams)
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

// ─── MiniCard — compact match card ───────────────────────────────────────────
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

// ─── ConnectorSvg — L-shaped lines between consecutive rounds ─────────────────
// Draws `pairs` L-connectors. Each pair occupies 2 × srcSlotH px vertically.
// Total SVG height = pairs × 2 × srcSlotH.
function ConnectorSvg({ pairs, srcSlotH }: { pairs: number; srcSlotH: number }) {
  const h = pairs * 2 * srcSlotH;
  const mx = CONN_W / 2;
  return (
    <svg
      width={CONN_W}
      height={h}
      className="shrink-0"
      style={{ display: 'block' }}
    >
      {Array.from({ length: pairs }, (_, i) => {
        const topY = (i * 2 + 0.5) * srcSlotH;   // centre of top source slot
        const botY = (i * 2 + 1.5) * srcSlotH;   // centre of bottom source slot
        const midY = (i * 2 + 1.0) * srcSlotH;   // centre of merged target slot
        return (
          <g key={i} stroke={LINE_CLR} strokeWidth={1} fill="none">
            <line x1={0}   y1={topY} x2={mx}      y2={topY} />  {/* top arm in    */}
            <line x1={mx}  y1={topY} x2={mx}      y2={botY} />  {/* vertical bar  */}
            <line x1={0}   y1={botY} x2={mx}      y2={botY} />  {/* bottom arm in */}
            <line x1={mx}  y1={midY} x2={CONN_W}  y2={midY} />  {/* output arm   */}
          </g>
        );
      })}
    </svg>
  );
}

// ─── RoundColumn — one round's cards aligned in equal-height slots ────────────
function RoundColumn({
  label, matchIds, slotH, occ, sims, projMap, highlightTeamId, teamMap,
}: {
  label: string;
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
      {/* Round label */}
      <div
        className="text-center font-bold text-gray-400 uppercase tracking-widest"
        style={{ fontSize: 8, marginBottom: 4 }}
      >
        {label}
      </div>
      {/* Cards in equal-height slots */}
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

// ─── BracketView ─────────────────────────────────────────────────────────────
export interface BracketViewProps {
  projection: TournamentProjection | null;
  teamMap: Map<string, Team>;
  highlightTeamId?: string;
}

export function BracketView({ projection, teamMap, highlightTeamId }: BracketViewProps) {
  const [open, setOpen] = useState(false);

  const occ  = projection?.slotOccupancy;
  const sims = projection?.simulations ?? 1;

  // O(1) win-probability lookup
  const projMap = useMemo(
    () => new Map(projection?.teams.map(t => [t.teamId, { winTournament: t.winTournament }]) ?? []),
    [projection],
  );

  // Heights: R32 slot = SLOT_H; each round doubles
  const totalBracketH = 16 * SLOT_H;   // = 736px

  const colProps = { occ, sims, projMap, highlightTeamId, teamMap };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* ── Toggle header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-bold text-wc-navy flex items-center gap-2 text-sm">
          <Trophy className="w-4 h-4 text-wc-gold" />
          Bracket del torneo
          {projection && (
            <span className="font-normal text-gray-400 ml-1" style={{ fontSize: 11 }}>
              · {(sims / 1000).toFixed(0)}k sims
            </span>
          )}
          {!projection && (
            <span className="font-normal text-gray-300 ml-1" style={{ fontSize: 11 }}>
              · corré la simulación para ver equipos
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Bracket body ── */}
      {open && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <div
            className="flex p-3 gap-0"
            style={{ minWidth: 'max-content', height: totalBracketH + 32 /* header row */ }}
          >
            {/* R32 */}
            <RoundColumn label="R32"     matchIds={R32_ORDER} slotH={SLOT_H * 1}  {...colProps} />
            {/* R32→R16 connector: 8 pairs, each pair = 2×SLOT_H */}
            <div style={{ paddingTop: 20 }}>
              <ConnectorSvg pairs={8} srcSlotH={SLOT_H * 1} />
            </div>

            {/* R16 */}
            <RoundColumn label="R16"     matchIds={R16_ORDER} slotH={SLOT_H * 2}  {...colProps} />
            {/* R16→QF: 4 pairs */}
            <div style={{ paddingTop: 20 }}>
              <ConnectorSvg pairs={4} srcSlotH={SLOT_H * 2} />
            </div>

            {/* QF */}
            <RoundColumn label="Cuartos" matchIds={QF_ORDER}  slotH={SLOT_H * 4}  {...colProps} />
            {/* QF→SF: 2 pairs */}
            <div style={{ paddingTop: 20 }}>
              <ConnectorSvg pairs={2} srcSlotH={SLOT_H * 4} />
            </div>

            {/* SF */}
            <RoundColumn label="Semis"   matchIds={SF_ORDER}  slotH={SLOT_H * 8}  {...colProps} />
            {/* SF→Final: 1 pair */}
            <div style={{ paddingTop: 20 }}>
              <ConnectorSvg pairs={1} srcSlotH={SLOT_H * 8} />
            </div>

            {/* Final */}
            <RoundColumn label="Final"   matchIds={[FINAL_ID]} slotH={SLOT_H * 16} {...colProps} />
          </div>
        </div>
      )}
    </div>
  );
}
