/**
 * Small static schematic of one shot for the worst-five list (docs/SPEC.md
 * §14): hole shapes, the 80 % ellipse, the aim line, the shot and the pin,
 * line-up (the shot plays up). Geometry comes from the pure
 * `features/review/thumbnail`.
 *
 * Why not MapLibre's `StaticMapImageManager.createImage`? Its API can render
 * a style JSON (satellite source + inline GeoJSON layers) to a PNG, but each
 * image is a native snapshot that fetches raster tiles over the network at
 * render time — five per Decisions tab, blank when the review is opened
 * offline after the round — and it can't run under vitest or `expo export`
 * checks. The SVG schematic is offline, instant and unit-tested; tapping the
 * row still opens the full satellite Replay for that shot.
 */
import type { Hole } from '@caddymate/api';
import type { LatLng } from '@caddymate/engine';
import { colors, radius } from '@caddymate/ui';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import type { ReplayShot } from '@/features/review/review';
import { shotThumbnail, type ThumbShapeKind } from '@/features/review/thumbnail';

const FILL: Record<ThumbShapeKind, string> = {
  fairway: 'rgba(120, 220, 140, 0.22)',
  green: 'rgba(61, 220, 132, 0.45)',
  bunker: colors.hazardBunker,
  water: colors.hazardWater,
};

export function ShotThumb({
  frame,
  hole,
  pin,
  width = 96,
  height = 72,
}: {
  frame: ReplayShot | null;
  hole: Hole | null;
  pin: LatLng | null;
  width?: number;
  height?: number;
}) {
  const t = useMemo(
    () => (frame ? shotThumbnail(frame, hole, pin, { width, height }) : null),
    [frame, hole, pin, width, height],
  );
  return (
    <View style={[styles.box, { width, height }]}>
      {t ? (
        <Svg width={width} height={height}>
          {t.shapes.map((s, i) => (
            <Polygon
              key={`${s.kind}-${String(i)}`}
              points={s.points}
              fill={FILL[s.kind]}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={0.5}
            />
          ))}
          {t.ellipse ? (
            <Polygon
              points={t.ellipse}
              fill={colors.cone}
              stroke={colors.coneCore}
              strokeWidth={1}
              strokeDasharray={frame?.ellipseSource === 'snapshot' ? undefined : '2,2'}
            />
          ) : null}
          {t.aim ? (
            <Line
              x1={t.start.x}
              y1={t.start.y}
              x2={t.aim.x}
              y2={t.aim.y}
              stroke="#FFFFFF"
              strokeWidth={1}
              strokeDasharray="3,2"
            />
          ) : null}
          {t.end ? (
            <Line
              x1={t.start.x}
              y1={t.start.y}
              x2={t.end.x}
              y2={t.end.y}
              stroke={colors.warning}
              strokeWidth={2}
            />
          ) : null}
          {t.aim ? (
            <Circle cx={t.aim.x} cy={t.aim.y} r={3} stroke="#FFFFFF" strokeWidth={1.5} />
          ) : null}
          {t.pin ? <Circle cx={t.pin.x} cy={t.pin.y} r={2} fill={colors.danger} /> : null}
          <Circle cx={t.start.x} cy={t.start.y} r={2.5} fill="#FFFFFF" />
          {t.end ? <Circle cx={t.end.x} cy={t.end.y} r={3} fill={colors.warning} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
