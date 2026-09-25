/**
 * Review-side shot model: the shared `Shot` plus the grade columns that are
 * written on device after the round (docs/SPEC.md §9.5, §10.1) and never
 * sent by the play-view upserts.
 */
import { shotFromRow, type Row, type Shot } from '@caddymate/api';
import type { Grade, SgCategory } from '@caddymate/engine';

export interface ReviewShot extends Shot {
  sg: number | null;
  sgCategory: SgCategory | null;
  strategyLoss: number | null;
  executionLoss: number | null;
  decisionGrade: Grade | null;
  executionGrade: Grade | null;
}

/** numeric columns may arrive as strings from PostgREST. */
export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function reviewShotFromRow(r: Row<'shots'>): ReviewShot {
  return {
    ...shotFromRow(r),
    sg: numOrNull(r.sg),
    sgCategory: r.sg_category,
    strategyLoss: numOrNull(r.strategy_loss),
    executionLoss: numOrNull(r.execution_loss),
    decisionGrade: r.decision_grade,
    executionGrade: r.execution_grade,
  };
}

/** Grading runs on device when the round is finished; any SG value means it ran. */
export const isRoundGraded = (shots: readonly Pick<ReviewShot, 'sg'>[]): boolean =>
  shots.some((s) => s.sg !== null);

/** Shots in play order: hole, then seq. */
export const byPlayOrder = <T extends Pick<Shot, 'holeNumber' | 'seq'>>(a: T, b: T): number =>
  a.holeNumber - b.holeNumber || a.seq - b.seq;
