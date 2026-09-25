/**
 * Pure, immutable edits of a {@link CourseDoc}. The editor keeps the whole
 * draft in memory and saves it in one `course_save_draft` call, so every UI
 * action is one of these functions.
 */
import type { LineString, Point, Polygon } from 'geojson';
import { markerYardageM, polygonCentroid, point, roundTo } from './geometry';
import {
  defaultPenalty,
  isPointKind,
  type CourseDoc,
  type FeatureKind,
  type FeatureRow,
  type HoleRow,
  type TeeMarkerRow,
  type TeeSetRow,
} from './types';

export type NewId = () => string;

const replace = <T>(xs: readonly T[], match: (x: T) => boolean, patch: Partial<NoInfer<T>>): T[] =>
  xs.map((x) => (match(x) ? { ...x, ...patch } : x));

export function nextHoleNumber(doc: CourseDoc): number {
  const used = new Set(doc.holes.map((h) => h.hole_number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

const sortHoles = (holes: HoleRow[]) => [...holes].sort((a, b) => a.hole_number - b.hole_number);

export function addHole(doc: CourseDoc, newId: NewId, par = 4): { doc: CourseDoc; hole: HoleRow } {
  const hole: HoleRow = {
    hole_id: newId(),
    hole_number: nextHoleNumber(doc),
    par,
    line_of_play: null,
    green_polygon: null,
    green_centre: null,
  };
  return { doc: { ...doc, holes: sortHoles([...doc.holes, hole]) }, hole };
}

export function updateHole(
  doc: CourseDoc,
  holeId: string,
  patch: Partial<Omit<HoleRow, 'hole_id'>>,
): CourseDoc {
  const holes = replace(doc.holes, (h) => h.hole_id === holeId, patch);
  return { ...doc, holes: patch.hole_number != null ? sortHoles(holes) : holes };
}

/** Setting a green polygon also sets the green centre if there is none yet. */
export function setGreenPolygon(
  doc: CourseDoc,
  holeId: string,
  polygon: Polygon | null,
): CourseDoc {
  const hole = doc.holes.find((h) => h.hole_id === holeId);
  const centre: Point | null =
    hole?.green_centre ?? (polygon ? point(roundLatLng(polygonCentroid(polygon))) : null);
  return updateHole(doc, holeId, { green_polygon: polygon, green_centre: centre });
}

const roundLatLng = (p: { lat: number; lng: number }) => ({
  lat: roundTo(p.lat, 7),
  lng: roundTo(p.lng, 7),
});

export function removeHole(doc: CourseDoc, holeId: string): CourseDoc {
  return {
    ...doc,
    holes: doc.holes.filter((h) => h.hole_id !== holeId),
    features: doc.features.filter((f) => f.hole_id !== holeId),
    tee_markers: doc.tee_markers.filter((m) => m.hole_id !== holeId),
  };
}

export function addFeature(
  doc: CourseDoc,
  newId: NewId,
  holeId: string,
  kind: FeatureKind,
  geometry: Polygon | Point,
): { doc: CourseDoc; feature: FeatureRow } {
  const feature: FeatureRow = {
    feature_id: newId(),
    hole_id: holeId,
    kind,
    penalty: defaultPenalty(kind),
    polygon: geometry.type === 'Polygon' ? geometry : null,
    point: geometry.type === 'Point' ? geometry : null,
    tree_radius_m: kind === 'tree' ? 4 : null,
    tree_height_m: kind === 'tree' ? 10 : null,
    notes: null,
  };
  return { doc: { ...doc, features: [...doc.features, feature] }, feature };
}

export function updateFeature(
  doc: CourseDoc,
  featureId: string,
  patch: Partial<Omit<FeatureRow, 'feature_id'>>,
): CourseDoc {
  return { ...doc, features: replace(doc.features, (f) => f.feature_id === featureId, patch) };
}

export function removeFeature(doc: CourseDoc, featureId: string): CourseDoc {
  return { ...doc, features: doc.features.filter((f) => f.feature_id !== featureId) };
}

export function addTeeSet(
  doc: CourseDoc,
  newId: NewId,
  init: Partial<Omit<TeeSetRow, 'tee_set_id'>> = {},
): { doc: CourseDoc; teeSet: TeeSetRow } {
  const names = new Set(doc.tee_sets.map((t) => t.name));
  let name = init.name ?? 'White';
  for (let i = 2; names.has(name); i++) name = `${init.name ?? 'Tee'} ${i}`;
  const teeSet: TeeSetRow = {
    tee_set_id: newId(),
    colour_hex: '#ffffff',
    course_rating: null,
    slope_rating: null,
    bogey_rating: null,
    par: doc.holes.reduce((s, h) => s + h.par, 0) || null,
    ...init,
    name,
  };
  return { doc: { ...doc, tee_sets: [...doc.tee_sets, teeSet] }, teeSet };
}

export function updateTeeSet(
  doc: CourseDoc,
  teeSetId: string,
  patch: Partial<Omit<TeeSetRow, 'tee_set_id'>>,
): CourseDoc {
  return { ...doc, tee_sets: replace(doc.tee_sets, (t) => t.tee_set_id === teeSetId, patch) };
}

export function removeTeeSet(doc: CourseDoc, teeSetId: string): CourseDoc {
  return {
    ...doc,
    tee_sets: doc.tee_sets.filter((t) => t.tee_set_id !== teeSetId),
    tee_markers: doc.tee_markers.filter((m) => m.tee_set_id !== teeSetId),
  };
}

export function findMarker(
  doc: CourseDoc,
  teeSetId: string,
  holeId: string,
): TeeMarkerRow | undefined {
  return doc.tee_markers.find((m) => m.tee_set_id === teeSetId && m.hole_id === holeId);
}

/** Create or move the marker of one tee set on one hole. */
export function placeTeeMarker(
  doc: CourseDoc,
  newId: NewId,
  teeSetId: string,
  holeId: string,
  at: Point,
): CourseDoc {
  const existing = findMarker(doc, teeSetId, holeId);
  if (existing) {
    return {
      ...doc,
      tee_markers: replace(doc.tee_markers, (m) => m.tee_id === existing.tee_id, {
        marker_point: at,
      }),
    };
  }
  const marker: TeeMarkerRow = {
    tee_id: newId(),
    tee_set_id: teeSetId,
    hole_id: holeId,
    marker_point: at,
    stroke_index: null,
    yardage_m: null,
  };
  return { ...doc, tee_markers: [...doc.tee_markers, marker] };
}

export function updateMarker(
  doc: CourseDoc,
  teeId: string,
  patch: Partial<Omit<TeeMarkerRow, 'tee_id'>>,
): CourseDoc {
  return { ...doc, tee_markers: replace(doc.tee_markers, (m) => m.tee_id === teeId, patch) };
}

export function removeMarker(doc: CourseDoc, teeId: string): CourseDoc {
  return { ...doc, tee_markers: doc.tee_markers.filter((m) => m.tee_id !== teeId) };
}

/** Recompute every marker's stored yardage (tee marker → green centre). */
export function withYardages(doc: CourseDoc): CourseDoc {
  const holes = new Map(doc.holes.map((h) => [h.hole_id, h]));
  return {
    ...doc,
    tee_markers: doc.tee_markers.map((m) => {
      const d = markerYardageM(m, holes.get(m.hole_id));
      return { ...m, yardage_m: d == null ? null : roundTo(d, 1) };
    }),
  };
}

export function setLineOfPlay(doc: CourseDoc, holeId: string, line: LineString | null): CourseDoc {
  return updateHole(doc, holeId, { line_of_play: line });
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

/** Errors block saving/publishing; warnings are shown but allowed. */
export function validateDoc(doc: CourseDoc): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });

  const numbers = new Map<number, number>();
  for (const h of doc.holes) numbers.set(h.hole_number, (numbers.get(h.hole_number) ?? 0) + 1);
  for (const [n, count] of numbers) if (count > 1) err(`Hole number ${n} is used ${count} times.`);
  for (const h of doc.holes) {
    if (!Number.isInteger(h.hole_number) || h.hole_number < 1 || h.hole_number > 36) {
      err(`Hole numbers must be 1–36 (got ${h.hole_number}).`);
    }
    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6)
      err(`Hole ${h.hole_number}: par must be 3–6.`);
    if (!h.line_of_play) warn(`Hole ${h.hole_number}: no line of play.`);
    if (!h.green_centre) warn(`Hole ${h.hole_number}: no green centre.`);
  }

  for (const f of doc.features) {
    if (isPointKind(f.kind) ? !f.point : !f.polygon) {
      err(`A ${f.kind} feature has no ${isPointKind(f.kind) ? 'point' : 'polygon'}.`);
    }
  }

  const setNames = new Set<string>();
  for (const t of doc.tee_sets) {
    if (!t.name.trim()) err('Every tee set needs a name.');
    else if (setNames.has(t.name)) err(`Tee set name "${t.name}" is used twice.`);
    setNames.add(t.name);
    if (t.slope_rating != null && (t.slope_rating < 55 || t.slope_rating > 155)) {
      err(`${t.name}: slope rating must be 55–155.`);
    }
    const markers = doc.tee_markers.filter((m) => m.tee_set_id === t.tee_set_id);
    const missing = doc.holes.filter((h) => !markers.some((m) => m.hole_id === h.hole_id));
    if (missing.length > 0) {
      warn(`${t.name}: no tee marker on hole ${missing.map((h) => h.hole_number).join(', ')}.`);
    }
    const si = new Map<number, number>();
    for (const m of markers) {
      if (m.stroke_index == null) continue;
      if (m.stroke_index < 1 || m.stroke_index > 18) err(`${t.name}: stroke index must be 1–18.`);
      si.set(m.stroke_index, (si.get(m.stroke_index) ?? 0) + 1);
    }
    for (const [n, count] of si)
      if (count > 1) warn(`${t.name}: stroke index ${n} used ${count} times.`);
  }
  if (doc.holes.length > 0 && doc.tee_sets.length === 0)
    warn('No tee sets yet (needed to publish).');
  return issues;
}
