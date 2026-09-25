/**
 * Pure summaries for one round's review page (docs/SPEC.md §9.5, §10.1, §14):
 * the decision 2×2 and loss totals, strokes gained per category and club,
 * the five most expensive decisions with explanations, and the scorecard.
 */
import {
  explainOption,
  roundGradingSummary,
  sgSummary,
  type GradedShot,
  type RoundGradingSummary,
  type SgRoundSummary,
  type SnapshotOption,
  type StrategyOption,
} from '@caddymate/engine';
import type { HoleScore } from '@caddymate/api';
import type { ReviewShot } from './shots';

export interface GradedReviewShot extends GradedShot {
  shot: ReviewShot;
}

/** Shots that carry a full grade (strategy + execution). */
export function gradedShots(shots: readonly ReviewShot[]): GradedReviewShot[] {
  return shots.flatMap((s) =>
    s.strategyLoss !== null &&
    s.executionLoss !== null &&
    s.decisionGrade !== null &&
    s.executionGrade !== null
      ? [
          {
            shot: s,
            shotId: s.id,
            clubId: s.clubId,
            category: s.sgCategory,
            strategyLoss: s.strategyLoss,
            executionLoss: s.executionLoss,
            decisionGrade: s.decisionGrade,
            executionGrade: s.executionGrade,
          },
        ]
      : [],
  );
}

export function decisionSummary(
  shots: readonly ReviewShot[],
): RoundGradingSummary<GradedReviewShot> {
  return roundGradingSummary(gradedShots(shots));
}

export function roundSg(shots: readonly ReviewShot[]): SgRoundSummary {
  return sgSummary(
    shots.flatMap((s) =>
      s.sg !== null && s.sgCategory !== null
        ? [{ sg: s.sg, category: s.sgCategory, clubId: s.clubId }]
        : [],
    ),
  );
}

// The explainer takes a full option; snapshots omit the (re-derivable) ellipse.
const asOption = (o: SnapshotOption): StrategyOption => ({ ...o, ellipse80: [] });

/**
 * One or two lines for a graded shot, from the snapshot the player saw:
 * "Chose 7i — aim at the pin. 55 % green, 31 % water, same as at the pin."
 * then "Best: 6i — aim 12 yds left of pin. …" when the engine preferred
 * something else, then the execution result.
 */
export function explainDecision(g: GradedReviewShot, clubName: string | null): string[] {
  const lines: string[] = [];
  const rec = g.shot.recommendation;
  const chosen = rec?.chosen ?? null;
  const best = rec?.options[0] ?? null;
  if (rec && chosen) {
    lines.push(`Chose ${explainOption(asOption(chosen), asOption(rec.baseline))}`);
    if (best && (best.clubId !== chosen.clubId || g.strategyLoss > 0.005)) {
      lines.push(
        `Best: ${explainOption(asOption(best), asOption(rec.baseline))} (${g.strategyLoss.toFixed(2)} strokes better than the choice)`,
      );
    }
  } else {
    lines.push(`${clubName ?? 'Shot'} — no recommendation snapshot.`);
  }
  const e = g.executionLoss;
  if (Math.abs(e) >= 0.005) {
    lines.push(
      e < 0
        ? `Execution: ${(-e).toFixed(2)} strokes worse than the pattern expected${g.executionGrade === 'poor' ? ' (bottom 20 %)' : ''}.`
        : `Execution: ${e.toFixed(2)} strokes better than the pattern expected.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface ScorecardInputHole {
  number: number;
  par: number;
  strokeIndex: number | null;
  yardageM: number | null;
}

export interface ScorecardRow {
  hole: number;
  par: number;
  strokeIndex: number | null;
  yardageM: number | null;
  strokes: number | null;
  putts: number | null;
  penalties: number | null;
  net: number | null;
  points: number | null;
  sg: number | null;
}

export interface ScorecardTotals {
  label: string;
  par: number;
  yardageM: number | null;
  strokes: number | null;
  putts: number;
  penalties: number;
  net: number | null;
  points: number;
  sg: number | null;
}

export interface ScorecardTable {
  rows: ScorecardRow[];
  /** Out / In / Total (Out and In only for 18-hole cards). */
  totals: ScorecardTotals[];
}

const sumOrNull = (xs: (number | null)[]): number | null =>
  xs.length === 0 || xs.some((x) => x === null) ? null : xs.reduce<number>((s, x) => s + x!, 0);

/** Strokes on a hole: the override when set (manual fix), else what was logged. */
export const holeStrokes = (s: Pick<HoleScore, 'strokesOverride' | 'strokesLogged'>): number =>
  s.strokesOverride ?? s.strokesLogged;

export function scorecardTable(
  holes: readonly ScorecardInputHole[],
  scores: readonly HoleScore[],
  shots: readonly Pick<ReviewShot, 'holeNumber' | 'sg'>[],
): ScorecardTable {
  const rows = [...holes]
    .sort((a, b) => a.number - b.number)
    .map((h): ScorecardRow => {
      const s = scores.find((x) => x.holeNumber === h.number);
      const holeShots = shots.filter((x) => x.holeNumber === h.number && x.sg !== null);
      const played = s !== undefined && holeStrokes(s) > 0;
      return {
        hole: h.number,
        par: h.par,
        strokeIndex: h.strokeIndex,
        yardageM: h.yardageM,
        strokes: played ? holeStrokes(s) : null,
        putts: played ? s.putts : null,
        penalties: played ? s.penalties : null,
        net: played ? s.netStrokes : null,
        points: played ? s.points : null,
        sg: holeShots.length ? holeShots.reduce((t, x) => t + x.sg!, 0) : null,
      };
    });
  const total = (label: string, rs: ScorecardRow[]): ScorecardTotals => ({
    label,
    par: rs.reduce((t, r) => t + r.par, 0),
    yardageM: sumOrNull(rs.map((r) => r.yardageM)),
    strokes: sumOrNull(rs.map((r) => r.strokes)),
    putts: rs.reduce((t, r) => t + (r.putts ?? 0), 0),
    penalties: rs.reduce((t, r) => t + (r.penalties ?? 0), 0),
    net: sumOrNull(rs.map((r) => r.net)),
    points: rs.reduce((t, r) => t + (r.points ?? 0), 0),
    sg: rs.some((r) => r.sg !== null) ? rs.reduce((t, r) => t + (r.sg ?? 0), 0) : null,
  });
  const totals =
    rows.length === 18
      ? [total('Out', rows.slice(0, 9)), total('In', rows.slice(9)), total('Total', rows)]
      : [total('Total', rows)];
  return { rows, totals };
}
