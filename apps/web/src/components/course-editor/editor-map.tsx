'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './editor.css';
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { FeatureCollection, Geometry, LineString, Polygon, Position } from 'geojson';
import type { GeoJSONSource, Marker } from 'maplibre-gl';
import type MapboxDraw from '@mapbox/mapbox-gl-draw';
import { SatelliteMap } from '@/components/map/satellite-map';
import type { MaplibreMap, MaplibreModule } from '@/components/map/maplibre';
import { formatYards, markerYardageM } from '@/lib/courses/geometry';
import { snapPoint, SNAP_TOLERANCE_PX, type SnapGeometry, type SnapHit } from '@/lib/courses/snap';
import type { CourseDoc } from '@/lib/courses/types';
import {
  buildCourseCollection,
  COURSE_LAYERS,
  COURSE_SOURCE,
  DRAW_STYLES,
  type HiddenKey,
} from './map-style';
import { snappingModes, type DrawMode, type Snapper } from './snap-modes';

/** What the draw tool is doing right now. */
export type DrawSession =
  { mode: 'polygon' | 'line' | 'point' } | { mode: 'edit'; geometry: Polygon | LineString };

export interface EditorMapHandle {
  /** Geometry of the shape being edited (mode 'edit'), or null. */
  finishEdit(): Polygon | LineString | null;
  /** Delete the selected vertex while editing. */
  trash(): void;
  focusHole(holeId: string): void;
  fitAll(): void;
}

interface Props {
  doc: CourseDoc;
  centre: { lat: number; lng: number };
  boundary: Polygon | null;
  selectedHoleId: string | null;
  selectedFeatureId: string | null;
  hidden: HiddenKey;
  session: DrawSession | null;
  /** Geometries the shape in the draw tool snaps to (empty: snapping off). */
  snapTo: readonly SnapGeometry[];
  onDrawn: (geometry: Geometry) => void;
  onDrawCancelled: () => void;
  onSelectHole: (holeId: string) => void;
  onSelectFeature: (featureId: string, holeId: string) => void;
  className?: string;
  ref?: Ref<EditorMapHandle>;
}

const EDIT_ID = 'cm-edit';
const SNAP_SOURCE = 'cm-snap';

const MODE_FOR: Record<'polygon' | 'line' | 'point', string> = {
  polygon: 'draw_polygon',
  line: 'draw_line_string',
  point: 'draw_point',
};

type Bounds = [[number, number], [number, number]];

function boundsOf(positions: Position[]): Bounds | null {
  if (positions.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of positions) {
    w = Math.min(w, x!);
    e = Math.max(e, x!);
    s = Math.min(s, y!);
    n = Math.max(n, y!);
  }
  return [
    [w, s],
    [e, n],
  ];
}

function positionsOf(g: Geometry | null): Position[] {
  if (!g) return [];
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'LineString':
      return g.coordinates;
    case 'Polygon':
      return g.coordinates.flat();
    default:
      return [];
  }
}

async function createDraw(snap: Snapper): Promise<MapboxDraw> {
  const { default: Draw } = await import('@mapbox/mapbox-gl-draw');
  // `modes` is untyped in components/map/mapbox-gl-draw.d.ts.
  const stock = (Draw as unknown as { modes: Record<string, DrawMode> }).modes;
  // mapbox-gl-draw toggles mapbox CSS classes; point them at MapLibre's.
  Object.assign(Draw.constants.classes, {
    CANVAS: 'maplibregl-canvas',
    CONTROL_BASE: 'maplibregl-ctrl',
    CONTROL_PREFIX: 'maplibregl-ctrl-',
    CONTROL_GROUP: 'maplibregl-ctrl-group',
    ATTRIBUTION: 'maplibregl-ctrl-attrib',
  });
  const options = {
    displayControlsDefault: false,
    controls: {},
    styles: DRAW_STYLES,
    boxSelect: false,
    clickBuffer: 4,
    modes: snappingModes(stock, snap),
  };
  return new Draw(options);
}

const snapCue = (hit: SnapHit | null): FeatureCollection => ({
  type: 'FeatureCollection',
  features: hit
    ? [
        {
          type: 'Feature',
          properties: { kind: hit.kind },
          geometry: { type: 'Point', coordinates: hit.position },
        },
      ]
    : [],
});

