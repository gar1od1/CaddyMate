import type { ReactNode } from 'react';
import { FAINT, GRID, INK, SURFACE } from './palette';
import { linear, niceTicks, type Scale } from './scale';

export interface ScatterDatum {
  x: number;
  y: number;
  colour: string;
  /** Hollow marks for secondary points (e.g. mishits). */
  hollow?: boolean;
  title?: string;
}

export interface Overlay {
  points: readonly { x: number; y: number }[];
  colour: string;
  label?: string;
  dashed?: boolean;
  fillOpacity?: number;
}

export interface ScatterPlotProps {
  points: readonly ScatterDatum[];
  overlays?: readonly Overlay[];
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel: string;
  yLabel: string;
  /** Tick text (e.g. metres → yards). */
  tickFormat?: (v: number) => string;
  /** Tick values are chosen in the tick unit: pass the inverse of tickFormat's conversion. */
  toTickUnit?: (v: number) => number;
  fromTickUnit?: (v: number) => number;
  title: string;
  width?: number;
  height?: number;
  legend?: ReactNode;
}

/** Closed SVG path of an overlay ring under the scales. */
export function EllipseOverlay({ overlay, x, y }: { overlay: Overlay; x: Scale; y: Scale }) {
  const d =
    overlay.points
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`)
      .join('') + 'Z';
  return (
    <g>
      {overlay.label ? <title>{overlay.label}</title> : null}
      <path
        d={d}
        fill={overlay.colour}
        fillOpacity={overlay.fillOpacity ?? 0.06}
        stroke={overlay.colour}
        strokeWidth={1.5}
        strokeDasharray={overlay.dashed ? '5 4' : undefined}
      />
    </g>
  );
}

/**
 * Scatter with optional contour overlays. Used in the club frame: x =
 * lateral (+ right), y = distance, so the plot reads like looking down the
 * target line. 8 px markers with a surface ring so overlaps stay legible.
 */
export function ScatterPlot({
  points,
  overlays = [],
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  tickFormat = (v) => String(Math.round(v)),
  toTickUnit = (v) => v,
  fromTickUnit = (v) => v,
  title,
  width = 520,
  height = 420,
  legend,
}: ScatterPlotProps) {
  const m = { top: 12, right: 12, bottom: 36, left: 48 };
  const x = linear(xDomain, [m.left, width - m.right]);
  const y = linear(yDomain, [height - m.bottom, m.top]);
  const ticks = (d: [number, number], n: number) =>
    niceTicks(toTickUnit(d[0]), toTickUnit(d[1]), n).map(fromTickUnit);
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        {ticks(xDomain, 6).map((t) => (
          <g key={`x${String(t)}`}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={m.top}
              y2={height - m.bottom}
              stroke={GRID}
              strokeWidth={Math.abs(t) < 1e-6 ? 1.5 : 0.5}
            />
            <text
              x={x(t)}
              y={height - m.bottom + 14}
              textAnchor="middle"
              fontSize={11}
              fill={FAINT}
            >
              {tickFormat(t)}
            </text>
          </g>
        ))}
        {ticks(yDomain, 6).map((t) => (
          <g key={`y${String(t)}`}>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth={0.5}
            />
            <text
              x={m.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill={FAINT}
            >
              {tickFormat(t)}
            </text>
          </g>
        ))}
        <text
          x={(m.left + width - m.right) / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={11}
          fill={INK}
        >
          {xLabel}
        </text>
        <text
          transform={`translate(12 ${String((m.top + height - m.bottom) / 2)}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          fill={INK}
        >
          {yLabel}
        </text>
        {overlays.map((o, i) => (
          <EllipseOverlay key={i} overlay={o} x={x} y={y} />
        ))}
        {points.map((p, i) => (
          <g key={i}>
            {p.title ? <title>{p.title}</title> : null}
            <circle
              cx={x(p.x)}
              cy={y(p.y)}
              r={4}
              fill={p.hollow ? SURFACE : p.colour}
              stroke={p.hollow ? p.colour : SURFACE}
              strokeWidth={p.hollow ? 1.5 : 1}
            />
          </g>
        ))}
      </svg>
      {legend ? <figcaption className="text-xs">{legend}</figcaption> : null}
    </figure>
  );
}
