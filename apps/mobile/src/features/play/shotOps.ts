/**
 * Pure operations that turn the current shot list of a hole into the next
 * one (docs/SPEC.md §5.3–§5.6). The caller persists the result with
 * `saveHole`, which re-chains and re-derives everything, so these only need
 * to add/modify the records the player acted on.
 */
import {
  isPenaltyRecord,
  newShot,
  orderShots,
  uuidv4,
  windComponents,
  type LieKind,
  type PenaltyKind,
  type ShapeKind,
  type Shot,
  type ShotConditions,
  type TargetRef,
  type WeatherSnapshot,
} from '@caddymate/api';
import {
  destinationPoint,
  initialBearingDeg,
  type LatLng,
  type RecommendationSnapshot,
  type StanceSlope,
} from '@caddymate/engine';
import type { Fix } from '@/lib/location';

export interface ShotBase {
  userId: string;
  roundId: string;
  holeNumber: number;
}

/** Everything the pre-shot card captures. */
export interface CardFields {
  clubId: string | null;
  lie: LieKind | null;
  slope: StanceSlope;
  target: LatLng | null;
  targetBearingDeg: number | null;
  targetRef: TargetRef | null;
  intendedShape: ShapeKind | null;
  conditions: ShotConditions | null;
  /** Terrain slope suggestion shown on the card (§7.5), stored as `slope_suggested`. */
  slopeSuggested: StanceSlope | null;
}

export interface WindOverride {
  speedMps: number;
  fromDeg: number;
}

/**
 * Conditions snapshot for a shot (SI). Head/cross are along the intended
 * line. Elevations come from the course grid (start, and the target until
 * the shot finishes) or, without one, GPS altitude at Hit / Ball here;
 * recomputeHole replaces them with grid heights whenever a grid is loaded.
 */
export function buildConditions(
  weather: WeatherSnapshot | null,
  override: WindOverride | null,
  bearingDeg: number | null,
  elevationStartM: number | null,
  elevationEndM: number | null = null,
): ShotConditions | null {
  if (!weather && !override) return null;
  const speed = override?.speedMps ?? weather?.windSpeedMps ?? 0;
  const from = override?.fromDeg ?? weather?.windFromDeg ?? 0;
  const comps = bearingDeg === null ? null : windComponents(speed, from, bearingDeg);
  return {
    wind_speed_ms: speed,
    wind_dir_deg: from,
    gust_ms: weather?.gustMps ?? null,
    temp_c: weather?.tempC ?? 20,
    pressure_hpa: weather?.pressureHpa ?? 1013.25,
    elevation_start_m: elevationStartM === null ? null : round2(elevationStartM),
    elevation_end_m: elevationEndM === null ? null : round2(elevationEndM),
    wind_head_ms: comps ? Math.round(comps.headMps * 100) / 100 : null,
    wind_cross_ms: comps ? Math.round(comps.crossMps * 100) / 100 : null,
    override: override !== null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const ordered = (shots: readonly Shot[]) => orderShots(shots);

const nextSeq = (shots: readonly Shot[]) => shots.reduce((m, s) => Math.max(m, s.seq), 0) + 1;

/** The in-flight shot: Hit recorded, Ball here not yet. Only the last record can be pending. */
export function pendingShot(shots: readonly Shot[]): Shot | null {
  const last = ordered(shots).at(-1);
  return last && last.start && !last.end && !last.holed && !isPenaltyRecord(last) ? last : null;
}

export const isHoled = (shots: readonly Shot[]) => shots.some((s) => s.holed);

/** Where the ball lies now: end of the last record, else the tee. */
export function ballPosition(shots: readonly Shot[], tee: LatLng | null): LatLng | null {
  const list = ordered(shots);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]!;
    if (s.end) return s.end;
    if (s.start) return s.start;
  }
  return tee;
}

function create(base: ShotBase, shots: readonly Shot[], extra: Partial<Shot>): Shot {
  return newShot({ id: uuidv4(), ...base, seq: nextSeq(shots), ...extra });
}

const replace = (shots: readonly Shot[], s: Shot) => shots.map((x) => (x.id === s.id ? s : x));

/**
 * Hit: a new shot starting at the GPS fix with the card's fields and the
 * recommendation snapshot the player saw (§9.4; write-once from here on).
 */
export function hit(
  shots: readonly Shot[],
  base: ShotBase,
  card: CardFields,
  fix: Fix,
  recommendation: RecommendationSnapshot | null = null,
): Shot[] {
  return [
    ...shots,
    create(base, shots, {
      ...card,
      start: fix.point,
      startAccuracyM: fix.accuracyM,
      recommendation,
    }),
  ];
}

/**
 * Ball here: ends the pending shot at the fix; with no pending shot the
 * shot is reconstructed (start = previous end via the chain, or the tee for
 * the first shot) using the card's fields retrospectively.
 */
export function ballHere(
  shots: readonly Shot[],
  base: ShotBase,
  card: CardFields,
  fix: Fix,
  tee: LatLng | null,
  endElevationM: number | null = null,
): { shots: Shot[]; shotId: string } {
  const pending = pendingShot(shots);
  if (pending) {
    const s = { ...pending, end: fix.point, endAccuracyM: fix.accuracyM };
    if (s.conditions && endElevationM !== null) {
      s.conditions = { ...s.conditions, elevation_end_m: round2(endElevationM) };
    }
    return { shots: replace(shots, s), shotId: s.id };
  }
  const s = create(base, shots, {
    ...card,
    start: shots.length === 0 ? tee : null,
    end: fix.point,
    endAccuracyM: fix.accuracyM,
    reconstructed: true,
  });
  return { shots: [...shots, s], shotId: s.id };
}

