import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import type { AddLayerObject } from 'maplibre-gl';
import type { CourseDoc, FeatureKind } from '@/lib/courses/types';

export const COURSE_SOURCE = 'cm-course';

export const KIND_COLOURS: Record<FeatureKind, string> = {
  fairway: '#4ade80',
  first_cut: '#86efac',
  rough: '#65a30d',
  deep_rough: '#3f6212',
  bunker: '#fde68a',
  water: '#38bdf8',
  ob: '#f87171',
  hardpan: '#a8a29e',
  pine_straw: '#d97706',
  tree: '#15803d',
  wooded: '#166534',
  cart_path: '#d4d4d8',
};

const SELECTED = '#facc15';

/** Ids of the geometry currently open in the draw tool, hidden from the static layers. */
export type HiddenKey = `line:${string}` | `green:${string}` | `feature:${string}` | null;

export interface LayerState {
  selectedHoleId: string | null;
  selectedFeatureId: string | null;
  hidden: HiddenKey;
  boundary: Polygon | null;
}

/** Everything the editor draws, as one FeatureCollection for one GeoJSON source. */
export function buildCourseCollection(doc: CourseDoc, s: LayerState): FeatureCollection {
  const out: Feature[] = [];
  const push = (geometry: Geometry | null, properties: Record<string, unknown>) => {
    if (geometry) out.push({ type: 'Feature', geometry, properties });
  };
  if (s.boundary) push(s.boundary, { layer: 'boundary' });

  for (const f of doc.features) {
    if (s.hidden === `feature:${f.feature_id}`) continue;
    push(f.kind === 'tree' ? f.point : f.polygon, {
      layer: f.kind === 'tree' ? 'tree' : 'feature',
      id: f.feature_id,
      holeId: f.hole_id,
      kind: f.kind,
      colour: KIND_COLOURS[f.kind],
      onHole: f.hole_id === s.selectedHoleId,
      selected: f.feature_id === s.selectedFeatureId,
    });
  }
  for (const h of doc.holes) {
    const selected = h.hole_id === s.selectedHoleId;
    if (s.hidden !== `green:${h.hole_id}`) {
      push(h.green_polygon, { layer: 'green', holeId: h.hole_id, selected });
    }
    if (s.hidden !== `line:${h.hole_id}`) {
      push(h.line_of_play, { layer: 'line', holeId: h.hole_id, selected });
    }
    push(h.green_centre, { layer: 'green_centre', holeId: h.hole_id, selected });
  }
  const colours = new Map(doc.tee_sets.map((t) => [t.tee_set_id, t.colour_hex ?? '#ffffff']));
  for (const m of doc.tee_markers) {
    push(m.marker_point, {
      layer: 'tee',
      holeId: m.hole_id,
      colour: colours.get(m.tee_set_id) ?? '#ffffff',
      selected: m.hole_id === s.selectedHoleId,
    });
  }
  return { type: 'FeatureCollection', features: out };
}

const is = (layer: string) => ['==', ['get', 'layer'], layer] as const;

export const COURSE_LAYERS: AddLayerObject[] = [
  {
    id: 'cm-boundary',
    type: 'line',
    source: COURSE_SOURCE,
    filter: is('boundary') as never,
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.5,
      'line-width': 1,
      'line-dasharray': [4, 3],
    },
  },
  {
    id: 'cm-feature-fill',
    type: 'fill',
    source: COURSE_SOURCE,
    filter: is('feature') as never,
    paint: {
      'fill-color': ['get', 'colour'],
      'fill-opacity': ['case', ['get', 'selected'], 0.55, ['get', 'onHole'], 0.4, 0.18],
    },
  },
  {
    id: 'cm-feature-line',
    type: 'line',
    source: COURSE_SOURCE,
    filter: is('feature') as never,
    paint: {
      'line-color': ['case', ['get', 'selected'], SELECTED, ['get', 'colour']],
      'line-width': ['case', ['get', 'selected'], 3, ['get', 'onHole'], 1.5, 0.75],
    },
  },
  {
    id: 'cm-green-fill',
    type: 'fill',
    source: COURSE_SOURCE,
    filter: is('green') as never,
    paint: { 'fill-color': '#3ddc84', 'fill-opacity': ['case', ['get', 'selected'], 0.55, 0.3] },
  },
  {
    id: 'cm-green-line',
    type: 'line',
    source: COURSE_SOURCE,
    filter: is('green') as never,
    paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'selected'], 2, 1] },
  },
  {
    id: 'cm-line',
    type: 'line',
    source: COURSE_SOURCE,
    filter: is('line') as never,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['get', 'selected'], '#ffffff', '#e5e7eb'],
      'line-width': ['case', ['get', 'selected'], 3, 1.5],
      'line-opacity': ['case', ['get', 'selected'], 1, 0.6],
      'line-dasharray': [2, 1.5],
    },
  },
  {
    id: 'cm-tree',
    type: 'circle',
    source: COURSE_SOURCE,
    filter: is('tree') as never,
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 7, 5],
      'circle-color': ['get', 'colour'],
      'circle-stroke-color': ['case', ['get', 'selected'], SELECTED, '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'selected'], 2.5, 1],
    },
  },
  {
    id: 'cm-green-centre',
    type: 'circle',
    source: COURSE_SOURCE,
    filter: is('green_centre') as never,
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 5, 3],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#0b1f14',
      'circle-stroke-width': 1.5,
    },
  },
  {
    id: 'cm-tee',
    type: 'circle',
    source: COURSE_SOURCE,
    filter: is('tee') as never,
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 7, 5],
      'circle-color': ['get', 'colour'],
      'circle-stroke-color': '#0b1f14',
      'circle-stroke-width': 2,
    },
  },
];

/** Styles for the geometry currently open in mapbox-gl-draw (expression filters only). */
export const DRAW_STYLES: object[] = [
  {
    id: 'cm-draw-fill',
    type: 'fill',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': SELECTED, 'fill-opacity': 0.15 },
  },
  {
    id: 'cm-draw-line',
    type: 'line',
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': SELECTED, 'line-width': 2.5 },
  },
  {
    id: 'cm-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'meta'], 'midpoint']],
    paint: { 'circle-radius': 4, 'circle-color': SELECTED, 'circle-opacity': 0.8 },
  },
  {
    id: 'cm-draw-vertex',
    type: 'circle',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'meta'], 'vertex']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': '#ffffff',
      'circle-stroke-color': SELECTED,
      'circle-stroke-width': 2,
    },
  },
  {
    id: 'cm-draw-point',
    type: 'circle',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'meta'], 'feature']],
    paint: {
      'circle-radius': 7,
      'circle-color': SELECTED,
      'circle-stroke-color': '#0b1f14',
      'circle-stroke-width': 2,
    },
  },
];
