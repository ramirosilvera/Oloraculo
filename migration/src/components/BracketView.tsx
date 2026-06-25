import { useState } from 'react';
import { Trophy, ChevronDown } from 'lucide-react';
import { FlagImg } from './ui';
import type { Team, TournamentProjection } from '../types/domain';

// ---------------------------------------------------------------------------
// R32 slot labels — official FIFA WC 2026 draw positions
// ---------------------------------------------------------------------------
const R32_SLOTS: Record<number, [string, string]> = {
  73: ['2A', '2B'],
  74: ['1E', 'T3(A/B/C/D/F)'],
  75: ['1F', '2C'],
  76: ['1C', '2F'],
  77: ['1I', 'T3(C/D/F/G/H)'],
  78: ['2E', '2I'],
  79: ['1A', 'T3(C/E/F/H/I)'],
  80: ['1L', 'T3(E/H/I/J/K)'],
  81: ['1D', 'T3(B/E/F/I/J)'],
  82: ['1G', 'T3(A/E/H/I/J)'],
  83: ['2K', '2L'],
  84: ['1H', '2J'],
  85: ['1B', 'T3(E/F/G/I/J)'],
  86: ['1J', '2H'],
  87: ['1K', 'T3(D/E/I/J/L)'],
  88: ['2D', '2G'],
};

// ---------------------------------------------------------------------------
// Two-half bracket structure — LEFT feeds SF 101, RIGHT feeds SF 102
// ---------------------------------------------------------------------------
const LEFT_HALF = {
  r32: [74, 77, 73, 75, 83, 84, 81, 82],
  r16: [
    { id: 89, from: [74, 77] },
    { id: 90, from: [73, 75] },
    { id: 93, from: [83, 84] },
    { id: 94, from: [81, 82] },
  ],
  qf: [
    { id: 97, from: [89, 90] },
    { id: 98, from: [93, 94] },
  ],
  sf: { id: 101, from: [97, 98] },
};

const RIGHT_HALF = {
  r32: [76, 78, 79, 80, 86, 88, 85, 87],
  r16: [
    { id: 91, from: [76, 78] },
    { id: 92, from: [79, 80] },
    { id: 95, from: [86, 88] },
    { id: 96, from: [85, 87] },
  ],
  qf: [
    { id: 99, from: [91, 92] },
    { id: 100, from: [95, 96] },
  ],
  sf: { id: 102, from: [99, 100] },
};

const FINAL_MATCH = { id: 104, from: [101, 102] };

