import { FAINT, GRID, INK, MUTED, NEGATIVE, POSITIVE } from './palette';
import { extent, linear, signed } from './scale';

export interface BarDatum {
  label: string;
  value: number;
  /** Mark colour; defaults to the diverging pole for the value's sign. */
  colour?: string;
  /** Hover text; defaults to "label: value". */
  title?: string;
  /** Small text after the label (e.g. "n 12"). */
  note?: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  /** Value text; default signed with 2 decimals. */
  format?: (v: number) => string;
  /** Accessible title of the chart. */
  title: string;
  width?: number;
  rowHeight?: number;
  labelWidth?: number;
}

/**
 * Horizontal bars from a zero baseline (signed values go left/right), with the
 * value printed at the bar end. Rounded 4 px data ends, 2 px gaps.
 */
export function BarChart({
  data,
  format = (v) => signed(v),
  title,
  width = 520,
  rowHeight = 26,
  labelWidth = 120,
}: BarChartProps) {
  const valueWidth = 56;
  const top = 4;
  const height = top + data.length * rowHeight + 4;
  const [lo, hi] = extent(data.map((d) => d.value));
  const x = linear([lo, hi], [labelWidth + valueWidth, width - valueWidth]);
  const zero = x(0);
  const bar = rowHeight - 8;
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="h-auto w-full"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <line x1={zero} x2={zero} y1={0} y2={height} stroke={GRID} strokeWidth={1} />
      {data.map((d, i) => {
        const y = top + i * rowHeight;
        const x0 = Math.min(zero, x(d.value));
        const w = Math.max(1, Math.abs(x(d.value) - zero));
        const colour = d.colour ?? (d.value >= 0 ? POSITIVE : NEGATIVE);
        const neg = d.value < 0;
        return (
          <g key={`${d.label}-${String(i)}`}>
            <title>{d.title ?? `${d.label}: ${format(d.value)}`}</title>
            {/* Full-row hit target so the tooltip is easy to reach. */}
            <rect x={0} y={y} width={width} height={rowHeight} fill="transparent" />
            <text x={0} y={y + rowHeight / 2} dominantBaseline="middle" fontSize={12} fill={INK}>
              {d.label}
              {d.note ? (
                <tspan fill={FAINT} fontSize={11}>
                  {`  ${d.note}`}
                </tspan>
              ) : null}
            </text>
            <rect x={x0} y={y + 4} width={w} height={bar} rx={4} fill={colour} />
            <text
              x={neg ? x0 - 6 : x0 + w + 6}
              y={y + rowHeight / 2}
              dominantBaseline="middle"
              textAnchor={neg ? 'end' : 'start'}
              fontSize={12}
              fill={MUTED}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {format(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
