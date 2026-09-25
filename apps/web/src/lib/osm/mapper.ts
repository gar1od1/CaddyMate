/**
 * Overpass JSON → CaddyMate course draft (SPEC §6.2, §13).
 *
 * Mapping rules
 *   golf=hole (way)            → holes: number from `ref`, `par` (else estimated from
 *                                length), line of play = the way (tee → green; reversed
 *                                if a green sits at its start), `handicap` → stroke index
 *   golf=green                 → the hole whose line END is nearest: green_polygon, and
 *                                green_centre = polygon centroid
 *   golf=tee                   → centroid, assigned to the hole whose line START is
 *                                nearest; the closest one becomes that hole's marker in a
 *                                "Default" tee set (fallback: the line's first vertex)
 *   golf=fairway|rough|bunker  → hole_features of the same kind (bunker → bunker)
 *   golf=water_hazard, golf=lateral_water_hazard, natural=water
 *                              → water, penalty `lateral` (editable afterwards)
 *   golf=out_of_bounds, golf=driving_range
 *                              → ob, penalty `ob` (a range next to a hole is usually OB)
 *   natural=wood, landuse=forest → wooded
 *   natural=tree (node)        → tree (point)
 *   leisure=golf_course        → course name, boundary polygon and centre
 * Every polygon feature is assigned to the hole whose line of play is nearest,
 * and dropped if that is further than `maxAssignDistanceM`.
 */
import type { Polygon as GeoPolygon, Position } from 'geojson';
import {
  haversineDistanceM,
  pointInRing,
  ringCentroid,
  toLocalXY,
  type LatLng,
} from '@caddymate/engine';
import { distanceToLineM, point, roundTo } from '@/lib/courses/geometry';
import {
  defaultPenalty,
  type CourseDoc,
  type FeatureKind,
  type FeaturePenalty,
  type FeatureRow,
  type HoleRow,
  type TeeMarkerRow,
  type TeeSetRow,
} from '@/lib/courses/types';
import type { OverpassElement, OverpassLatLon, OverpassResponse, OverpassTags } from './overpass';

export interface OsmMapOptions {
  /** Id generator for new rows (tests pass a deterministic one). */
  newId?: () => string;
  /** Features further than this from every hole line are skipped. */
  maxAssignDistanceM?: number;
  /** Greens further than this from a hole's end are not attached to it. */
  maxGreenDistanceM?: number;
  /** Tees further than this from a hole's start are not attached to it. */
  maxTeeDistanceM?: number;
}

export interface OsmCourseInfo {
  name: string | null;
  /** Boundary centroid, else the mean of hole endpoints; null if nothing was found. */
  centre: LatLng | null;
  boundary: GeoPolygon | null;
  /** 'way/123' or 'relation/123' of the leisure=golf_course element. */
  osmRef: string | null;
}

export interface OsmImportStats {
  holes: number;
  greens: number;
  teeMarkers: number;
  features: number;
  /** Features that were too far from every hole. */
  unassigned: number;
  /** Elements with tags we do not map (clubhouse, paths, pins, …). */
  ignored: number;
}

export interface OsmImportResult {
  course: OsmCourseInfo;
  doc: CourseDoc;
  warnings: string[];
  stats: OsmImportStats;
}

// ---------------------------------------------------------------------------
// Geometry extraction
// ---------------------------------------------------------------------------

type Ring = LatLng[];

interface Poly {
  outer: Ring;
  inners: Ring[];
}

interface Shape {
  ref: string;
  tags: OverpassTags;
  point?: LatLng;
  line?: LatLng[];
  polygons?: Poly[];
}

const ll = (p: OverpassLatLon): LatLng => ({ lat: p.lat, lng: p.lon });

const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng;

function isClosed(pts: readonly LatLng[]): boolean {
  return pts.length >= 4 && samePoint(pts[0]!, pts[pts.length - 1]!);
}

