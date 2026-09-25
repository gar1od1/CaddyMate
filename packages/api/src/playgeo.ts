/**
 * Pure course-geometry helpers used by the play view and recomputeHole:
 * what surface a point is on, front/centre/back distances, default aim, and
 * resolving a feature-relative intended line to a target point.
 */
import {
  degToRad,
  fromClubFrame,
  fromLocalXY,
  haversineDistanceM,
  initialBearingDeg,
  pointInPolygon,
  ringCentroid,
  toLocalXY,
  type LatLng,
} from '@caddymate/engine';
import type {
  FeatureKind,
  FeaturePenalty,
  Hole,
  HoleFeature,
  LieKind,
  TargetRef,
} from './types.js';

/** Feature kind → lie. Water/OB/trees/paths don't define a lie on their own. */
export const FEATURE_LIE: Partial<Record<FeatureKind, LieKind>> = {
  fairway: 'fairway',
  first_cut: 'first_cut',
  rough: 'rough',
  deep_rough: 'deep_rough',
  bunker: 'sand',
  hardpan: 'hardpan',
  pine_straw: 'pine_straw',
  wooded: 'pine_straw',
};

/**
 * Precedence when polygons overlap: hazards first (a bunker cut into a
 * fairway wins), then the tighter cuts before the looser ones.
 */
const PRECEDENCE: FeatureKind[] = [
  'ob',
  'water',
  'bunker',
  'hardpan',
  'pine_straw',
  'fairway',
  'first_cut',
  'deep_rough',
  'rough',
  'wooded',
];

export interface Surface {
  /** Lie implied by the surface; null when nothing matched. */
  lie: LieKind | null;
  /** The feature that decided it (null for the green or no match). */
  feature: HoleFeature | null;
  /** Penalty area / OB the point is in, if any. */
  penalty: FeaturePenalty;
}

/**
 * Surface under `p`. The current hole's geometry is checked first, then the
 * other holes (a wayward drive can finish on the neighbouring fairway).
 */
export function surfaceAt(holes: readonly Hole[], p: LatLng, currentHole?: number): Surface {
  const ordered = [...holes].sort(
    (a, b) => Number(b.number === currentHole) - Number(a.number === currentHole),
  );
  for (const hole of ordered) {
    const feats = hole.features
      .filter((f) => f.polygon && PRECEDENCE.includes(f.kind) && pointInPolygon(f.polygon, p))
      .sort((a, b) => PRECEDENCE.indexOf(a.kind) - PRECEDENCE.indexOf(b.kind));
    const hazard = feats.find((f) => f.kind === 'ob' || f.kind === 'water');
    if (hazard) {
      return {
        lie: null,
        feature: hazard,
        penalty:
          hazard.kind === 'ob' ? 'ob' : hazard.penalty === 'none' ? 'lateral' : hazard.penalty,
      };
    }
    if (hole.green && pointInPolygon(hole.green, p)) {
      return { lie: 'green', feature: null, penalty: 'none' };
    }
    const f = feats[0];
    if (f) return { lie: FEATURE_LIE[f.kind] ?? null, feature: f, penalty: f.penalty };
  }
  return { lie: null, feature: null, penalty: 'none' };
}

/** Lie for the pre-shot card: surface lie, else fairway (SPEC §5.3). */
export function inferLie(holes: readonly Hole[], p: LatLng, currentHole?: number): LieKind {
  return surfaceAt(holes, p, currentHole).lie ?? 'fairway';
}

/**
 * Crossings of the ray from `origin` on `bearingDeg` with a ring: the
 * nearest and farthest distances (metres) where the ray meets an edge, or
 * null when it misses. Computed in the local plane around `origin`.
 */
export function rayRingCrossings(
  origin: LatLng,
  bearingDeg: number,
  ring: readonly LatLng[],
): { nearM: number; farM: number } | null {
  const θ = degToRad(bearingDeg);
  const ux = Math.sin(θ);
  const uy = Math.cos(θ);
  const pts = ring.map((q) => toLocalXY(origin, q));
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j]!;
    const b = pts[i]!;
    // Solve t·u = a + s·(b − a), s ∈ [0, 1], t ≥ 0.
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (a.x * ey - a.y * ex) / den;
    const s = (a.x * uy - a.y * ux) / den;
    if (s < 0 || s > 1 || t < 0) continue;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  return Number.isFinite(tMin) ? { nearM: tMin, farM: tMax } : null;
}

