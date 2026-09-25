'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Feature } from 'geojson';
import type { AddLayerObject, GeoJSONSource } from 'maplibre-gl';
import { polygonToRings, toPosition } from '@caddymate/api';
import {
  explainOption,
  type ClubPattern,
  type LatLng,
  type Polygon,
  type StrategyOption,
} from '@caddymate/engine';
import { SatelliteMap } from '@/components/map/satellite-map';
import type { MaplibreMap } from '@/components/map/maplibre';
import { KIND_COLOURS } from '@/components/course-editor/map-style';
import type { FeatureKind } from '@/lib/courses/types';
import { collectionBounds, holeReplayCollection } from '@/lib/review/replay';
import { sgText, yds } from '@/lib/review/format';
import type { ReviewShot } from '@/lib/review/shots';

export interface ReplayHole {
  number: number;
  par: number;
  green: Polygon | null;
  greenCentre: LatLng | null;
  lineOfPlay: LatLng[] | null;
  features: { kind: FeatureKind; polygon: Polygon | null }[];
}

export interface ReplayProps {
  holes: ReplayHole[];
  shots: ReviewShot[];
  patterns: [string, ClubPattern][];
  clubNames: Record<string, string>;
  pins: Record<string, LatLng>;
}

const HOLE_SRC = 'rv-hole';
const SHOT_SRC = 'rv-shots';
const layerIs = (l: string) => ['==', ['get', 'layer'], l] as never;
const dim = (on: number, off: number) => ['case', ['get', 'selected'], on, off] as never;

const LAYERS: AddLayerObject[] = [
  {
    id: 'rv-feature',
    type: 'fill',
    source: HOLE_SRC,
    filter: layerIs('feature'),
    paint: { 'fill-color': ['get', 'colour'] as never, 'fill-opacity': 0.25 },
  },
  {
    id: 'rv-green',
    type: 'line',
    source: HOLE_SRC,
    filter: layerIs('green'),
    paint: { 'line-color': '#ffffff', 'line-width': 1.5 },
  },
  {
    id: 'rv-line',
    type: 'line',
    source: HOLE_SRC,
    filter: layerIs('line'),
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.4, 'line-dasharray': [2, 2] },
  },
  {
    id: 'rv-pin',
    type: 'circle',
    source: HOLE_SRC,
    filter: layerIs('pin'),
    paint: {
      'circle-radius': 5,
      'circle-color': '#facc15',
      'circle-stroke-color': '#0b1f14',
      'circle-stroke-width': 2,
    },
  },
  {
    id: 'rv-ellipse-fill',
    type: 'fill',
    source: SHOT_SRC,
    filter: layerIs('ellipse'),
    paint: { 'fill-color': '#3987e5', 'fill-opacity': dim(0.22, 0.05) },
  },
  {
    id: 'rv-ellipse-line',
    type: 'line',
    source: SHOT_SRC,
    filter: layerIs('ellipse'),
    paint: { 'line-color': '#3987e5', 'line-width': dim(2, 1), 'line-opacity': dim(1, 0.35) },
  },
  {
    id: 'rv-aim-line',
    type: 'line',
    source: SHOT_SRC,
    filter: layerIs('aim-line'),
    paint: {
      'line-color': '#facc15',
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      'line-opacity': dim(0.9, 0.25),
    },
  },
  {
    id: 'rv-shot',
    type: 'line',
    source: SHOT_SRC,
    filter: layerIs('shot'),
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': dim(3, 2), 'line-opacity': dim(1, 0.45) },
  },
  {
    id: 'rv-aim',
    type: 'circle',
    source: SHOT_SRC,
    filter: layerIs('aim'),
    paint: {
      'circle-radius': 4,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#facc15',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': dim(1, 0.3),
    },
  },
  {
    id: 'rv-end',
    type: 'circle',
    source: SHOT_SRC,
    filter: ['any', layerIs('end'), layerIs('start')] as never,
    paint: {
      'circle-radius': dim(5, 3.5),
      'circle-color': [
        'match',
        ['get', 'grade'],
        'good',
        '#3ddc84',
        'poor',
        '#f06262',
        '#ffffff',
      ] as never,
      'circle-stroke-color': '#0b1f14',
      'circle-stroke-width': 1.5,
      'circle-opacity': dim(1, 0.5),
    },
  },
];

function holeCollection(h: ReplayHole, pin: LatLng | null): FeatureCollection {
  const out: Feature[] = [];
  for (const f of h.features) {
    if (!f.polygon) continue;
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: polygonToRings(f.polygon) },
      properties: { layer: 'feature', colour: KIND_COLOURS[f.kind] },
    });
  }
  if (h.green) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: polygonToRings(h.green) },
      properties: { layer: 'green' },
    });
  }
  if (h.lineOfPlay && h.lineOfPlay.length > 1) {
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: h.lineOfPlay.map(toPosition) },
      properties: { layer: 'line' },
    });
  }
  if (pin) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toPosition(pin) },
      properties: { layer: 'pin' },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