/** Holed: the pending (or a reconstructed) shot ends at the pin. */
export function holed(
  shots: readonly Shot[],
  base: ShotBase,
  card: CardFields,
  tee: LatLng | null,
): Shot[] {
  const pending = pendingShot(shots);
  if (pending) return replace(shots, { ...pending, holed: true });
  return [
    ...shots,
    create(base, shots, {
      ...card,
      start: shots.length === 0 ? tee : null,
      holed: true,
      reconstructed: true,
    }),
  ];
}

export type PuttResult = 'holed' | 'short' | 'past';

/**
 * A putt from the putt card. Distances are entered (GPS is too coarse on
 * the green); a missed putt's end point is placed on the start–pin line,
 * `remainingM` short of or past the hole, so the chain stays continuous.
 */
export function putt(
  shots: readonly Shot[],
  base: ShotBase,
  args: {
    clubId: string | null;
    distanceM: number;
    result: PuttResult;
    remainingM: number;
    pin: LatLng | null;
    fix: Fix | null;
    slope: StanceSlope;
  },
): Shot[] {
  let list = [...shots];
  // A pending approach ends where the player now stands.
  const pending = pendingShot(list);
  if (pending && args.fix) {
    list = replace(list, { ...pending, end: args.fix.point, endAccuracyM: args.fix.accuracyM });
  }
  const from = ballPosition(list, null);
  let end: LatLng | null = null;
  if (args.result !== 'holed' && from && args.pin) {
    const toStart = initialBearingDeg(args.pin, from);
    const bearing = args.result === 'short' ? toStart : (toStart + 180) % 360;
    end = destinationPoint(args.pin, bearing, args.remainingM);
  }
  return [
    ...list,
    create(base, list, {
      clubId: args.clubId,
      lie: 'green',
      slope: args.slope,
      puttDistanceM: args.distanceM,
      puttRemainingM: args.result === 'holed' ? 0 : args.remainingM,
      holed: args.result === 'holed',
      end,
      target: args.pin,
    }),
  ];
}

export type ReliefKind = Exclude<PenaltyKind, 'none'>;

/**
 * Where a relief option drops: a map point, the stroke-and-distance spot
 * (start of the last real shot), a GPS fix taken now, or `null` = ask for a
 * tap on the map.
 */
export type ReliefDrop = LatLng | 'stroke-distance' | 'gps' | null;

/**
 * Relief options offered after a penalty (§5.4, Rules 17–19): OB / lost ball
 * is stroke-and-distance only; penalty areas and unplayable also offer a drop
 * where the player stands (back-on-line, or lateral for red) or a map tap.
 */
export function reliefOptions(kind: ReliefKind): { label: string; drop: ReliefDrop }[] {
  const sd = { label: 'Stroke & distance', drop: 'stroke-distance' as const };
  if (kind === 'ob') return [sd];
  return [
    sd,
    {
      label:
        kind === 'yellow'
          ? 'Back-on-line: drop here (GPS)'
          : 'Lateral / back-on-line: drop here (GPS)',
      drop: 'gps',
    },
    { label: 'Tap drop point on map', drop: null },
  ];
}

/**
 * Penalty relief: a `penalty` record (club null, 1 stroke) from where the
 * ball was to the relief spot, keeping the chain and the stroke count right.
 */
export function penalty(
  shots: readonly Shot[],
  base: ShotBase,
  kind: ReliefKind,
  drop: LatLng,
): Shot[] {
  return [
    ...shots,
    create(base, shots, { clubId: null, penalty: kind, strokeCount: 1, end: drop, lie: null }),
  ];
}

/** Start of the last real (non-penalty) shot — the stroke-and-distance spot. */
export function lastShotStart(shots: readonly Shot[]): LatLng | null {
  const list = ordered(shots).filter((s) => !isPenaltyRecord(s));
  return list.at(-1)?.start ?? null;
}

// --- editing ---------------------------------------------------------------

export function updateShot(shots: readonly Shot[], s: Shot): Shot[] {
  return replace(shots, s);
}

export function deleteShot(shots: readonly Shot[], id: string): Shot[] {
  return shots.filter((s) => s.id !== id);
}

/** Move a shot's start; the previous shot's end moves with it (the chain is shared). */
export function moveStart(shots: readonly Shot[], id: string, p: LatLng): Shot[] {
  const list = ordered(shots);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return [...shots];
  return list.map((s, j) => (j === i ? { ...s, start: p } : j === i - 1 ? { ...s, end: p } : s));
}

export function moveEnd(shots: readonly Shot[], id: string, p: LatLng): Shot[] {
  const list = ordered(shots);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return [...shots];
  return list.map((s, j) =>
    j === i ? { ...s, end: p, holed: false } : j === i + 1 ? { ...s, start: p } : s,
  );
}

/**
 * Insert a blank shot before/after `id`. It shares the neighbour's seq and
 * is ordered by played_at (±1 ms); saveHole renumbers 1..n.
 */
export function insertShot(
  shots: readonly Shot[],
  base: ShotBase,
  id: string,
  where: 'before' | 'after',
  clubId: string | null,
): { shots: Shot[]; shotId: string } {
  const ref = shots.find((s) => s.id === id);
  if (!ref) return { shots: [...shots], shotId: '' };
  const t = Date.parse(ref.playedAt) + (where === 'before' ? -1 : 1);
  const s = newShot({
    id: uuidv4(),
    ...base,
    seq: ref.seq,
    playedAt: new Date(t).toISOString(),
    clubId,
    reconstructed: true,
  });
  return { shots: [...shots, s], shotId: s.id };
}