// ---------------------------------------------------------------------------
// Helper — get top-2 most likely teams for a given R32 match slot
// ---------------------------------------------------------------------------
function getSlotTeams(
  matchId: number,
  slotOccupancy: Record<number, Record<string, number>> | undefined,
  simulations: number,
): { teamId: string; prob: number }[] {
  if (!slotOccupancy?.[matchId]) return [];
  return Object.entries(slotOccupancy[matchId])
    .map(([teamId, count]) => ({ teamId, prob: count / simulations }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// MatchCard — compact card showing two teams (or slot placeholders)
// ---------------------------------------------------------------------------
interface MatchCardProps {
  matchId: number;
  homeLabel: string;
  awayLabel: string;
  homeTeam?: string;
  awayTeam?: string;
  homeProb?: number;
  awayProb?: number;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
}

function TeamRow({
  teamId,
  label,
  prob,
  highlighted,
  teamMap,
}: {
  teamId?: string;
  label: string;
  prob?: number;
  highlighted: boolean;
  teamMap: Map<string, Team>;
}) {
  const name = teamId ? (teamMap.get(teamId)?.name ?? teamId) : null;
  return (
    <div className={`px-2 py-1 flex items-center gap-1.5 ${highlighted ? 'font-bold' : ''}`}>
      {teamId ? (
        <>
          <FlagImg id={teamId} className="w-5 h-3.5 object-cover rounded-[2px] shrink-0" />
          <span className="truncate text-[11px] leading-tight flex-1 min-w-0">{name}</span>
          {prob != null && (
            <span className={`text-[10px] shrink-0 ${highlighted ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>
              {(prob * 100).toFixed(0)}%
            </span>
          )}
        </>
      ) : (
        <span className="text-[10px] text-gray-300 italic truncate">{label}</span>
      )}
    </div>
  );
}

function MatchCard({
  matchId,
  homeLabel,
  awayLabel,
  homeTeam,
  awayTeam,
  homeProb,
  awayProb,
  highlightTeamId,
  teamMap,
}: MatchCardProps) {
  const homeHighlighted = !!homeTeam && homeTeam === highlightTeamId;
  const awayHighlighted = !!awayTeam && awayTeam === highlightTeamId;

  return (
    <div
      className={`rounded border text-xs min-w-[148px] max-w-[180px] overflow-hidden ${
        homeHighlighted || awayHighlighted
          ? 'border-amber-400 bg-amber-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <TeamRow
        teamId={homeTeam}
        label={homeLabel}
        prob={homeProb}
        highlighted={homeHighlighted}
        teamMap={teamMap}
      />
      <div className="border-t border-gray-100" />
      <TeamRow
        teamId={awayTeam}
        label={awayLabel}
        prob={awayProb}
        highlighted={awayHighlighted}
        teamMap={teamMap}
      />
      <div className="border-t border-gray-100 text-center py-0.5 text-gray-300 text-[9px]">
        M{matchId}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R32 match card — resolves teams from slotOccupancy
// ---------------------------------------------------------------------------
function R32Card({
  matchId,
  projection,
  highlightTeamId,
  teamMap,
}: {
  matchId: number;
  projection: TournamentProjection | null;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
}) {
  const [homeLabel, awayLabel] = R32_SLOTS[matchId] ?? ['?', '?'];
  const teams = projection
    ? getSlotTeams(matchId, projection.slotOccupancy, projection.simulations)
    : [];
  const home = teams[0];
  const away = teams[1];

  return (
    <MatchCard
      matchId={matchId}
      homeLabel={homeLabel}
      awayLabel={awayLabel}
      homeTeam={home?.teamId}
      awayTeam={away?.teamId}
      homeProb={home?.prob}
      awayProb={away?.prob}
      highlightTeamId={highlightTeamId}
      teamMap={teamMap}
    />
  );
}

// Slot labels for R16 and beyond
const KNOCKOUT_LABELS: Record<number, [string, string]> = {
  89:  ['W(M74)', 'W(M77)'],
  90:  ['W(M73)', 'W(M75)'],
  91:  ['W(M76)', 'W(M78)'],
  92:  ['W(M79)', 'W(M80)'],
  93:  ['W(M83)', 'W(M84)'],
  94:  ['W(M81)', 'W(M82)'],
  95:  ['W(M86)', 'W(M88)'],
  96:  ['W(M85)', 'W(M87)'],
  97:  ['W(M89)', 'W(M90)'],
  98:  ['W(M93)', 'W(M94)'],
  99:  ['W(M91)', 'W(M92)'],
  100: ['W(M95)', 'W(M96)'],
  101: ['W(M97)', 'W(M98)'],
  102: ['W(M99)', 'W(M100)'],
  104: ['W(M101)', 'W(M102)'],
};

// ---------------------------------------------------------------------------
// Knockout round card (R16, QF, SF, Final) — resolved from slotOccupancy
// ---------------------------------------------------------------------------
function KnockoutCard({
  matchId,
  projection,
  highlightTeamId,
  teamMap,
}: {
  matchId: number;
  projection: TournamentProjection | null;
  highlightTeamId?: string;
  teamMap: Map<string, Team>;
}) {
  const [homeLabel, awayLabel] = KNOCKOUT_LABELS[matchId] ?? ['TBD', 'TBD'];
  const teams = projection
    ? getSlotTeams(matchId, projection.slotOccupancy, projection.simulations)
    : [];
  const home = teams[0];
  const away = teams[1];

  return (
    <MatchCard
      matchId={matchId}
      homeLabel={homeLabel}
      awayLabel={awayLabel}
      homeTeam={home?.teamId}
      awayTeam={away?.teamId}
      homeProb={home?.prob}
      awayProb={away?.prob}
      highlightTeamId={highlightTeamId}
      teamMap={teamMap}
    />
  );
}

// ---------------------------------------------------------------------------
// Column — a labelled vertical stack of match cards
// ---------------------------------------------------------------------------
function RoundColumn({
  label,
  leftCards,
  rightCards,
  centerCards,
  gap = 'gap-1',
}: {
  label: string;
  leftCards?: React.ReactNode;
  rightCards?: React.ReactNode;
  centerCards?: React.ReactNode;
  gap?: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wide">
        {label}
      </div>
      {centerCards ? (
        <div className={`flex flex-col ${gap} justify-center flex-1`}>{centerCards}</div>
      ) : (
        <>
          <div className={`flex flex-col ${gap}`}>{leftCards}</div>
          <div className="border-t-2 border-dashed border-gray-200 my-2" />
          <div className={`flex flex-col ${gap}`}>{rightCards}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BracketView component
// ---------------------------------------------------------------------------
export interface BracketViewProps {
  projection: TournamentProjection | null;
  teamMap: Map<string, Team>;
  highlightTeamId?: string;
}

export function BracketView({ projection, teamMap, highlightTeamId }: BracketViewProps) {
  const [open, setOpen] = useState(false);

  const r32Props = { projection, highlightTeamId, teamMap };
  const knockoutProps = { projection, highlightTeamId, teamMap };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-bold text-wc-navy flex items-center gap-2 text-sm">
          <Trophy className="w-4 h-4 text-wc-gold" />
          Bracket del torneo
          {projection && (
            <span className="text-xs font-normal text-gray-400 ml-1">
              · {(projection.simulations / 1000).toFixed(0)}k sims
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 overflow-x-auto pb-4">
          <div className="flex gap-3 p-4 min-w-max items-start">

            {/* Column 1 — R32 */}
            <RoundColumn
              label="R32"
              leftCards={
                <div className="flex flex-col gap-1">
                  {LEFT_HALF.r32.map(id => (
                    <R32Card key={id} matchId={id} {...r32Props} />
                  ))}
                </div>
              }
              rightCards={
                <div className="flex flex-col gap-1">
                  {RIGHT_HALF.r32.map(id => (
                    <R32Card key={id} matchId={id} {...r32Props} />
                  ))}
                </div>
              }
            />

            {/* Separator */}
            <div className="border-l-2 border-gray-100 self-stretch mx-0.5" />

            {/* Column 2 — R16 */}
            <RoundColumn
              label="R16"
              gap="gap-6"
              leftCards={
                <div className="flex flex-col gap-6 mt-4">
                  {LEFT_HALF.r16.map(m => (
                    <KnockoutCard key={m.id} matchId={m.id} {...knockoutProps} />
                  ))}
                </div>
              }
              rightCards={
                <div className="flex flex-col gap-6 mt-4">
                  {RIGHT_HALF.r16.map(m => (
                    <KnockoutCard key={m.id} matchId={m.id} {...knockoutProps} />
                  ))}
                </div>
              }
            />

            {/* Separator */}
            <div className="border-l-2 border-gray-100 self-stretch mx-0.5" />

            {/* Column 3 — QF */}
            <RoundColumn
              label="Cuartos"
              gap="gap-6"
              leftCards={
                <div className="flex flex-col gap-6 mt-16">
                  {LEFT_HALF.qf.map(m => (
                    <KnockoutCard key={m.id} matchId={m.id} {...knockoutProps} />
                  ))}
                </div>
              }
              rightCards={
                <div className="flex flex-col gap-6 mt-16">
                  {RIGHT_HALF.qf.map(m => (
                    <KnockoutCard key={m.id} matchId={m.id} {...knockoutProps} />
                  ))}
                </div>
              }
            />

            {/* Separator */}
            <div className="border-l-2 border-gray-100 self-stretch mx-0.5" />

            {/* Column 4 — SF */}
            <RoundColumn
              label="Semis"
              gap="gap-6"
              leftCards={
                <div className="flex flex-col gap-6 mt-36">
                  <KnockoutCard matchId={LEFT_HALF.sf.id} {...knockoutProps} />
                </div>
              }
              rightCards={
                <div className="flex flex-col gap-6 mt-36">
                  <KnockoutCard matchId={RIGHT_HALF.sf.id} {...knockoutProps} />
                </div>
              }
            />

            {/* Separator */}
            <div className="border-l-2 border-gray-100 self-stretch mx-0.5" />

            {/* Column 5 — Final */}
            <div className="flex flex-col">
              <div className="text-center text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wide">
                Final
              </div>
              <div className="flex flex-col justify-center flex-1" style={{ minHeight: '600px' }}>
                <div className="flex items-center justify-center h-full">
                  <KnockoutCard matchId={FINAL_MATCH.id} {...knockoutProps} />
                </div>
              </div>
            </div>

          </div>

          {!projection && (
            <p className="text-center text-xs text-gray-300 pb-2">
              Corré la simulación para ver las probabilidades en el bracket
            </p>
          )}
        </div>
      )}
    </div>
  );
}