/** Drop the closing vertex; null if fewer than three distinct vertices remain. */
function toRing(pts: readonly LatLng[]): Ring | null {
  const ring = isClosed(pts) ? pts.slice(0, -1) : [...pts];
  const distinct = new Set(ring.map((p) => `${p.lat},${p.lng}`));
  return distinct.size >= 3 ? ring : null;
}

/** Stitch open way segments into closed rings (OSM multipolygon members). */
function assembleRings(segments: LatLng[][]): Ring[] {
  const rings: Ring[] = [];
  const pending = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  while (pending.length > 0) {
    let current = pending.shift()!;
    let grew = true;
    while (!isClosed(current) && grew) {
      grew = false;
      const tail = current[current.length - 1]!;
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i]!;
        if (samePoint(seg[0]!, tail)) current = [...current, ...seg.slice(1)];
        else if (samePoint(seg[seg.length - 1]!, tail)) {
          current = [...current, ...[...seg].reverse().slice(1)];
        } else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    // Unclosable fragments are dropped (the member list was incomplete).
    if (isClosed(current)) {
      const ring = toRing(current);
      if (ring) rings.push(ring);
    }
  }
  return rings;
}

function shapeOf(el: OverpassElement): Shape | null {
  const tags = el.tags ?? {};
  const ref = `${el.type}/${el.id}`;
  if (el.type === 'node') return { ref, tags, point: { lat: el.lat, lng: el.lon } };
  if (el.type === 'way') {
    const pts = (el.geometry ?? []).map(ll);
    if (pts.length < 2) return null;
    if (isClosed(pts)) {
      const ring = toRing(pts);
      return ring ? { ref, tags, polygons: [{ outer: ring, inners: [] }], line: pts } : null;
    }
    return { ref, tags, line: pts };
  }
  const memberRings = (role: string) =>
    assembleRings(
      el.members
        .filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry)
        .map((m) => m.geometry!.map(ll)),
    );
  const outers = memberRings('outer');
  if (outers.length === 0) return null;
  const inners = memberRings('inner');
  const polygons = outers.map((outer) => ({
    outer,
    inners: inners.filter((inner) => pointInRing(outer, inner[0]!)),
  }));
  return { ref, tags, polygons };
}

