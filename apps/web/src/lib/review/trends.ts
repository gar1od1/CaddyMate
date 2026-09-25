/**
 * Cross-round aggregation for /review/trends (docs/SPEC.md §10, §14):
 * rolling strokes gained, per-hole scoring averages, the tee-strategy
 * comparison on par 4/5s and the WHS ledger.
 */
import {
  handicapIndex,
  rollingSg,
  sgSummary,
  whsScoreTable,
  type HandicapIndexResult,
  type RecommendationSnapshot,
  type RollingSgPoint,
  type SgCategory,
  type SgRoundSummary,
} from '@caddymate/engine';

// ---------------------------------------------------------------------------
// Strokes gained
// ---------------------------------------------------------------------------

export interface SgShotLite {
  sg: number | null;
  sgCategory: SgCategory | null;
  clubId: string | null;
}

export interface RoundSgEntry {
  roundId: string;
  date: string;
  summary: SgRoundSummary;
}

/**
 * Per-round SG summaries in chronological order. Rounds without any graded
 * shot are left out (they would read as 0.0 and drag the trend).
 */
export function roundSgSeries(
  rounds: readonly { roundId: string; date: string; shots: readonly SgShotLite[] }[],
): RoundSgEntry[] {
  return [...rounds]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .flatMap((r) => {
      const graded = r.shots.filter((s) => s.sg !== null && s.sgCategory !== null);
      if (!graded.length) return [];
      return [
        {
          roundId: r.roundId,
          date: r.date,
          summary: sgSummary(
            graded.map((s) => ({ sg: s.sg!, category: s.sgCategory!, clubId: s.clubId })),
          ),
        },
      ];
    });
}

export interface RollingSgSeries {
  window: number;
  points: (RollingSgPoint & { roundId: string; date: string })[];
}

/** `rollingSg` over the series for each window (e.g. 5, 10, 20). */
export function rollingSgSeries(
  series: readonly RoundSgEntry[],
  windows: readonly number[] = [5, 10, 20],
): RollingSgSeries[] {
  return windows.map((window) => ({
    window,
    points: rollingSg(
      series.map((s) => s.summary),
      window,
    ).map((p, i) => ({ ...p, roundId: series[i]!.roundId, date: series[i]!.date })),
  }));
}

// ---------------------------------------------------------------------------
// Per-hole scoring average
// ---------------------------------------------------------------------------

export interface HoleScoreLite {
  holeNumber: number;
  par: number;
  strokes: number;
}

export interface HoleAverage {
  holeNumber: number;
  par: number;
  n: number;
  average: number;
  /** average − par. */
  toPar: number;
  /** Share of rounds at par or better. */
  parOrBetter: number;
}

/** Scoring average per hole number (holes with 0 strokes — not played — are ignored). */
export function holeScoringAverages(scores: readonly HoleScoreLite[]): HoleAverage[] {
  const by = new Map<number, HoleScoreLite[]>();
  for (const s of scores) {
    if (s.strokes <= 0) continue;
    const list = by.get(s.holeNumber) ?? [];
    list.push(s);
    by.set(s.holeNumber, list);
  }
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([holeNumber, list]) => {
      const par = list[list.length - 1]!.par;
      const average = list.reduce((t, s) => t + s.strokes, 0) / list.length;
      return {
        holeNumber,
        par,
        n: list.length,
        average,
        toPar: average - par,
        parOrBetter: list.filter((s) => s.strokes <= s.par).length / list.length,
      };
    });
}

// ---------------------------------------------------------------------------
// Tee strategy
// ---------------------------------------------------------------------------

export interface TeeShotLite {
  holeNumber: number;
  par: number;
  clubId: string | null;
  sg: number | null;
  resultSurface: string | null;
  penalty: string;
  observedDistanceM: number | null;
  recommendation: RecommendationSnapshot | null;
}

export interface TeeClubStats {
  clubId: string;
  n: number;
  /** Mean SG of the tee shots (graded shots only), null when none graded. */
  meanSg: number | null;
  fairwayRate: number;
  penaltyRate: number;
  meanDistanceM: number | null;
  /** Times the engine ranked this club first on the tee (over all par 4/5 tee shots). */
  engineFirst: number;
  /** Mean `expectedStrokes` of this club's chosen options, from the snapshots. */
  meanExpected: number | null;
}

