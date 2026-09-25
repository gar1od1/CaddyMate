/**
 * Play-view map: hole geometry as GeoJSON layers, the conditioned dispersion
 * overlay of the selected club (cone or ellipses, dashed edge until the
 * pattern is established, with its confidence label), the intended line,
 * this hole's shots and the pin.
 */
import {
  polygonToRings,
  toPosition,
  type CourseBundle,
  type Hole,
  type Shot,
} from '@caddymate/api';
import { initialBearingDeg, type LatLng } from '@caddymate/engine';
import { colors } from '@caddymate/ui';
import { GeoJSONSource, Layer, Marker, type CameraStop } from '@maplibre/maplibre-react-native';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CourseMap } from '@/components/CourseMap';
import type { DispersionOverlay } from '@/lib/cone';

type FC = GeoJSON.FeatureCollection;

function featuresGeoJson(holes: readonly Hole[], current: number): FC {
  const features: GeoJSON.Feature[] = [];
  for (const h of holes) {
    const here = h.number === current;
    for (const f of h.features) {
      if (f.polygon) {
        features.push({
          type: 'Feature',
          properties: { kind: f.kind, here },
          geometry: { type: 'Polygon', coordinates: polygonToRings(f.polygon) },
        });
      } else if (f.point) {
        features.push({
          type: 'Feature',
          properties: { kind: f.kind, here, radius: f.treeRadiusM ?? 4 },
          geometry: { type: 'Point', coordinates: toPosition(f.point) },
        });
      }
    }
    if (h.green) {
      features.push({
        type: 'Feature',
        properties: { kind: 'green', here },
        geometry: { type: 'Polygon', coordinates: polygonToRings(h.green) },
      });
    }
    if (here && h.lineOfPlay && h.lineOfPlay.length > 1) {
      features.push({
        type: 'Feature',
        properties: { kind: 'line_of_play', here },
        geometry: { type: 'LineString', coordinates: h.lineOfPlay.map(toPosition) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

const kindIs = (...kinds: string[]): ['in', ['get', 'kind'], ['literal', string[]]] => [
  'in',
  ['get', 'kind'],
  ['literal', kinds],
];

const CourseLayers = memo(function CourseLayers({
  bundle,
  hole,
}: {
  bundle: CourseBundle;
  hole: number;
}) {
  const data = useMemo(() => featuresGeoJson(bundle.holes, hole), [bundle, hole]);
  return (
    <GeoJSONSource id="course" data={data}>
      <Layer
        id="fairway"
        type="fill"
        filter={kindIs('fairway', 'first_cut')}
        paint={{ 'fill-color': 'rgba(120, 220, 140, 0.16)' }}
      />
      <Layer
        id="water"
        type="fill"
        filter={kindIs('water')}
        paint={{ 'fill-color': colors.hazardWater }}
      />
      <Layer
        id="bunker"
        type="fill"
        filter={kindIs('bunker')}
        paint={{ 'fill-color': colors.hazardBunker }}
      />
      <Layer
        id="green"
        type="fill"
        filter={kindIs('green')}
        paint={{ 'fill-color': 'rgba(61, 220, 132, 0.30)' }}
      />
      <Layer
        id="outline"
        type="line"
        filter={[
          'all',
          ['==', ['geometry-type'], 'Polygon'],
          kindIs('fairway', 'green', 'bunker', 'water'),
        ]}
        paint={{
          'line-color': [
            'case',
            ['get', 'here'],
            'rgba(255,255,255,0.7)',
            'rgba(255,255,255,0.25)',
          ],
          'line-width': 1,
        }}
      />
      <Layer
        id="ob"
        type="line"
        filter={kindIs('ob')}
        paint={{ 'line-color': '#FFFFFF', 'line-width': 2, 'line-dasharray': [2, 2] }}
      />
      <Layer
        id="trees"
        type="circle"
        filter={['all', ['==', ['geometry-type'], 'Point'], kindIs('tree')]}
        paint={{ 'circle-color': 'rgba(20, 90, 40, 0.6)', 'circle-radius': 6 }}
      />
      <Layer
        id="line-of-play"
        type="line"
        filter={kindIs('line_of_play')}
        paint={{
          'line-color': 'rgba(255,255,255,0.35)',
          'line-width': 1.5,
          'line-dasharray': [3, 3],
        }}
      />
    </GeoJSONSource>
  );
});

interface Props {
  bundle: CourseBundle;
  hole: number;
  camera: CameraStop;
  cone: DispersionOverlay | null;
  /** Origin of the intended line (ball or GPS). */
  origin: LatLng | null;
  target: LatLng | null;
  pin: LatLng | null;
  shots: readonly Shot[];
  selectedShotId: string | null;
  drop: LatLng | null;
  onPress: (p: LatLng) => void;
  onShotPress: (id: string) => void;
}

export function HoleMap(props: Props) {
  const { bundle, hole, camera, cone, origin, target, pin, shots, selectedShotId } = props;

  const overlay = useMemo<FC>(() => {
    const features: GeoJSON.Feature[] = [];
    if (cone) {
      for (const r of cone.rings) {
        features.push({
          type: 'Feature',
          properties: { k: r.kind },
          geometry: { type: 'Polygon', coordinates: [r.ring] },
        });
      }
      features.push({
        type: 'Feature',
        properties: { k: cone.dashed ? 'edge-dashed' : 'edge' },
        geometry: { type: 'LineString', coordinates: cone.edge },
      });
    }
    if (origin && target) {
      features.push({
        type: 'Feature',
        properties: { k: 'aim' },
        geometry: { type: 'LineString', coordinates: [toPosition(origin), toPosition(target)] },
      });
    }
    for (const s of shots) {
      if (s.start && s.end) {
        features.push({
          type: 'Feature',
          properties: { k: s.id === selectedShotId ? 'shot-selected' : 'shot' },
          geometry: { type: 'LineString', coordinates: [toPosition(s.start), toPosition(s.end)] },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [cone, origin, target, shots, selectedShotId]);

  const bearingToTarget = origin && target ? initialBearingDeg(origin, target) : 0;

  return (
    <CourseMap camera={camera} onPress={props.onPress}>
      <CourseLayers bundle={bundle} hole={hole} />
      <GeoJSONSource id="overlay" data={overlay}>
        <Layer
          id="cone"
          type="fill"
          filter={['in', ['get', 'k'], ['literal', ['cone', 'e80']]]}
          paint={{ 'fill-color': colors.cone }}
        />
        <Layer
          id="ellipse-95"
          type="fill"
          filter={['==', ['get', 'k'], 'e95']}
          paint={{ 'fill-color': colors.cone, 'fill-opacity': 0.45 }}
        />
        <Layer
          id="cone-core"
          type="fill"
          filter={['in', ['get', 'k'], ['literal', ['core', 'e1']]]}
          paint={{ 'fill-color': colors.coneCore }}
        />
        <Layer
          id="cone-edge"
          type="line"
          filter={['==', ['get', 'k'], 'edge']}
          paint={{ 'line-color': colors.coneCore, 'line-width': 1.5 }}
        />
        <Layer
          id="cone-edge-dashed"
          type="line"
          filter={['==', ['get', 'k'], 'edge-dashed']}
          paint={{ 'line-color': colors.coneCore, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
        />
        <Layer
          id="aim"
          type="line"
          filter={['==', ['get', 'k'], 'aim']}
          paint={{ 'line-color': '#FFFFFF', 'line-width': 2 }}
        />
        <Layer
          id="shots"
          type="line"
          filter={['in', ['get', 'k'], ['literal', ['shot', 'shot-selected']]]}
          paint={{
            'line-color': [
              'case',
              ['==', ['get', 'k'], 'shot-selected'],
              colors.accent,
              colors.warning,
            ],
            'line-width': ['case', ['==', ['get', 'k'], 'shot-selected'], 4, 2.5],
          }}
        />
      </GeoJSONSource>

      {shots.map((s) =>
        s.end && !s.holed ? (
          <Marker
            key={s.id}
            id={s.id}
            lngLat={toPosition(s.end)}
            onPress={() => props.onShotPress(s.id)}
          >
            <View style={[styles.dot, s.id === selectedShotId && styles.dotSelected]}>
              <Text style={styles.dotText}>{s.seq}</Text>
            </View>
          </Marker>
        ) : null,
      )}
      {cone ? (
        <Marker id="cone-label" lngLat={toPosition(cone.centre)} anchor="top">
          <View style={styles.coneLabel} pointerEvents="none">
            <Text style={styles.coneLabelText}>{cone.label}</Text>
          </View>
        </Marker>
      ) : null}
      {target ? (
        <Marker id="target" lngLat={toPosition(target)}>
          <View
            style={[styles.target, { transform: [{ rotate: `${String(bearingToTarget)}deg` }] }]}
          />
        </Marker>
      ) : null}
      {props.drop ? (
        <Marker id="drop" lngLat={toPosition(props.drop)}>
          <View style={styles.drop} />
        </Marker>
      ) : null}
      {pin ? (
        <Marker id="pin" lngLat={toPosition(pin)} anchor="bottom">
          <View style={styles.pinWrap}>
            <View style={styles.flag} />
            <View style={styles.pole} />
          </View>
        </Marker>
      ) : null}
    </CourseMap>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  dotSelected: { backgroundColor: colors.accent },
  dotText: { fontSize: 11, fontWeight: '800', color: '#000' },
  coneLabel: {
    marginTop: 14,
    backgroundColor: 'rgba(11, 31, 20, 0.75)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coneLabelText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  target: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  drop: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  pinWrap: { alignItems: 'flex-start' },
  flag: { width: 14, height: 10, backgroundColor: colors.danger, marginLeft: 2 },
  pole: { width: 2, height: 20, backgroundColor: '#FFF', marginLeft: 2 },
});
