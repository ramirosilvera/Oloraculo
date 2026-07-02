// =============================================================================
// Oloráculo — Knockout progression resolver
//
// Fills the knockout bracket automatically as results are registered. Each
// R16→Final fixture stores its feeders as slot labels ("W(ko:r32:m74)" =
// "winner of match 74", "L(...)" = loser, used for the 3rd-place match). R32
// stores group slots ("1A", "2B", "T3"). This walks every fixture's feeder
// chain and resolves both sides to concrete team ids using:
//   - live group standings for "1A"/"2B" base slots,
//   - the static JSON team (best-third assignment) for "T3",
//   - the winner/loser of the feeder match for "W(...)"/"L(...)".
//
// A knockout match level at 90' is decided by penalties: there is no winner in
// the score alone, so we use the recorded `advancer_team_id`. Until that is
// known the downstream slot stays unresolved (null) rather than guessing.
// =============================================================================

import type { Fixture } from '../types/domain';

export interface KoResolved {
  homeId: string | null;
  awayId: string | null;
}

// A registered result, optionally carrying the shootout advancer for a 90' draw.
export interface KoResult {
  home_goals: number;
  away_goals: number;
  advancer_team_id?: string | null;
}

export interface ResolveArgs {
  knockoutFixtures: Fixture[];
  // Team id for a base group slot ("1A"/"2B") from live standings; null/undefined if unknown.
  liveSlotTeam: (slot: string) => string | null | undefined;
  // Registered result for a fixture id; undefined if not played yet.
  resultOf: (fixtureId: string) => KoResult | undefined;
}

const W_RE = /^W\((.+)\)$/;
const L_RE = /^L\((.+)\)$/;
const GROUP_SLOT_RE = /^[12][A-L]$/;

/**
 * Resolves every knockout fixture's two sides to concrete team ids (or null when
 * a feeder is still undecided). Fully memoized; safe against cycles.
 */
export function resolveKnockoutBracket(args: ResolveArgs): Map<string, KoResolved> {
  const { knockoutFixtures, liveSlotTeam, resultOf } = args;
  const byId = new Map(knockoutFixtures.map(f => [f.id, f]));
  const teamsMemo = new Map<string, KoResolved>();
  const winnerMemo = new Map<string, string | null>();
  const loserMemo = new Map<string, string | null>();
  const inFlight = new Set<string>(); // cycle guard

  function baseSlotTeam(slot: string, side: 'home' | 'away', f: Fixture): string | null {
    const live = liveSlotTeam(slot);
    if (live) return live;
    const staticId = side === 'home' ? f.home_team_id : f.away_team_id;
    return staticId || null;
  }

  function resolveSlot(slot: string | null | undefined, side: 'home' | 'away', f: Fixture): string | null {
    if (!slot) return (side === 'home' ? f.home_team_id : f.away_team_id) || null;
    const wm = slot.match(W_RE); if (wm) return winnerOf(wm[1]);
    const lm = slot.match(L_RE); if (lm) return loserOf(lm[1]);
    return baseSlotTeam(slot, side, f);
  }

  function teamsOf(id: string): KoResolved {
    const cached = teamsMemo.get(id);
    if (cached) return cached;
    const f = byId.get(id);
    const res: KoResolved = f
      ? { homeId: resolveSlot(f.home_slot, 'home', f), awayId: resolveSlot(f.away_slot, 'away', f) }
      : { homeId: null, awayId: null };
    teamsMemo.set(id, res);
    return res;
  }

  function decide(id: string): { winner: string | null; loser: string | null } {
    const f = byId.get(id);
    if (!f) return { winner: null, loser: null };
    const { homeId, awayId } = teamsOf(id);
    if (!homeId || !awayId) return { winner: null, loser: null };
    const r = resultOf(id);
    if (!r) return { winner: null, loser: null };
    if (r.home_goals > r.away_goals) return { winner: homeId, loser: awayId };
    if (r.away_goals > r.home_goals) return { winner: awayId, loser: homeId };
    // Level at 90' → penalties: only resolvable via the recorded advancer.
    if (r.advancer_team_id === homeId) return { winner: homeId, loser: awayId };
    if (r.advancer_team_id === awayId) return { winner: awayId, loser: homeId };
    return { winner: null, loser: null };
  }

  function winnerOf(id: string): string | null {
    if (winnerMemo.has(id)) return winnerMemo.get(id)!;
    if (inFlight.has(id)) return null; // cycle guard (shouldn't happen in a bracket)
    inFlight.add(id);
    const { winner, loser } = decide(id);
    inFlight.delete(id);
    winnerMemo.set(id, winner);
    loserMemo.set(id, loser);
    return winner;
  }

  function loserOf(id: string): string | null {
    if (loserMemo.has(id)) return loserMemo.get(id)!;
    winnerOf(id); // populates both memos
    return loserMemo.get(id) ?? null;
  }

  const out = new Map<string, KoResolved>();
  for (const f of knockoutFixtures) out.set(f.id, teamsOf(f.id));
  return out;
}

// Friendly placeholder for an unresolved slot: "Ganador M74", "Perdedor M74", "Mejor 3°".
export function slotPlaceholder(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const wm = slot.match(W_RE); if (wm) return `Ganador ${matchTag(wm[1])}`;
  const lm = slot.match(L_RE); if (lm) return `Perdedor ${matchTag(lm[1])}`;
  if (slot === 'T3') return 'Mejor 3°';
  return GROUP_SLOT_RE.test(slot) ? slot : null;
}

function matchTag(id: string): string {
  const m = id.match(/m(\d+)/);
  return m ? `M${m[1]}` : id;
}

// True when a 90' draw in a knockout match still needs its shootout winner recorded.
export function needsShootoutWinner(
  slotFixtureId: string,
  result: KoResult | undefined,
): boolean {
  if (!slotFixtureId.startsWith('ko:')) return false;
  if (!result) return false;
  if (result.home_goals !== result.away_goals) return false;
  return !result.advancer_team_id;
}
