/**
 * Seeded cone drawn from the club's stock distance until the dispersion
 * engine lands: distance band ±7 %, lateral half-width ±6 % of distance,
 * plus a core band at roughly half that size.
 */
import { fromClubFrame, type LatLng } from '@caddymate/engine';

export interface ConeShape {
  /** Outer band ring (closed), [lng, lat]. */
  outer: [number, number][];
  /** Inner "core" ring (closed). */
  core: [number, number][];
  /** Centre of the band on the intended line. */
  centre: LatLng;
}

function band(
  origin: LatLng,
  bearingDeg: number,
  distanceM: number,
  distFrac: number,
  latFrac: number,
): [number, number][] {
  const near = distanceM * (1 - distFrac);
  const far = distanceM * (1 + distFrac);
  const steps = 12;
  const pts: LatLng[] = [];
  // Near edge left→right, far edge right→left, edges fan out with distance.
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    pts.push(fromClubFrame(origin, bearingDeg, { alongM: near, lateralM: t * latFrac * near }));
  }
  for (let i = steps; i >= 0; i--) {
    const t = -1 + (2 * i) / steps;
    pts.push(fromClubFrame(origin, bearingDeg, { alongM: far, lateralM: t * latFrac * far }));
  }
  pts.push(pts[0]!);
  return pts.map((p) => [p.lng, p.lat]);
}

// TODO(wave-2): replace with engine pattern (conditioned cone/ellipse from
// packages/engine/src/dispersion, with wind/lie/slope/elevation applied).
export function placeholderCone(
  origin: LatLng,
  bearingDeg: number,
  stockDistanceM: number,
): ConeShape | null {
  if (!(stockDistanceM > 0)) return null;
  return {
    outer: band(origin, bearingDeg, stockDistanceM, 0.07, 0.06),
    core: band(origin, bearingDeg, stockDistanceM, 0.035, 0.03),
    centre: fromClubFrame(origin, bearingDeg, { alongM: stockDistanceM, lateralM: 0 }),
  };
}
