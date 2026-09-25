/**
 * Minimal Stableford / net scoring for the Phase 1 scorecard
 * (docs/SPEC.md §10.2, §10.3). Deliberately simple and self-contained.
 */
// TODO(wave-2): use engine scoring (packages/engine/src/scoring) and delete this module.

/** Golf Ireland individual Stableford allowance. */
export const STABLEFORD_ALLOWANCE = 0.95;

/** Course handicap = round(HI × slope/113 + (CR − par)). */
export function courseHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number,
): number {
  return Math.round((handicapIndex * slopeRating) / 113 + (courseRating - par));
}

export function playingHandicap(courseHcp: number, allowance = STABLEFORD_ALLOWANCE): number {
  return Math.round(courseHcp * allowance);
}

/**
 * Strokes received on a hole of stroke index `si` (1 = hardest). Plus
 * handicaps (negative) give strokes back starting from SI 18.
 */
export function strokesReceived(playingHcp: number, strokeIndex: number, holes = 18): number {
  if (playingHcp >= 0) {
    const base = Math.floor(playingHcp / holes);
    return base + (strokeIndex <= playingHcp % holes ? 1 : 0);
  }
  const plus = -playingHcp;
  const base = Math.floor(plus / holes);
  const given = base + (strokeIndex > holes - (plus % holes) ? 1 : 0);
  return given === 0 ? 0 : -given;
}

/** Stableford points = max(0, 2 + (par + received) − strokes). */
export function stablefordPoints(par: number, strokes: number, received: number): number {
  return Math.max(0, 2 + par + received - strokes);
}

/** Net double bogey cap for adjusted gross (WHS). */
export function netDoubleBogey(par: number, received: number): number {
  return par + 2 + received;
}

/** Score differential = (113 / slope) × (adjusted gross − CR), PCC 0, one decimal. */
export function scoreDifferential(
  adjustedGross: number,
  courseRating: number,
  slopeRating: number,
): number {
  return Math.round((113 / slopeRating) * (adjustedGross - courseRating) * 10) / 10;
}
