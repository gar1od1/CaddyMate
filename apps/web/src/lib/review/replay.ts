/**
 * Round replay geometry (docs/SPEC.md §14): per hole, every shot start → end,
 * the aim the player chose, and the 80 % ellipse re-derived from the club's
 * pattern (§8.7). Snapshots omit the ellipse (decision 004), so it is rebuilt
 * with `ellipsePolygon` in the club frame (ball origin, +along towards the
 * aim) and mapped with `fromClubFrame`. When the snapshot's chosen option has
 * a `meanLanding` the ellipse is translated so its centre sits there: that
 * carries the conditions (wind, lie, slope) the engine applied at the time,
 * without re-running the condition model.
 *
 * Note: the pattern is the club's CURRENT stored pattern, not the one in force
 * when the shot was played (patterns are not versioned per round).
 */
import {
  ellipsePolygon,
  fromClubFrame,
  initialBearingDeg,
  toClubFrame,
  type ClubPattern,
  type DispersionLevel,
  type LatLng,
} from '@caddymate/engine';
import type { Feature, FeatureCollection, Position } from 'geojson';
import type { ReviewShot } from './shots';

const pos = (p: LatLng): Position => [p.lng, p.lat];

/** Where the player aimed: the chosen option's aim, else the card's target point. */
export function shotAim(shot: Pick<ReviewShot, 'recommendation' | 'target'>): LatLng | null {
  return shot.recommendation?.chosen?.aim ?? shot.target ?? null;
}

/** Putts and penalty-only records get no ellipse. */
const wantsEllipse = (s: ReviewShot) =>
  s.lie !== 'green' && s.clubId !== null && !(s.penalty !== 'none' && s.end === null);

/** The `level` contour of `pattern` for `shot`, as a closed lat/lng ring; null when not drawable. */
export function shotEllipse(
  shot: ReviewShot,
  pattern: ClubPattern | null | undefined,
  level: DispersionLevel = 0.8,
  steps = 48,
): LatLng[] | null {
  const aim = shotAim(shot);
  if (!pattern || !shot.start || !aim || !wantsEllipse(shot)) return null;
  const bearing = initialBearingDeg(shot.start, aim);
  let dA = 0;
  let dL = 0;
  const mean = shot.recommendation?.chosen?.meanLanding;
  if (mean) {
    const m = toClubFrame(shot.start, bearing, mean);
    dA = m.alongM - pattern.distance.mean;
    dL = m.lateralM - pattern.lateral.mean;
  }
  return ellipsePolygon(pattern, level, steps).map((r) =>
    fromClubFrame(shot.start!, bearing, { alongM: r.alongM + dA, lateralM: r.lateralM + dL }),
  );
}

export interface ReplayOptions {
  patterns: ReadonlyMap<string, ClubPattern>;
  clubName: (clubId: string | null) => string;
  /** Highlight this shot (others are dimmed). */
  selectedShotId?: string | null;
}

/**
 * One FeatureCollection with a `layer` property per feature:
 * `ellipse` (Polygon), `aim-line` / `shot` (LineString), `aim` / `end` / `start` (Point).
 */
export function holeReplayCollection(
  shots: readonly ReviewShot[],
  opts: ReplayOptions,
): FeatureCollection {
  const features: Feature[] = [];
  const sorted = [...shots].sort((a, b) => a.seq - b.seq);
  for (const s of sorted) {
    const selected = opts.selectedShotId == null || opts.selectedShotId === s.id;
    const props = {
      shotId: s.id,
      seq: s.seq,
      label: `${String(s.seq)}`,
      club: opts.clubName(s.clubId),
      selected,
      grade: s.decisionGrade ?? 'none',
    };
    const ring = shotEllipse(s, s.clubId ? opts.patterns.get(s.clubId) : null);
    if (ring) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring.map(pos)] },
        properties: { ...props, layer: 'ellipse' },
      });
    }
    const aim = shotAim(s);
    if (aim && s.start && s.lie !== 'green') {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [pos(s.start), pos(aim)] },
        properties: { ...props, layer: 'aim-line' },
      });
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pos(aim) },
        properties: { ...props, layer: 'aim' },
      });
    }
    if (s.start && s.end) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [pos(s.start), pos(s.end)] },
        properties: { ...props, layer: 'shot' },
      });
    }
    if (s.start) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pos(s.start) },
        properties: { ...props, layer: 'start' },
      });
    }
    if (s.end) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pos(s.end) },
        properties: { ...props, layer: 'end', holed: s.holed },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** [[minLng, minLat], [maxLng, maxLat]] over every coordinate, or null when empty. */
export function collectionBounds(
  fc: FeatureCollection,
  extra: readonly LatLng[] = [],
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (p: Position) => {
    minX = Math.min(minX, p[0]!);
    maxX = Math.max(maxX, p[0]!);
    minY = Math.min(minY, p[1]!);
    maxY = Math.max(maxY, p[1]!);
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === 'Point') visit(g.coordinates);
    else if (g.type === 'LineString') g.coordinates.forEach(visit);
    else if (g.type === 'Polygon') g.coordinates.flat().forEach(visit);
  }
  extra.forEach((p) => visit(pos(p)));
  return Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}
