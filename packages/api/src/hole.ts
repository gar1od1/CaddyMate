/**
 * Pure per-hole re-derivation (docs/SPEC.md §5.6, §6.4). Given the shots of
 * one hole in any order, `recomputeHoleShots` re-chains positions, renumbers
 * `seq`, and rewrites the client-derived fields; `tallyHole` recounts the
 * scorecard numbers. Both the mobile local store and the server-side
 * `recomputeHole()` use these, so the two can never disagree.
 */
import {
  haversineDistanceM,
  initialBearingDeg,
  toClubFrame,
  type Handedness,
  type LatLng,
} from '@caddymate/engine';
import { neutralResult, resolveElevations, type ClubProfile } from './neutral.js';
import type { HoleScore, LieKind, Shot } from './types.js';

export interface RecomputeContext {
  /** Pin for the hole: round pin override, else green centre. */
  pin: LatLng | null;
  /** Surface under a point (lie), for `result_surface`. */
  surfaceAt?: (p: LatLng) => LieKind | null;
  /**
   * Club kind/loft by id. When given, course shots get neutral results
   * (`normaliseShot`, §7); without it the neutral fields are left as they are.
   */
  clubFor?: (clubId: string) => ClubProfile | null;
  /** Player handedness for the stance-slope mirror. Default 'R'. */
  handedness?: Handedness;
  /** Course elevation grid sampler; its heights replace GPS altitudes when both ends are on it. */
  elevationAt?: ((p: LatLng) => number | null) | null;
}

const samePoint = (a: LatLng | null, b: LatLng | null) =>
  a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

export const isPenaltyRecord = (s: Pick<Shot, 'penalty' | 'clubId'>) =>
  s.penalty !== 'none' && s.clubId === null;

export const isPutt = (s: Pick<Shot, 'lie' | 'penalty' | 'clubId'>) =>
  s.lie === 'green' && !isPenaltyRecord(s);

/** Order shots by seq, then time, then id — stable for equal seqs after inserts. */
export function orderShots<T extends Pick<Shot, 'seq' | 'playedAt' | 'id'>>(shots: readonly T[]) {
  return [...shots].sort(
    (a, b) => a.seq - b.seq || a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id),
  );
}

/** Intended-line bearing: stored bearing, else toward the target, else toward the pin. */
export function lineBearing(s: Shot, pin: LatLng | null): number | null {
  if (!s.start) return null;
  if (s.targetBearingDeg !== null) return s.targetBearingDeg;
  if (s.target) return initialBearingDeg(s.start, s.target);
  if (pin) return initialBearingDeg(s.start, pin);
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-chain and re-derive a hole. Returns new shot objects (inputs untouched):
 *  1. sort and renumber seq 1..n;
 *  2. chain: shot n+1 starts where shot n ended. If shot n has no end but
 *     n+1 has a start (Ball here was skipped), shot n's end is back-filled;
 *  3. a holed shot ends at the pin;
 *  4. observed distance/lateral in the club frame, distance to pin before and
 *     after (putts use the entered feet when present), result surface;
 *  5. with `ctx.clubFor`: start/end elevations from the grid (when on it)
 *     and the neutral result stamped with the condition-model version.
 */
export function recomputeHoleShots(shots: readonly Shot[], ctx: RecomputeContext): Shot[] {
  const out = orderShots(shots).map((s, i) => ({ ...s, seq: i + 1 }));

  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    if (s.holed && ctx.pin) s.end = ctx.pin;
    const next = out[i + 1];
    if (!next) continue;
    if (s.end) {
      if (!samePoint(next.start, s.end)) next.start = s.end;
    } else if (next.start && !s.holed) {
      s.end = next.start;
    }
  }

  for (const s of out) {
    const putt = isPutt(s);
    const penaltyRecord = isPenaltyRecord(s);

    s.observedDistanceM = null;
    s.observedLateralM = null;
    const bearing = penaltyRecord ? null : lineBearing(s, ctx.pin);
    if (bearing !== null && s.start && s.end) {
      const r = toClubFrame(s.start, bearing, s.end);
      s.observedDistanceM = round2(r.alongM);
      s.observedLateralM = round2(r.lateralM);
    }

    if (ctx.clubFor) {
      const elev = resolveElevations(s, ctx.elevationAt);
      if (elev.source === 'grid' && s.conditions) {
        s.conditions = {
          ...s.conditions,
          elevation_start_m: round2(elev.startM),
          elevation_end_m: round2(elev.endM),
        };
      }
      const neutral = neutralResult(s, bearing, {
        club: s.clubId ? ctx.clubFor(s.clubId) : null,
        handedness: ctx.handedness ?? 'R',
        elevationAt: ctx.elevationAt ?? null,
      });
      s.neutralDistanceM = neutral?.alongM ?? null;
      s.neutralLateralM = neutral?.lateralM ?? null;
      s.conditionModelVersion = neutral?.conditionModelVersion ?? null;
    }

    s.distanceToPinBeforeM =
      putt && s.puttDistanceM !== null
        ? s.puttDistanceM
        : s.start && ctx.pin
          ? round2(haversineDistanceM(s.start, ctx.pin))
          : null;
    s.distanceToPinAfterM = s.holed
      ? 0
      : putt && s.puttRemainingM !== null
        ? s.puttRemainingM
        : s.end && ctx.pin
          ? round2(haversineDistanceM(s.end, ctx.pin))
          : null;

    s.resultSurface = s.holed ? 'green' : s.end && ctx.surfaceAt ? ctx.surfaceAt(s.end) : null;
  }
  return out;
}

export interface HoleTally {
  strokesLogged: number;
  putts: number;
  penalties: number;
  holed: boolean;
}

/** Strokes = every record's stroke_count (penalty records included); putts; penalty strokes. */
export function tallyHole(shots: readonly Shot[]): HoleTally {
  let strokesLogged = 0;
  let putts = 0;
  let penalties = 0;
  let holed = false;
  for (const s of shots) {
    strokesLogged += s.strokeCount;
    if (isPenaltyRecord(s)) penalties += s.strokeCount;
    else if (isPutt(s)) putts += 1;
    if (s.holed) holed = true;
  }
  return { strokesLogged, putts, penalties, holed };
}

/** Merge a tally into a hole score, keeping any manual override. */
export function applyTally(
  prev: HoleScore | null,
  roundId: string,
  holeNumber: number,
  t: HoleTally,
): HoleScore {
  return {
    roundId,
    holeNumber,
    strokesOverride: prev?.strokesOverride ?? null,
    overrideReason: prev?.overrideReason ?? null,
    points: prev?.points ?? null,
    netStrokes: prev?.netStrokes ?? null,
    strokesLogged: t.strokesLogged,
    putts: t.putts,
    penalties: t.penalties,
  };
}

/** Strokes that count for the hole: override when set, else logged. */
export const holeStrokes = (s: Pick<HoleScore, 'strokesLogged' | 'strokesOverride'>) =>
  s.strokesOverride ?? s.strokesLogged;