const asOption = (o: NonNullable<ReviewShot['recommendation']>['baseline']): StrategyOption => ({
  ...o,
  ellipse80: [],
});

/** Per-hole map replay with a shot list; click a shot to highlight it. */
export function Replay({ holes, shots, patterns, clubNames, pins }: ReplayProps) {
  const playedHoles = useMemo(
    () => [...new Set(shots.map((s) => s.holeNumber))].sort((a, b) => a - b),
    [shots],
  );
  const [holeNumber, setHoleNumber] = useState(playedHoles[0] ?? holes[0]?.number ?? 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const fittedHole = useRef<number | null>(null);

  const patternMap = useMemo(() => new Map(patterns), [patterns]);
  const hole = holes.find((h) => h.number === holeNumber) ?? null;
  const holeShots = useMemo(
    () => shots.filter((s) => s.holeNumber === holeNumber).sort((a, b) => a.seq - b.seq),
    [shots, holeNumber],
  );
  const pin = pins[String(holeNumber)] ?? hole?.greenCentre ?? null;
  const clubName = (id: string | null) => (id ? (clubNames[id] ?? '?') : '—');

  const shotFc = useMemo(
    () =>
      holeReplayCollection(holeShots, {
        patterns: patternMap,
        clubName: (id) => (id ? (clubNames[id] ?? '?') : '—'),
        selectedShotId: selected,
      }),
    [holeShots, patternMap, clubNames, selected],
  );
  const holeFc = useMemo(
    () => (hole ? holeCollection(hole, pin) : { type: 'FeatureCollection' as const, features: [] }),
    [hole, pin],
  );

  const start = holeShots.find((s) => s.start)?.start ??
    hole?.greenCentre ??
    shots.find((s) => s.start)?.start ?? { lat: 53.35, lng: -6.26 };
  const [initialCenter] = useState(start);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource(HOLE_SRC)) {
      map.addSource(HOLE_SRC, { type: 'geojson', data: holeFc });
      map.addSource(SHOT_SRC, { type: 'geojson', data: shotFc });
      for (const l of LAYERS) map.addLayer(l);
    } else {
      (map.getSource(HOLE_SRC) as GeoJSONSource).setData(holeFc);
      (map.getSource(SHOT_SRC) as GeoJSONSource).setData(shotFc);
    }
    if (fittedHole.current !== holeNumber) {
      fittedHole.current = holeNumber;
      const extra = [hole?.greenCentre, ...(hole?.lineOfPlay ?? [])].filter(
        (p): p is LatLng => !!p,
      );
      const b = collectionBounds(shotFc, extra);
      if (b) map.fitBounds(b, { padding: 60, maxZoom: 18, duration: 600 });
    }
  }, [map, holeFc, shotFc, holeNumber, hole]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Hole">
        {(playedHoles.length ? playedHoles : holes.map((h) => h.number)).map((n) => (
          <button
            key={n}
            role="tab"
            aria-selected={n === holeNumber}
            onClick={() => {
              setHoleNumber(n);
              setSelected(null);
            }}
            className={`h-8 min-w-8 rounded-md px-2 text-sm ${
              n === holeNumber ? 'bg-accent text-accent-text font-semibold' : 'border border-border'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SatelliteMap
          center={initialCenter}
          zoom={16}
          className="h-[460px] overflow-hidden rounded-xl border border-border"
          onLoad={(m) => setMap(m)}
        />
        <div className="space-y-2">
          <p className="text-muted text-sm">
            Hole {holeNumber}
            {hole ? ` · par ${String(hole.par)}` : ''} · {holeShots.length} shots
          </p>
          <p className="text-faint text-xs">
            White: shot. Yellow: chosen aim. Blue: 80 % ellipse from the club&apos;s current
            pattern.
          </p>
          <ol className="space-y-1">
            {holeShots.map((s) => {
              const rec = s.recommendation;
              const active = selected === s.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setSelected(active ? null : s.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      active ? 'border-accent bg-bg-elevated' : 'border-border'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {s.seq}. {clubName(s.clubId)}
                        {s.penalty !== 'none' ? ` · ${s.penalty}` : ''}
                      </span>
                      <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        SG {sgText(s.sg)}
                      </span>
                    </div>
                    <div className="text-muted text-xs">
                      {s.lie ?? '—'} → {s.holed ? 'holed' : (s.resultSurface ?? '—')}
                      {s.observedDistanceM !== null ? ` · ${yds(s.observedDistanceM)} yds` : ''}
                      {s.decisionGrade ? ` · decision ${s.decisionGrade}` : ''}
                      {s.executionGrade ? ` · execution ${s.executionGrade}` : ''}
                    </div>
                    {active && rec?.chosen ? (
                      <p className="mt-1 text-xs">
                        {explainOption(asOption(rec.chosen), asOption(rec.baseline))}
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
