/**
 * Per-club dispersion page helpers (docs/SPEC.md §8.4, §8.5, §8.7): scatter
 * points in the club frame, the pattern's 1σ / 80 % / 95 % contours and
 * readable condition-bucket labels.
 */
import { patternShotFromRow, type PatternShotRow } from '@caddymate/api';
import {
  ellipsePolygon,
  type ClubPattern,
  type DispersionLevel,
  type FrameResult,
} from '@caddymate/engine';

export interface ScatterPoint {
  id: string;
  alongM: number;
  lateralM: number;
  source: 'sim' | 'course' | 'manual';
  /** False for mishits (they feed the miss pattern, not the main one). */
  good: boolean;
  playedAt: string;
}

/**
 * Neutral results of a club's shots: sim total/offline, course neutral_*.
 * Putts, penalty records and rows without a result are dropped.
 */
export function scatterPoints(rows: readonly PatternShotRow[]): ScatterPoint[] {
  return rows.flatMap((r) => {
    const p = patternShotFromRow(r, 'neutral');
    if (!p || p.isPutt || (p.penalty !== undefined && p.penalty !== 'none')) return [];
    return [
      {
        id: r.shot_id,
        alongM: p.alongM,
        lateralM: p.lateralM,
        source: r.source,
        good: r.strike === 'good',
        playedAt: r.played_at,
      },
    ];
  });
}

export const CONTOUR_LEVELS: readonly DispersionLevel[] = [1, 0.8, 0.95];

export const levelLabel = (l: DispersionLevel): string =>
  l === 1 ? '1σ' : `${String(Math.round(l * 100))} %`;

/** Club-frame contours of the pattern, innermost first. */
export function patternContours(
  pattern: ClubPattern,
  steps = 64,
): { level: DispersionLevel; ring: FrameResult[] }[] {
  return CONTOUR_LEVELS.map((level) => ({ level, ring: ellipsePolygon(pattern, level, steps) }));
}

const HEAD_BINS: Readonly<Record<string, string>> = {
  '..-4': 'tail > 4',
  '-4..-1': 'tail 1–4',
  '-1..1': 'calm',
  '+1..4': 'head 1–4',
  '+4..': 'head > 4',
};
const CROSS_BINS: Readonly<Record<string, string>> = {
  '..-4': 'R→L > 4',
  '-4..-1': 'R→L 1–4',
  '-1..1': 'calm',
  '+1..4': 'L→R 1–4',
  '+4..': 'L→R > 4',
};

export interface BucketLabel {
  lie: string;
  head: string;
  cross: string;
}

/** `fairway|h:+1..4|c:-4..-1` → { lie: 'fairway', head: 'head 1–4', cross: 'R→L 1–4' } (m/s). */
export function bucketLabel(key: string): BucketLabel {
  const [lie = key, h = '', c = ''] = key.split('|');
  const head = h.replace(/^h:/, '');
  const cross = c.replace(/^c:/, '');
  return {
    lie: lie.replace(/_/g, ' '),
    head: HEAD_BINS[head] ?? (head || '—'),
    cross: CROSS_BINS[cross] ?? (cross || '—'),
  };
}

/** Axis extent (metres) that fits the points and the widest contour, with a margin. */
export function scatterExtent(
  points: readonly Pick<ScatterPoint, 'alongM' | 'lateralM'>[],
  rings: readonly FrameResult[][],
): { along: [number, number]; lateral: [number, number] } {
  const all = [...points, ...rings.flat()];
  if (!all.length) return { along: [0, 100], lateral: [-20, 20] };
  let aMin = Infinity;
  let aMax = -Infinity;
  let lMax = 0;
  for (const p of all) {
    aMin = Math.min(aMin, p.alongM);
    aMax = Math.max(aMax, p.alongM);
    lMax = Math.max(lMax, Math.abs(p.lateralM));
  }
  const pad = Math.max(5, (aMax - aMin) * 0.08);
  const lat = Math.max(10, Math.ceil((lMax * 1.1) / 5) * 5);
  return { along: [Math.max(0, aMin - pad), aMax + pad], lateral: [-lat, lat] };
}