export interface GreenDistances {
  frontM: number;
  centreM: number;
  backM: number;
}

/**
 * Distances from `ball` to the front / centre / back of the green measured
 * along the line to `centre`: the nearest and farthest crossings of that line
 * with the green outline. Falls back to centre ± 10 m without a polygon.
 */
export function greenDistances(
  ball: LatLng,
  centre: LatLng,
  green: { outer: readonly LatLng[] } | null,
): GreenDistances {
  const centreM = haversineDistanceM(ball, centre);
  const fallback = { frontM: Math.max(0, centreM - 10), centreM, backM: centreM + 10 };
  if (!green || green.outer.length < 3 || centreM < 0.5) return fallback;
  const hit = rayRingCrossings(ball, initialBearingDeg(ball, centre), green.outer);
  if (!hit) return fallback;
  // Inside the green: front is where we stand.
  const inside = pointInPolygon({ outer: green.outer }, ball);
  return { frontM: inside ? 0 : hit.nearM, centreM, backM: Math.max(hit.farM, centreM) };
}

export interface HazardOnLine {
  feature: HoleFeature;
  /** Distance to carry the near edge / reach the far edge, metres. */
  nearM: number;
  farM: number;
}

const HAZARD_KINDS: readonly FeatureKind[] = ['bunker', 'water', 'ob', 'wooded'];

/** Hazards the line from `ball` on `bearingDeg` crosses within `maxM`, nearest first. */
export function hazardsAlongLine(
  ball: LatLng,
  bearingDeg: number,
  features: readonly HoleFeature[],
  maxM: number,
): HazardOnLine[] {
  const out: HazardOnLine[] = [];
  for (const f of features) {
    if (!f.polygon || !HAZARD_KINDS.includes(f.kind)) continue;
    const hit = rayRingCrossings(ball, bearingDeg, f.polygon.outer);
    if (!hit || hit.nearM > maxM) continue;
    const inside = pointInPolygon(f.polygon, ball);
    out.push({ feature: f, nearM: inside ? 0 : hit.nearM, farM: hit.farM });
  }
  return out.sort((a, b) => a.nearM - b.nearM);
}

/**
 * Default aim: the first point along the line of play that is `distanceM`
 * from the ball (the club's stock distance), else the pin when the hole is
 * within reach or the line of play is missing.
 */
export function defaultAimPoint(
  ball: LatLng,
  lineOfPlay: readonly LatLng[] | null,
  pin: LatLng,
  distanceM: number,
): LatLng {
  if (!lineOfPlay || lineOfPlay.length < 2 || haversineDistanceM(ball, pin) <= distanceM) {
    return pin;
  }
  // Walk the polyline; find the first segment that exits the circle of radius d.
  for (let i = 1; i < lineOfPlay.length; i++) {
    const a = toLocalXY(ball, lineOfPlay[i - 1]!);
    const b = toLocalXY(ball, lineOfPlay[i]!);
    const da = Math.hypot(a.x, a.y);
    const db = Math.hypot(b.x, b.y);
    if (da <= distanceM && db >= distanceM) {
      // |a + t(b − a)| = d, solve the quadratic for t ∈ [0, 1].
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const A = ex * ex + ey * ey;
      const B = 2 * (a.x * ex + a.y * ey);
      const Cc = da * da - distanceM * distanceM;
      const disc = Math.max(0, B * B - 4 * A * Cc);
      const t = A === 0 ? 0 : (-B + Math.sqrt(disc)) / (2 * A);
      return fromLocalXY(ball, { x: a.x + t * ex, y: a.y + t * ey });
    }
  }
  return pin;
}

/** Anchor point of a feature for feature-relative aiming. */
export function featureAnchor(f: HoleFeature): LatLng | null {
  if (f.point) return f.point;
  if (f.polygon) return ringCentroid(f.polygon.outer);
  return null;
}

/**
 * Resolve a feature-relative intended line: anchor + offsets in the frame of
 * the line from the ball to the anchor (+right, +long).
 */
export function resolveTargetRef(ball: LatLng, ref: TargetRef): LatLng {
  const bearing = initialBearingDeg(ball, ref.anchor);
  const d = haversineDistanceM(ball, ref.anchor);
  return fromClubFrame(ball, bearing, { alongM: d + ref.offsetLongM, lateralM: ref.offsetRightM });
}
