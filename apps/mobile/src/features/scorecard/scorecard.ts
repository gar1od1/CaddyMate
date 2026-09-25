/**
 * Scorecard maths (docs/SPEC.md §5.7, §10.2, §10.3) on the engine's scoring:
 * strokes received from the stroke index, net and Stableford points against
 * the playing handicap (95 % allowance), adjusted gross with net double
 * bogey and the score differential against the course handicap (WHS: the
 * handicap-purposes cap uses the full course handicap). Pure.
 */
import { holeStrokes, type CourseBundle, type HoleScore, type Round } from '@caddymate/api';
import {
  roundScorecard,
  stablefordPoints,
  strokesReceivedOnHole,
  type ScorecardHoleInput,
} from '@caddymate/engine';

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
  /** Net-double-bogey adjusted gross; null until every hole has a score. */
  adjustedGross: number | null;
  /** Score differential (18 holes, rated tee); null otherwise. */
  differential: number | null;
}

const validSi = (si: number | null): si is number =>
  si !== null && Number.isInteger(si) && si >= 1 && si <= 18;

/** Strokes received on a hole; 0 without a handicap or a stroke index. */
export function strokesReceivedFor(handicap: number | null, strokeIndex: number | null): number {
  if (handicap === null || !Number.isInteger(handicap) || !validSi(strokeIndex)) return 0;
  return strokesReceivedOnHole(handicap, strokeIndex);
}

/** Net strokes and Stableford points for one hole (null when not played). */
export function holeResult(
  par: number,
  strokes: number,
  playingHcp: number | null,
  strokeIndex: number | null,
): { points: number | null; netStrokes: number | null } {
  if (strokes <= 0) return { points: null, netStrokes: null };
  const net = strokes - strokesReceivedFor(playingHcp, strokeIndex);
  return { points: stablefordPoints(net, par), netStrokes: net };
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
  const ch = round.courseHandicap ?? ph;
  const inputs = bundle.holes.map((h) => {
    const si = tee?.markers.find((m) => m.holeId === h.id)?.strokeIndex ?? null;
    const s = scores.find((x) => x.holeNumber === h.number);
    const strokes = s && holeStrokes(s) > 0 ? holeStrokes(s) : null;
    return { hole: h, si, score: s, strokes };
  });

  // The engine card needs a stroke index on every hole; without one, no strokes are given.
  const cardInput: ScorecardHoleInput[] = inputs.map((x) => ({
    par: x.hole.par,
    strokeIndex: validSi(x.si) ? x.si : 18,
    gross: x.strokes,
  }));
  const allSi = inputs.every((x) => validSi(x.si));
  const cr = tee?.courseRating ?? null;
  const slope = tee?.slopeRating ?? null;
  const play = roundScorecard(cardInput, allSi && ph !== null ? ph : 0, cr ?? 0, slope ?? 113);
  const whs = roundScorecard(cardInput, allSi && ch !== null ? ch : 0, cr ?? 0, slope ?? 113);

  const rows: CardRow[] = inputs.map((x, i) => {
    const h = play.holes[i]!;
    return {
      number: x.hole.number,
      par: x.hole.par,
      strokeIndex: x.si,
      received: h.strokesReceived,
      strokes: x.strokes,
      overridden: x.score?.strokesOverride != null,
      putts: x.score ? x.score.putts : null,
      penalties: x.score ? x.score.penalties : null,
      points: x.strokes === null ? null : h.points,
      net: h.net,
    };
  });
  const complete = rows.length > 0 && rows.every((r) => r.strokes !== null);
  return {
    rows,
    out: totals(rows.filter((r) => r.number <= 9)),
    in: totals(rows.filter((r) => r.number > 9)),
    total: totals(rows),
    playingHandicap: ph,
    adjustedGross: complete ? whs.adjustedGross : null,
    differential: complete && cr !== null && slope ? whs.differential : null,
  };
}

/** The `rounds` totals written when the round is finished (§5.7). */
export function finishTotals(card: Scorecard): {
  gross: number | null;
  adjustedGross: number | null;
  stableford: number;
  differential: number | null;
} {
  return {
    gross: card.total.holes ? card.total.strokes : null,
    adjustedGross: card.adjustedGross,
    stableford: card.total.points,
    differential: card.differential,
  };
}
