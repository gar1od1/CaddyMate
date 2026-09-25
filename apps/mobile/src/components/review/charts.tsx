/**
 * Small review charts on react-native-svg: signed horizontal bars, lines and
 * a dispersion scatter. Thin marks, recessive grid, values in text colours;
 * series identity is carried by colour plus dash pattern and a legend (the
 * brand tokens sit close for protan readers, so colour never works alone).
 */
import type { SgCategory } from '@caddymate/engine';
import { colors, spacing, type } from '@caddymate/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { niceDomain, scale, type Domain } from '@/features/review/review';

/** Fixed category order and style: colour + dash so identity is never colour alone. */
export const CATEGORY_STYLE: Record<SgCategory, { color: string; dash?: string }> = {
  ott: { color: colors.info },
  app: { color: colors.warning, dash: '6,3' },
  arg: { color: colors.accent, dash: '2,3' },
  putt: { color: colors.danger, dash: '8,3,2,3' },
};

function useWidth(initial = 320): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.max(120, Math.round(e.nativeEvent.layout.width)))];
}

const fmt = (v: number, dp: number) => {
  const r = Number(v.toFixed(dp));
  return r === 0 ? (0).toFixed(dp) : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(dp)}`;
};

export interface BarRow {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/**
 * Signed horizontal bars around zero (strokes gained / lost). Positive bars
 * are accent, negative danger; the value is printed at the bar end.
 */
export function SignedBars({
  rows,
  dp = 2,
  onPress,
}: {
  rows: readonly BarRow[];
  dp?: number;
  onPress?: (key: string) => void;
}) {
  const [width, onLayout] = useWidth();
  const labelW = 96;
  const valueW = 52;
  const barArea = Math.max(40, width - labelW - valueW);
  const d = niceDomain(
    rows.map((r) => r.value),
    [0],
  );
  const x = scale(d, 0, barArea);
  const zero = x(0);
  const rowH = 26;
  return (
    <View onLayout={onLayout}>
      {rows.map((r) => {
        const x0 = Math.min(zero, x(r.value));
        const w = Math.max(2, Math.abs(x(r.value) - zero));
        return (
          <Pressable
            key={r.key}
            disabled={!onPress}
            onPress={() => onPress?.(r.key)}
            style={({ pressed }) => [styles.barRow, pressed && { opacity: 0.7 }]}
          >
            <View style={{ width: labelW }}>
              <Text style={styles.barLabel} numberOfLines={1}>
                {r.label}
              </Text>
              {r.sub ? <Text style={styles.barSub}>{r.sub}</Text> : null}
            </View>
            <Svg width={barArea} height={rowH}>
              <Line x1={zero} x2={zero} y1={0} y2={rowH} stroke={colors.border} strokeWidth={1} />
              <Rect
                x={x0}
                y={7}
                width={w}
                height={rowH - 14}
                rx={3}
                fill={r.value >= 0 ? colors.accent : colors.danger}
              />
            </Svg>
            <Text style={[styles.barValue, { width: valueW }]}>{fmt(r.value, dp)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dash?: string;
  values: readonly (number | null)[];
}

/** Lines over an index axis (rounds), with a zero line and the last value labelled. */
export function LineChart({
  series,
  height = 180,
  xLabels,
  dp = 2,
  signed = true,
}: {
  series: readonly LineSeries[];
  height?: number;
  /** Labels for the first and last x positions. */
  xLabels?: [string, string];
  dp?: number;
  signed?: boolean;
}) {
  const [width, onLayout] = useWidth();
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const d: Domain = niceDomain(values, signed ? [0] : []);
  const padL = 36;
  const padR = 48;
  const padT = 8;
  const padB = 18;
  const x = (i: number) => (n <= 1 ? padL : padL + (i / (n - 1)) * (width - padL - padR));
  const y = scale(d, height - padB, padT);
  const ticks = [d.min + (d.max - d.min) * 0.1, (d.min + d.max) / 2, d.max - (d.max - d.min) * 0.1];
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {ticks.map((t) => (
          <G key={t}>
            <Line
              x1={padL}
              x2={width - padR}
              y1={y(t)}
              y2={y(t)}
              stroke={colors.border}
              strokeWidth={0.5}
            />
            <SvgText
              x={padL - 4}
              y={y(t) + 4}
              fontSize={10}
              fill={colors.textFaint}
              textAnchor="end"
            >
              {signed ? fmt(t, 1) : t.toFixed(1)}
            </SvgText>
          </G>
        ))}
        {signed && d.min < 0 && d.max > 0 ? (
          <Line
            x1={padL}
            x2={width - padR}
            y1={y(0)}
            y2={y(0)}
            stroke={colors.textMuted}
            strokeWidth={1}
          />
        ) : null}
        {series.map((s) => {
          const pts = s.values
            .map((v, i) => (v === null ? null : `${String(x(i))},${String(y(v))}`))
            .filter((p): p is string => p !== null);
          const lastI = s.values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
          const last = lastI >= 0 ? s.values[lastI]! : null;
          return (
            <G key={s.key}>
              {pts.length > 1 ? (
                <Polyline
                  points={pts.join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dash}
                  strokeLinejoin="round"
                />
              ) : null}
              {last !== null ? (
                <>
                  <Circle
                    cx={x(lastI)}
                    cy={y(last)}
                    r={4}
                    fill={s.color}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                  <SvgText x={x(lastI) + 7} y={y(last) + 4} fontSize={10} fill={colors.text}>
                    {signed ? fmt(last, dp) : last.toFixed(dp)}
                  </SvgText>
                </>
              ) : null}
            </G>
          );
        })}
        {xLabels ? (
          <>
            <SvgText x={padL} y={height - 4} fontSize={10} fill={colors.textFaint}>
              {xLabels[0]}
            </SvgText>
            <SvgText
              x={width - padR}
              y={height - 4}
              fontSize={10}
              fill={colors.textFaint}
              textAnchor="end"
            >
              {xLabels[1]}
            </SvgText>
          </>
        ) : null}
      </Svg>
      {series.length > 1 ? <Legend items={series} /> : null}
    </View>
  );
}

export function Legend({
  items,
}: {
  items: readonly { key: string; label: string; color: string; dash?: string }[];
}) {
  return (
    <View style={styles.legend}>
      {items.map((s) => (
        <View key={s.key} style={styles.legendItem}>
          <Svg width={22} height={8}>
            <Line
              x1={0}
              x2={22}
              y1={4}
              y2={4}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
            />
          </Svg>
          <Text style={styles.legendText}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  kind: 'course' | 'sim';
}

export interface ScatterRing {
  key: string;
  points: readonly { x: number; y: number }[];
  color: string;
  width?: number;
  dash?: string;
  opacity?: number;
}

/**
 * Dispersion scatter in the club frame: x = lateral (+ right), y = along
 * (up = longer). Course shots are filled dots, sim shots hollow rings.
 */
export function Scatter({
  points,
  rings,
  x: dx,
  y: dy,
  axisLabel,
}: {
  points: readonly ScatterPoint[];
  rings: readonly ScatterRing[];
  x: Domain;
  y: Domain;
  axisLabel?: (v: number) => string;
}) {
  const [width, onLayout] = useWidth();
  const size = Math.min(width, 360);
  const pad = 28;
  const sx = scale(dx, pad, size - 8);
  const sy = scale(dy, size - pad, 8);
  const label = axisLabel ?? ((v: number) => v.toFixed(0));
  return (
    <View onLayout={onLayout} style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Rect
          x={pad}
          y={8}
          width={size - pad - 8}
          height={size - pad - 8}
          fill={colors.bgElevated}
          rx={6}
        />
        {dx.min < 0 && dx.max > 0 ? (
          <Line
            x1={sx(0)}
            x2={sx(0)}
            y1={8}
            y2={size - pad}
            stroke={colors.border}
            strokeWidth={1}
          />
        ) : null}
        {rings.map((r) => (
          <Polygon
            key={r.key}
            points={r.points.map((p) => `${String(sx(p.x))},${String(sy(p.y))}`).join(' ')}
            fill="none"
            stroke={r.color}
            strokeWidth={r.width ?? 1.5}
            strokeDasharray={r.dash}
            strokeOpacity={r.opacity ?? 1}
          />
        ))}
        {points.map((p, i) =>
          p.kind === 'course' ? (
            <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.5} fill={colors.warning} />
          ) : (
            <Circle
              key={i}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={3.5}
              fill="none"
              stroke={colors.info}
              strokeWidth={1.5}
            />
          ),
        )}
        <SvgText x={pad} y={size - 10} fontSize={10} fill={colors.textFaint}>
          {label(dx.min)}
        </SvgText>
        <SvgText x={size - 8} y={size - 10} fontSize={10} fill={colors.textFaint} textAnchor="end">
          {label(dx.max)}
        </SvgText>
        <SvgText x={pad - 4} y={16} fontSize={10} fill={colors.textFaint} textAnchor="end">
          {label(dy.max)}
        </SvgText>
        <SvgText x={pad - 4} y={size - pad} fontSize={10} fill={colors.textFaint} textAnchor="end">
          {label(dy.min)}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  barRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  barLabel: { ...type.caption, color: colors.text },
  barSub: { fontSize: 11, color: colors.textFaint },
  barValue: { ...type.caption, color: colors.text, textAlign: 'right', fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendText: { fontSize: 12, color: colors.textMuted },
});