export interface TeeStrategyGroup {
  par: 4 | 5;
  shots: number;
  clubs: TeeClubStats[];
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null;

/**
 * Per par (4 and 5): what happened with each club used off the tee, next to
 * how often the engine preferred it. Shots must be the first shot of each
 * hole; par 3s are ignored.
 */
export function teeStrategy(shots: readonly TeeShotLite[]): TeeStrategyGroup[] {
  return ([4, 5] as const).flatMap((par) => {
    const group = shots.filter((s) => (par === 5 ? s.par >= 5 : s.par === 4));
    return group.length ? [{ par, shots: group.length, clubs: teeClubStats(group) }] : [];
  });
}

export interface TeeHoleGroup {
  holeNumber: number;
  par: number;
  shots: number;
  clubs: TeeClubStats[];
}

/** The same comparison per par-4/5 hole (for one course's tee shots). */
export function teeStrategyByHole(shots: readonly TeeShotLite[]): TeeHoleGroup[] {
  const holes = [...new Set(shots.filter((s) => s.par >= 4).map((s) => s.holeNumber))].sort(
    (a, b) => a - b,
  );
  return holes.map((holeNumber) => {
    const group = shots.filter((s) => s.holeNumber === holeNumber);
    return {
      holeNumber,
      par: group[group.length - 1]!.par,
      shots: group.length,
      clubs: teeClubStats(group),
    };
  });
}

/** Clubs used in `group` plus any club the engine ranked first there. */
function teeClubStats(group: readonly TeeShotLite[]): TeeClubStats[] {
  const ids = new Set<string>();
  for (const s of group) {
    if (s.clubId) ids.add(s.clubId);
    const first = s.recommendation?.options[0]?.clubId;
    if (first) ids.add(first);
  }
  const clubs = [...ids].map((clubId): TeeClubStats => {
    const used = group.filter((s) => s.clubId === clubId);
    return {
      clubId,
      n: used.length,
      meanSg: mean(used.flatMap((s) => (s.sg !== null ? [s.sg] : []))),
      fairwayRate: used.length
        ? used.filter((s) => s.resultSurface === 'fairway').length / used.length
        : 0,
      penaltyRate: used.length ? used.filter((s) => s.penalty !== 'none').length / used.length : 0,
      meanDistanceM: mean(
        used.flatMap((s) => (s.observedDistanceM !== null ? [s.observedDistanceM] : [])),
      ),
      engineFirst: group.filter((s) => s.recommendation?.options[0]?.clubId === clubId).length,
      meanExpected: mean(
        used.flatMap((s) =>
          s.recommendation?.chosen?.clubId === clubId
            ? [s.recommendation.chosen.expectedStrokes]
            : [],
        ),
      ),
    };
  });
  return clubs.sort((a, b) => b.n - a.n || b.engineFirst - a.engineFirst);
}

// ---------------------------------------------------------------------------
// WHS ledger
// ---------------------------------------------------------------------------

export interface LedgerInput {
  roundId: string;
  date: string;
  differential: number | null;
  courseName: string | null;
  adjustedGross: number | null;
}

export interface LedgerEntry extends LedgerInput {
  differential: number;
  /** Among the lowest differentials that make up the index. */
  counts: boolean;
}

export interface WhsLedger {
  /** Most recent first, at most 20. */
  entries: LedgerEntry[];
  index: HandicapIndexResult | null;
}

/**
 * The last 20 differentials (most recent first), flagging the ones that
 * count per the WHS table (ties: the more recent one counts), and the
 * engine's `handicapIndex`. `lowIndex365` enables the soft/hard caps.
 */
export function whsLedger(rounds: readonly LedgerInput[], lowIndex365?: number): WhsLedger {
  const recent = rounds
    .map((r, i) => ({ r, i, t: Date.parse(r.date) }))
    .filter((x) => x.r.differential !== null)
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .slice(0, 20)
    .map((x) => ({ ...x.r, differential: x.r.differential! }));
  const rule = whsScoreTable(recent.length);
  const counting = new Set(
    rule
      ? recent
          .map((e, i) => ({ v: e.differential, i }))
          .sort((a, b) => a.v - b.v || a.i - b.i)
          .slice(0, rule.used)
          .map((x) => x.i)
      : [],
  );
  const entries = recent.map((e, i) => ({ ...e, counts: counting.has(i) }));
  const index = handicapIndex(
    // Oldest first so same-date ties resolve like the ledger (later = more recent).
    [...recent].reverse().map((e) => ({ value: e.differential, date: e.date })),
    lowIndex365,
  );
  return { entries, index };
}
