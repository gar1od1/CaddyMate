/**
 * Vertex/edge snapping for the course editor (docs/SPEC.md §13 "snapping").
 *
 * Pure: the caller supplies `project` (lng/lat → screen pixels, e.g.
 * `map.project`), so the tolerance is in pixels and snapping feels the same at
 * every zoom. A vertex within tolerance always wins over an edge, even a closer
 * one, so shared corners line up exactly; otherwise the cursor is projected
 * onto the nearest edge. Only the point being placed moves — neighbouring
 * features are never modified (no vertex is inserted into them).
 */
import type { LineString, Polygon, Position } from 'geojson';
import type { CourseDoc } from './types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export type Project = (p: Position) => ScreenPoint;

/** Geometries a point can snap to. */
export type SnapGeometry = Polygon | LineString;

export interface SnapHit {
  /** Snapped [lng, lat]. */
  position: Position;
  kind: 'vertex' | 'edge';
  /** Screen distance from the candidate, px. */
  distancePx: number;
}

/** Default pick radius, CSS pixels. */
export const SNAP_TOLERANCE_PX = 12;

/** Polylines to test: each polygon ring closed (so the closing edge counts), lines as-is. */
function pathsOf(g: SnapGeometry): Position[][] {
  if (g.type === 'LineString') return [g.coordinates];
  return g.coordinates
    .filter((ring) => ring.length > 0)
    .map((ring) => {
      const a = ring[0]!;
      const b = ring[ring.length - 1]!;
      return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
    });
}

/**
 * Snap `candidate` to the nearest vertex of `geometries` within `tolerancePx`,
 * else to the nearest point on an edge within `tolerancePx`, else null.
 *
 * The edge point is interpolated in lng/lat at the screen-space parameter; over
 * a golf hole's extent Web Mercator is linear to well under a centimetre.
 */
export function snapPoint(
  candidate: Position,
  geometries: readonly SnapGeometry[],
  tolerancePx: number,
  project: Project,
): SnapHit | null {
  const c = project(candidate);
  const paths = geometries.flatMap(pathsOf).map((path) => ({ path, px: path.map(project) }));

  let vertex: SnapHit | null = null;
  for (const { path, px } of paths) {
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(px[i]!.x - c.x, px[i]!.y - c.y);
      if (d <= tolerancePx && (!vertex || d < vertex.distancePx)) {
        vertex = { position: [path[i]![0]!, path[i]![1]!], kind: 'vertex', distancePx: d };
      }
    }
  }
  if (vertex) return vertex;

  let edge: SnapHit | null = null;
  for (const { path, px } of paths) {
    for (let i = 1; i < path.length; i++) {
      const pa = px[i - 1]!;
      const pb = px[i]!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.min(1, Math.max(0, ((c.x - pa.x) * dx + (c.y - pa.y) * dy) / len2));
      const d = Math.hypot(pa.x + t * dx - c.x, pa.y + t * dy - c.y);
      if (d <= tolerancePx && (!edge || d < edge.distancePx)) {
        const a = path[i - 1]!;
        const b = path[i]!;
        edge = {
          position: [a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!)],
          kind: 'edge',
          distancePx: d,
        };
      }
    }
  }
  return edge;
}

/**
 * What a shape drawn on `holeId` may snap to: that hole's feature polygons and
 * its green. `exclude` is the editor's hidden key for the geometry open in the
 * draw tool (`feature:<id>`, `green:<holeId>`, `line:<holeId>`) so a shape
 * never snaps to its own old outline. Lines of play and tree points are not
 * snap targets.
 */
export function snapTargets(
  doc: CourseDoc,
  holeId: string | null,
  exclude: string | null,
): SnapGeometry[] {
  if (!holeId) return [];
  const out: SnapGeometry[] = [];
  for (const f of doc.features) {
    if (f.hole_id === holeId && f.polygon && exclude !== `feature:${f.feature_id}`) {
      out.push(f.polygon);
    }
  }
  const green = doc.holes.find((h) => h.hole_id === holeId)?.green_polygon;
  if (green && exclude !== `green:${holeId}`) out.push(green);
  return out;
}