/** Satellite map + course layers + mapbox-gl-draw for editing one geometry at a time. */
export function EditorMap(props: Props) {
  const { doc, selectedHoleId, selectedFeatureId, hidden, session, boundary, ref } = props;
  const mapRef = useRef<MaplibreMap | null>(null);
  const mlRef = useRef<MaplibreModule | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const readyRef = useRef(false);
  const cueRef = useRef<string>('');
  // Latest props for map event handlers registered once.
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });

  const render = useCallback(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !readyRef.current) return;
    const p = live.current;
    const src = map.getSource<GeoJSONSource>(COURSE_SOURCE);
    void src?.setData(
      buildCourseCollection(p.doc, {
        selectedHoleId: p.selectedHoleId,
        selectedFeatureId: p.selectedFeatureId,
        hidden: p.hidden,
        boundary: p.boundary,
      }),
    );

    // Hole numbers at each tee, bold yardage over the selected green (HTML
    // markers: the raster style has no glyphs for symbol layers).
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const h of p.doc.holes) {
      const anchor = h.line_of_play?.coordinates[0] ?? h.green_centre?.coordinates;
      if (!anchor) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = String(h.hole_number);
      el.className = `cm-hole-badge${h.hole_id === p.selectedHoleId ? ' cm-hole-badge--selected' : ''}`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!live.current.session) live.current.onSelectHole(h.hole_id);
      });
      markersRef.current.push(
        new ml.Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
          .setLngLat(anchor as [number, number])
          .addTo(map),
      );
    }
    const hole = p.doc.holes.find((h) => h.hole_id === p.selectedHoleId);
    if (hole?.green_centre) {
      const firstSet = p.doc.tee_sets[0];
      const marker = firstSet
        ? p.doc.tee_markers.find(
            (m) => m.hole_id === hole.hole_id && m.tee_set_id === firstSet.tee_set_id,
          )
        : undefined;
      const yards = marker ? markerYardageM(marker, hole) : null;
      if (yards != null) {
        const el = document.createElement('div');
        el.className = 'cm-yardage';
        el.textContent = formatYards(yards).replace(' yds', '');
        markersRef.current.push(
          new ml.Marker({ element: el, anchor: 'bottom', offset: [0, -10] })
            .setLngLat(hole.green_centre.coordinates as [number, number])
            .addTo(map),
        );
      }
    }
  }, []);

  const fit = useCallback((positions: Position[], maxZoom = 18) => {
    const b = boundsOf(positions);
    if (b && mapRef.current) mapRef.current.fitBounds(b, { padding: 60, maxZoom, duration: 600 });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      finishEdit() {
        const f = drawRef.current?.get(EDIT_ID);
        const g = f?.geometry;
        return g && (g.type === 'Polygon' || g.type === 'LineString') ? g : null;
      },
      trash() {
        drawRef.current?.trash();
      },
      focusHole(holeId) {
        const d = live.current.doc;
        const h = d.holes.find((x) => x.hole_id === holeId);
        if (!h) return;
        fit([
          ...positionsOf(h.line_of_play),
          ...positionsOf(h.green_polygon),
          ...positionsOf(h.green_centre),
          ...d.tee_markers
            .filter((m) => m.hole_id === holeId)
            .map((m) => m.marker_point.coordinates),
        ]);
      },
      fitAll() {
        const d = live.current.doc;
        fit([
          ...d.holes.flatMap((h) => [
            ...positionsOf(h.line_of_play),
            ...positionsOf(h.green_polygon),
          ]),
          ...d.tee_markers.map((m) => m.marker_point.coordinates),
        ]);
      },
    }),
    [fit],
  );

  // Snap a cursor position to the current targets and show the cue (a ring on
  // the snapped point). Hold Alt to place a vertex freely.
  const snap = useCallback<Snapper>((lngLat, e) => {
    const map = mapRef.current;
    const targets = live.current.snapTo;
    const hit =
      map && lngLat && targets.length > 0 && !e?.originalEvent?.altKey
        ? snapPoint([lngLat.lng, lngLat.lat], targets, SNAP_TOLERANCE_PX, (p) =>
            map.project(p as [number, number]),
          )
        : null;
    const key = hit ? hit.position.join(',') : '';
    if (map && key !== cueRef.current) {
      cueRef.current = key;
      void map.getSource<GeoJSONSource>(SNAP_SOURCE)?.setData(snapCue(hit));
    }
    return hit && lngLat
      ? { lng: hit.position[0]!, lat: hit.position[1]! }
      : (lngLat ?? { lng: 0, lat: 0 });
  }, []);

  const onLoad = useCallback(
    (map: MaplibreMap, ml: MaplibreModule) => {
      mapRef.current = map;
      mlRef.current = ml;
      map.addSource(COURSE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      for (const layer of COURSE_LAYERS) map.addLayer(layer);

      const pick = (e: { features?: { properties: Record<string, unknown> }[] }) => {
        if (live.current.session) return;
        const props = e.features?.[0]?.properties;
        if (!props) return;
        if (typeof props.id === 'string') {
          live.current.onSelectFeature(props.id, String(props.holeId));
        } else if (typeof props.holeId === 'string') {
          live.current.onSelectHole(props.holeId);
        }
      };
      // Topmost first: points, then greens/lines, then feature fills.
      const clickable = ['cm-tee', 'cm-tree', 'cm-green-fill', 'cm-line', 'cm-feature-fill'];
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
        if (hits.length > 0) pick({ features: [hits[0]!] });
      });
      for (const id of clickable) {
        map.on('mouseenter', id, () => {
          if (!live.current.session) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', id, () => {
          if (!live.current.session) map.getCanvas().style.cursor = '';
        });
      }

      void createDraw(snap).then((draw) => {
        if (mapRef.current !== map) return;
        drawRef.current = draw;
        map.addControl(draw as never);
        // Snap cue above the draw layers.
        map.addSource(SNAP_SOURCE, { type: 'geojson', data: snapCue(null) });
        map.addLayer({
          id: 'cm-snap-cue',
          type: 'circle',
          source: SNAP_SOURCE,
          paint: {
            'circle-radius': ['case', ['==', ['get', 'kind'], 'vertex'], 9, 7],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#22d3ee',
            'circle-stroke-width': 3,
          },
        });
        const events = map as unknown as {
          on(
            type: string,
            listener: (e: { features?: { geometry: Geometry }[]; mode?: string }) => void,
          ): void;
        };
        let created = false;
        events.on('draw.create', (e) => {
          const g = e.features?.[0]?.geometry;
          if (!g) return;
          created = true;
          live.current.onDrawn(g);
        });
        events.on('draw.modechange', (e) => {
          const s = live.current.session;
          // Escape in a create mode drops back to simple_select with nothing drawn.
          if (e.mode === 'simple_select' && s && s.mode !== 'edit' && !created) {
            live.current.onDrawCancelled();
          }
          created = false;
        });
        readyRef.current = true;
        render();
        applySession(draw, live.current.session);
        if (live.current.doc.holes.length > 0) {
          const d = live.current.doc;
          fit(
            [
              ...d.holes.flatMap((h) => [
                ...positionsOf(h.line_of_play),
                ...positionsOf(h.green_polygon),
              ]),
              ...d.tee_markers.map((m) => m.marker_point.coordinates),
            ],
            17,
          );
        }
      });
    },
    [render, fit, snap],
  );

  // Re-render layers whenever the document or selection changes.
  useEffect(() => {
    render();
  }, [doc, selectedHoleId, selectedFeatureId, hidden, boundary, render]);

  // Start/stop the draw tool when the session changes.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !readyRef.current) return;
    applySession(draw, session);
    snap(null);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = session && session.mode !== 'edit' ? 'crosshair' : '';
  }, [session, snap]);

  useEffect(
    () => () => {
      for (const m of markersRef.current) m.remove();
    },
    [],
  );

  return (
    <SatelliteMap center={props.centre} zoom={16} className={props.className} onLoad={onLoad} />
  );
}

function applySession(draw: MapboxDraw, session: DrawSession | null) {
  draw.deleteAll();
  if (!session) {
    draw.changeMode('simple_select');
    return;
  }
  if (session.mode === 'edit') {
    draw.add({ type: 'Feature', id: EDIT_ID, properties: {}, geometry: session.geometry });
    draw.changeMode('direct_select', { featureId: EDIT_ID });
    return;
  }
  draw.changeMode(MODE_FOR[session.mode]);
}
