import { FAINT, GRID, INK, MUTED } from './palette';
import { extent, linear, niceTicks, signed } from './scale';

export interface LineSeries {
  name: string;
  colour: string;
  /** y per x index; null leaves a gap. */
  values: readonly (number | null)[];
  dashed?: boolean;
}

export interface LineChartProps {
  series: readonly LineSeries[];
  /** One label per x index (e.g. round dates). */
  xLabels: readonly string[];
  title: string;
  format?: (v: number) => string;
  width?: number;
  height?: number;
}

/**
 * Lines over an index axis with a zero line, recessive grid, a legend and a
 * direct label at each line's last point. Native tooltips per point.
 */
export function LineChart({
  series,
  xLabels,
  title,
  format = (v) => signed(v),
  width = 560,
  height = 220,
}: LineChartProps) {
  const m = { top: 12, right: 92, bottom: 26, left: 44 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const [lo, hi] = extent(all);
  const ticks = niceTicks(lo, hi, 4);
  const y = linear(
    [Math.min(lo, ticks[0] ?? lo), Math.max(hi, ticks.at(-1) ?? hi)],
    [height - m.bottom, m.top],
  );
  const n = xLabels.length;
  const x = linear([0, Math.max(1, n - 1)], [m.left, width - m.right]);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth={t === 0 ? 1.5 : 0.5}
            />
            <text
              x={m.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill={FAINT}
            >
              {format(t)}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={FAINT}>
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
          let d = '';
          let pen = false;
          for (const p of pts) {
            if (!p) {
              pen = false;
              continue;
            }
            d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
            pen = true;
          }
          const lastIdx = s.values.findLastIndex((v) => v !== null);
          const last = lastIdx >= 0 ? pts[lastIdx] : null;
          return (
            <g key={s.name}>
              <path
                d={d}
                fill="none"
                stroke={s.colour}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) =>
                p ? (
                  <g key={i}>
                    <title>{`${s.name} · ${xLabels[i] ?? ''}: ${format(s.values[i]!)}`}</title>
                    <circle cx={p[0]} cy={p[1]} r={8} fill="transparent" />
                    <circle cx={p[0]} cy={p[1]} r={2.5} fill={s.colour} />
                  </g>
                ) : null,
              )}
              {last ? (
                <text
                  x={last[0] + 8}
                  y={last[1]}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill={MUTED}
                >
                  {s.name} {format(s.values[lastIdx]!)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {series.length > 1 ? (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: INK }}>
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line
                  x1="0"
                  x2="18"
                  y1="3"
                  y2="3"
                  stroke={s.colour}
                  strokeWidth="2"
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                />
              </svg>
              {s.name}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
