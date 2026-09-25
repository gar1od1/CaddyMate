/**
 * Small GeoJSON helpers shared by the editor and the OSM mapper. Maths comes
 * from @caddymate/engine; this file only converts between GeoJSON positions
 * ([lng, lat]) and the engine's {lat, lng}.
 */
import type { LineString, Point, Polygon, Position } from 'geojson';
import {
  distanceToSegmentM,
  haversineDistanceM,
  metresToYards,
  ringCentroid,
  type LatLng,
} from '@caddymate/engine';
import type { HoleRow, TeeMarkerRow } from './types';

export const toLatLng = (p: Position): LatLng => ({ lat: p[1]!, lng: p[0]! });
export const toPosition = (p: LatLng): Position => [p.lng, p.lat];

export const point = (p: LatLng): Point => ({ type: 'Point', coordinates: toPosition(p) });

/** Ring without the repeated closing vertex. */
export function openRing(ring: readonly Position[]): Position[] {
  const n = ring.length;
  if (n > 1 && ring[0]![0] === ring[n - 1]![0] && ring[0]![1] === ring[n - 1]![1]) {
    return ring.slice(0, -1);
  }
  return [...ring];
}

/** Ring with a repeated closing vertex, as GeoJSON requires. */
export function closeRing(ring: readonly Position[]): Position[] {
  const open = openRing(ring);
  return open.length === 0 ? [] : [...open, open[0]!];
}

export function polygonCentroid(poly: Polygon): LatLng {
  return ringCentroid(openRing(poly.coordinates[0] ?? []).map(toLatLng));
}

/** Shortest distance from `p` to a polyline, metres. */
export function distanceToLineM(line: readonly LatLng[], p: LatLng): number {
  if (line.length === 1) return haversineDistanceM(line[0]!, p);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = distanceToSegmentM(p, line[i - 1]!, line[i]!);
    if (d < best) best = d;
  }
  return best;
}

export const roundTo = (x: number, dp: number): number => {
  const k = 10 ** dp;
  return Math.round(x * k) / k;
};

/** Tee marker → green centre, metres (null until both exist). */
export function markerYardageM(marker: TeeMarkerRow, hole: HoleRow | undefined): number | null {
  if (!hole?.green_centre) return null;
  return haversineDistanceM(
    toLatLng(marker.marker_point.coordinates),
    toLatLng(hole.green_centre.coordinates),
  );
}

/** Length of the line of play, metres. */
export function lineLengthM(line: LineString | null): number | null {
  if (!line || line.coordinates.length < 2) return null;
  let total = 0;
  for (let i = 1; i < line.coordinates.length; i++) {
    total += haversineDistanceM(toLatLng(line.coordinates[i - 1]!), toLatLng(line.coordinates[i]!));
  }
  return total;
}

export const formatYards = (m: number | null): string =>
  m == null ? '—' : `${Math.round(metresToYards(m))} yds`;