function ringAreaM2(ring: Ring): number {
  const o = ring[0]!;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = toLocalXY(o, ring[j]!);
    const q = toLocalXY(o, ring[i]!);
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

const COORD_DP = 7;
const pos = (p: LatLng): Position => [roundTo(p.lng, COORD_DP), roundTo(p.lat, COORD_DP)];
const closedPositions = (ring: Ring): Position[] => [...ring.map(pos), pos(ring[0]!)];

function toGeoPolygon(p: Poly): GeoPolygon {
  return { type: 'Polygon', coordinates: [p.outer, ...p.inners].map(closedPositions) };
}

/** Distance from a point to a polygon: 0 inside, else to the nearest edge. */
function distanceToPolyM(poly: Poly, p: LatLng): number {
  if (pointInRing(poly.outer, p)) return 0;
  return distanceToLineM([...poly.outer, poly.outer[0]!], p);
}

/** How far a polygon is from a hole's line of play. */
function polyToLineM(poly: Poly, line: LatLng[]): number {
  if (line.some((p) => pointInRing(poly.outer, p))) return 0;
  let best = distanceToLineM(line, ringCentroid(poly.outer));
  for (const v of poly.outer) best = Math.min(best, distanceToLineM(line, v));
  return best;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type Role =
  | { role: 'hole' }
  | { role: 'green' }
  | { role: 'tee' }
  | { role: 'boundary' }
  | { role: 'feature'; kind: FeatureKind; penalty: FeaturePenalty }
  | { role: 'ignore' };

const GOLF_FEATURES: Record<string, FeatureKind> = {
  fairway: 'fairway',
  rough: 'rough',
  bunker: 'bunker',
  water_hazard: 'water',
  lateral_water_hazard: 'water',
  out_of_bounds: 'ob',
  driving_range: 'ob',
};

function classify(tags: OverpassTags): Role {
  const golf = tags.golf;
  if (golf === 'hole') return { role: 'hole' };
  if (golf === 'green') return { role: 'green' };
  if (golf === 'tee') return { role: 'tee' };
  const golfKind = golf ? GOLF_FEATURES[golf] : undefined;
  if (golfKind) return { role: 'feature', kind: golfKind, penalty: defaultPenalty(golfKind) };
  if (golf) return { role: 'ignore' };
  if (tags.leisure === 'golf_course') return { role: 'boundary' };
  if (tags.natural === 'water') return { role: 'feature', kind: 'water', penalty: 'lateral' };
  if (tags.natural === 'wood' || tags.landuse === 'forest') {
    return { role: 'feature', kind: 'wooded', penalty: 'none' };
  }
  if (tags.natural === 'tree') return { role: 'feature', kind: 'tree', penalty: 'none' };
  return { role: 'ignore' };
}

const intTag = (v: string | undefined, min: number, max: number): number | null => {
  if (v == null) return null;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Men's-tee rule of thumb used only when OSM has no par tag. */
export function estimatePar(lengthM: number): number {
  if (lengthM <= 230) return 3;
  if (lengthM <= 430) return 4;
  return 5;
}

function lineLength(line: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineDistanceM(line[i - 1]!, line[i]!);
  return total;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

interface HoleWork {
  row: HoleRow;
  line: LatLng[];
  strokeIndex: number | null;
  ref: string;
  green: { poly: Poly; distM: number } | null;
  tee: { at: LatLng; distM: number } | null;
}

export function mapOverpassToCourse(
  response: OverpassResponse,
  options: OsmMapOptions = {},
): OsmImportResult {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const maxAssign = options.maxAssignDistanceM ?? 100;
  const maxGreen = options.maxGreenDistanceM ?? 60;
  const maxTee = options.maxTeeDistanceM ?? 80;
  const warnings: string[] = [];
  const stats: OsmImportStats = {
    holes: 0,
    greens: 0,
    teeMarkers: 0,
    features: 0,
    unassigned: 0,
    ignored: 0,
  };

  const holeShapes: Shape[] = [];
  const greens: Poly[] = [];
  const tees: LatLng[] = [];
  const boundaries: { shape: Shape; poly: Poly }[] = [];
  const features: { shape: Shape; kind: FeatureKind; penalty: FeaturePenalty }[] = [];

  // Overpass can return the same element twice when several union clauses match.
  const seen = new Set<string>();
  for (const el of response.elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const shape = shapeOf(el);
    if (!shape) continue;
    const r = classify(shape.tags);
    switch (r.role) {
      case 'hole':
        if (shape.line && !shape.polygons) holeShapes.push(shape);
        else stats.ignored++;
        break;
      case 'green':
        if (shape.polygons) greens.push(...shape.polygons);
        else stats.ignored++;
        break;
      case 'tee':
        if (shape.polygons) tees.push(...shape.polygons.map((p) => ringCentroid(p.outer)));
        else if (shape.point) tees.push(shape.point);
        break;
      case 'boundary':
        for (const poly of shape.polygons ?? []) boundaries.push({ shape, poly });
        break;
      case 'feature':
        if (r.kind === 'tree' ? shape.point : shape.polygons) features.push({ shape, ...r });
        else stats.ignored++;
        break;
      default:
        stats.ignored++;
    }
  }

  // ---- holes --------------------------------------------------------------
  const used = new Set<number>();
  const pending: HoleWork[] = [];
  const unnumbered: HoleWork[] = [];
  for (const shape of holeShapes) {
    const line = shape.line!;
    const lengthM = lineLength(line);
    const par = intTag(shape.tags.par, 3, 6) ?? estimatePar(lengthM);
    const work: HoleWork = {
      row: {
        hole_id: newId(),
        hole_number: 0,
        par,
        line_of_play: null,
        green_polygon: null,
        green_centre: null,
      },
      line,
      strokeIndex: intTag(shape.tags.handicap, 1, 18),
      ref: shape.ref,
      green: null,
      tee: null,
    };
    const n = intTag(shape.tags.ref, 1, 36);
    if (n != null && !used.has(n)) {
      used.add(n);
      work.row.hole_number = n;
      pending.push(work);
    } else {
      if (n != null) warnings.push(`Duplicate hole ref ${n} on ${shape.ref}; renumbered.`);
      unnumbered.push(work);
    }
  }
  let next = 1;
  for (const work of unnumbered) {
    while (used.has(next)) next++;
    if (next > 36) {
      warnings.push(`Too many holes; ${work.ref} skipped.`);
      continue;
    }
    used.add(next);
    work.row.hole_number = next;
    pending.push(work);
  }
  const holes = pending.sort((a, b) => a.row.hole_number - b.row.hole_number);
  stats.holes = holes.length;
  if (holes.length === 0) {
    warnings.push(
      'No golf=hole ways found: holes must be drawn by hand and features were not imported.',
    );
  }

  // Orientation: OSM hole ways run tee → green, but not always. If a green is
  // clearly nearer the first vertex, flip the line.
  for (const h of holes) {
    const start = h.line[0]!;
    const end = h.line[h.line.length - 1]!;
    const dStart = Math.min(Infinity, ...greens.map((g) => distanceToPolyM(g, start)));
    const dEnd = Math.min(Infinity, ...greens.map((g) => distanceToPolyM(g, end)));
    if (dStart < dEnd && dStart <= maxGreen) {
      h.line = [...h.line].reverse();
      warnings.push(`Hole ${h.row.hole_number}: line of play was drawn green → tee; reversed.`);
    }
    h.row.line_of_play = { type: 'LineString', coordinates: h.line.map(pos) };
  }

  // ---- greens: nearest hole END ---------------------------------------------
  for (const g of greens) {
    let best: HoleWork | null = null;
    let bestD = Infinity;
    for (const h of holes) {
      const d = distanceToPolyM(g, h.line[h.line.length - 1]!);
      if (d < bestD) [best, bestD] = [h, d];
    }
    if (best && bestD <= maxGreen && (!best.green || bestD < best.green.distM)) {
      best.green = { poly: g, distM: bestD };
    }
  }
  for (const h of holes) {
    if (!h.green) {
      warnings.push(`Hole ${h.row.hole_number}: no green found near the end of the line of play.`);
      continue;
    }
    stats.greens++;
    h.row.green_polygon = toGeoPolygon(h.green.poly);
    const c = ringCentroid(h.green.poly.outer);
    h.row.green_centre = { type: 'Point', coordinates: pos(c) };
  }

  // ---- tees: nearest hole START --------------------------------------------
  for (const t of tees) {
    let best: HoleWork | null = null;
    let bestD = Infinity;
    for (const h of holes) {
      const d = haversineDistanceM(h.line[0]!, t);
      if (d < bestD) [best, bestD] = [h, d];
    }
    if (best && bestD <= maxTee && (!best.tee || bestD < best.tee.distM)) {
      best.tee = { at: t, distM: bestD };
    }
  }

  const teeSets: TeeSetRow[] = [];
  const markers: TeeMarkerRow[] = [];
  if (holes.length > 0) {
    const teeSet: TeeSetRow = {
      tee_set_id: newId(),
      name: 'Default',
      colour_hex: '#ffffff',
      course_rating: null,
      slope_rating: null,
      bogey_rating: null,
      par: holes.reduce((s, h) => s + h.row.par, 0),
    };
    teeSets.push(teeSet);
    for (const h of holes) {
      if (!h.tee) {
        warnings.push(
          `Hole ${h.row.hole_number}: no golf=tee found; marker placed at the line start.`,
        );
      }
      const at = h.tee?.at ?? h.line[0]!;
      const green = h.row.green_centre;
      markers.push({
        tee_id: newId(),
        tee_set_id: teeSet.tee_set_id,
        hole_id: h.row.hole_id,
        marker_point: { type: 'Point', coordinates: pos(at) },
        stroke_index: h.strokeIndex,
        yardage_m: green
          ? roundTo(
              haversineDistanceM(at, { lat: green.coordinates[1]!, lng: green.coordinates[0]! }),
              1,
            )
          : null,
      });
    }
    stats.teeMarkers = markers.length;
  }

  // ---- features: nearest hole LINE -----------------------------------------
  const featureRows: FeatureRow[] = [];
  const nearestHole = (dist: (h: HoleWork) => number): HoleWork | null => {
    let best: HoleWork | null = null;
    let bestD = Infinity;
    for (const h of holes) {
      const d = dist(h);
      if (d < bestD) [best, bestD] = [h, d];
    }
    return bestD <= maxAssign ? best : null;
  };
  for (const f of features) {
    const base = {
      kind: f.kind,
      penalty: f.penalty,
      tree_radius_m: null,
      tree_height_m: null,
      notes: f.shape.tags.name ? `${f.shape.tags.name} (OSM ${f.shape.ref})` : `OSM ${f.shape.ref}`,
    };
    if (f.kind === 'tree') {
      const p = f.shape.point!;
      const h = nearestHole((hw) => distanceToLineM(hw.line, p));
      if (!h) {
        stats.unassigned++;
        continue;
      }
      const height = f.shape.tags.height ? Number.parseFloat(f.shape.tags.height) : NaN;
      featureRows.push({
        ...base,
        feature_id: newId(),
        hole_id: h.row.hole_id,
        polygon: null,
        point: point({ lat: roundTo(p.lat, COORD_DP), lng: roundTo(p.lng, COORD_DP) }),
        tree_height_m: Number.isFinite(height) ? height : null,
      });
      continue;
    }
    for (const poly of f.shape.polygons!) {
      const h = nearestHole((hw) => polyToLineM(poly, hw.line));
      if (!h) {
        stats.unassigned++;
        continue;
      }
      featureRows.push({
        ...base,
        feature_id: newId(),
        hole_id: h.row.hole_id,
        polygon: toGeoPolygon(poly),
        point: null,
      });
    }
  }
  stats.features = featureRows.length;
  if (stats.unassigned > 0 && holes.length > 0) {
    warnings.push(
      `${stats.unassigned} feature(s) more than ${maxAssign} m from every hole were skipped.`,
    );
  }

  // ---- course info ---------------------------------------------------------
  const largest = boundaries.reduce<{ shape: Shape; poly: Poly } | null>(
    (best, b) => (!best || ringAreaM2(b.poly.outer) > ringAreaM2(best.poly.outer) ? b : best),
    null,
  );
  let centre: LatLng | null = largest ? ringCentroid(largest.poly.outer) : null;
  if (!centre && holes.length > 0) {
    const ends = holes.flatMap((h) => [h.line[0]!, h.line[h.line.length - 1]!]);
    centre = {
      lat: ends.reduce((s, p) => s + p.lat, 0) / ends.length,
      lng: ends.reduce((s, p) => s + p.lng, 0) / ends.length,
    };
  }

  return {
    course: {
      name: largest?.shape.tags.name ?? null,
      centre: centre
        ? { lat: roundTo(centre.lat, COORD_DP), lng: roundTo(centre.lng, COORD_DP) }
        : null,
      boundary: largest ? toGeoPolygon({ outer: largest.poly.outer, inners: [] }) : null,
      osmRef: largest?.shape.ref ?? null,
    },
    doc: {
      holes: holes.map((h) => h.row),
      features: featureRows,
      tee_sets: teeSets,
      tee_markers: markers,
    },
    warnings,
    stats,
  };
}
