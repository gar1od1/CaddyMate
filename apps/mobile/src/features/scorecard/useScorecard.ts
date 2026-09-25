/**
 * Scorecard maths for the Phase 1 screens: per-hole gross / net / points
 * and front / back / total. Uses the placeholder scoring in @caddymate/api.
 */
// TODO(wave-2): use engine scoring (packages/engine/src/scoring) for net, Stableford,
// adjusted gross (net double bogey) and the differential.
import {
  holeStrokes,
  netDoubleBogey,
  scoreDifferential,
  stablefordPoints,
  strokesReceived,
  type CourseBundle,
  type HoleScore,
  type Round,
} from '@caddymate/api';
import { useHoleScores } from '@/data/hooks';

export interface CardRow {
  number: number;
  par: number;
  strokeIndex: number | null;
  received: number;
  strokes: number | null;
  overridden: boolean;
  putts: number | null;
  penalties: number | null;
  points: number | null;
  net: number | null;
}

export interface CardTotals {
  par: number;
  strokes: number;
  putts: number;
  points: number;
  toPar: number;
  net: number;
  holes: number;
}

export interface Scorecard {
  rows: CardRow[];
  out: CardTotals;
  in: CardTotals;
  total: CardTotals;
  playingHandicap: number | null;
  adjustedGross: number | null;
  differential: number | null;
}

function totals(rows: readonly CardRow[]): CardTotals {
  const played = rows.filter((r) => r.strokes !== null);
  const sum = (f: (r: CardRow) => number) => played.reduce((s, r) => s + f(r), 0);
  return {
    par: rows.reduce((s, r) => s + r.par, 0),
    strokes: sum((r) => r.strokes ?? 0),
    putts: sum((r) => r.putts ?? 0),
    points: sum((r) => r.points ?? 0),
    toPar: sum((r) => (r.strokes ?? 0) - r.par),
    net: sum((r) => r.net ?? 0),
    holes: played.length,
  };
}

export function buildScorecard(
  round: Round,
  bundle: CourseBundle,
  scores: readonly HoleScore[],
): Scorecard {
  const tee = bundle.teeSets.find((t) => t.id === round.teeSetId);
  const ph = round.playingHandicap;
  const rows: CardRow[] = bundle.holes.map((h) => {
    const si = tee?.markers.find((m) => m.holeId === h.id)?.strokeIndex ?? null;
    const received = ph !== null && si !== null ? strokesReceived(ph, si) : 0;
    const s = scores.find((x) => x.holeNumber === h.number);
    const strokes = s && holeStrokes(s) > 0 ? holeStrokes(s) : null;
    return {
      number: h.number,
      par: h.par,
      strokeIndex: si,
      received,
      strokes,
      overridden: s?.strokesOverride != null,
      putts: s ? s.putts : null,
      penalties: s ? s.penalties : null,
      points: strokes === null ? null : stablefordPoints(h.par, strokes, received),
      net: strokes === null ? null : strokes - received,
    };
  });
  const front = rows.filter((r) => r.number <= 9);
  const back = rows.filter((r) => r.number > 9);
  const total = totals(rows);
  const complete = rows.length > 0 && rows.every((r) => r.strokes !== null);
  const adjustedGross = complete
    ? rows.reduce((s, r) => s + Math.min(r.strokes ?? 0, netDoubleBogey(r.par, r.received)), 0)
    : null;
  const differential =
    adjustedGross !== null && tee?.courseRating && tee.slopeRating
      ? scoreDifferential(adjustedGross, tee.courseRating, tee.slopeRating)
      : null;
  return {
    rows,
    out: totals(front),
    in: totals(back),
    total,
    playingHandicap: ph,
    adjustedGross,
    differential,
  };
}

/** Lightweight totals for list rows (uses the points stored on hole scores). */
export function useHoleScoresSummary(roundId: string) {
  const scores = useHoleScores(roundId).data ?? [];
  const played = scores.filter((s) => holeStrokes(s) > 0);
  return {
    holesPlayed: played.length,
    gross: played.reduce((s, h) => s + holeStrokes(h), 0),
    points: played.reduce((s, h) => s + (h.points ?? 0), 0),
  };
}
