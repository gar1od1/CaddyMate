import { newRound, type CourseBundle, type HoleScore, type Hole } from '@caddymate/api';
import { describe, expect, it } from 'vitest';
import { buildScorecard, finishTotals, holeResult, strokesReceivedFor } from './scorecard';

// 18 holes: par 4 everywhere except 5/5/3/3; SI = hole number.
const PARS = [4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 4, 3, 4, 4, 5, 4, 3, 4];
const holes: Hole[] = PARS.map((par, i) => ({
  id: `h${String(i + 1)}`,
  number: i + 1,
  par,
  lineOfPlay: null,
  green: null,
  greenCentre: null,
  features: [],
}));
const bundle = (withSi = true): CourseBundle => ({
  course: {
    id: 'c',
    name: 'C',
    slug: 'c',
    country: 'IE',
    centroid: null,
    currentVersion: 1,
    status: 'published',
  },
  version: 1,
  holes,
  teeSets: [
    {
      id: 't',
      name: 'White',
      colourHex: null,
      courseRating: 71.2,
      slopeRating: 128,
      bogeyRating: null,
      par: 72,
      markers: holes.map((h) => ({
        id: `m${h.id}`,
        holeId: h.id,
        point: { lat: 0, lng: 0 },
        strokeIndex: withSi ? h.number : null,
        yardageM: null,
      })),
    },
  ],
});
const round = {
  ...newRound({ id: 'r', userId: 'u', courseId: 'c', courseVersion: 1, teeSetId: 't' }),
  handicapIndexUsed: 13,
  courseHandicap: 14,
  playingHandicap: 13,
};
const score = (hole: number, strokes: number, override: number | null = null): HoleScore => ({
  roundId: 'r',
  holeNumber: hole,
  strokesLogged: strokes,
  strokesOverride: override,
  overrideReason: null,
  putts: 2,
  penalties: 0,
  points: null,
  netStrokes: null,
});

describe('engine scoring wiring', () => {
  it('gives strokes by stroke index and scores Stableford on the playing handicap', () => {
    expect(strokesReceivedFor(13, 13)).toBe(1);
    expect(strokesReceivedFor(13, 14)).toBe(0);
    expect(strokesReceivedFor(20, 2)).toBe(2);
    expect(strokesReceivedFor(-2, 18)).toBe(-1);
    expect(strokesReceivedFor(null, 1)).toBe(0);
    expect(strokesReceivedFor(13, null)).toBe(0);
    // Par 4, 5 strokes, one received → net par → 2 points.
    expect(holeResult(4, 5, 13, 1)).toEqual({ points: 2, netStrokes: 4 });
    expect(holeResult(4, 9, 13, 14)).toEqual({ points: 0, netStrokes: 9 });
    expect(holeResult(4, 0, 13, 1)).toEqual({ points: null, netStrokes: null });
  });

  it('builds a partial card: points and net per hole, no adjusted gross yet', () => {
    const card = buildScorecard(round, bundle(), [score(1, 5), score(2, 3, 4)]);
    expect(card.rows[0]).toMatchObject({ strokes: 5, received: 1, net: 4, points: 2 });
    expect(card.rows[1]).toMatchObject({ strokes: 4, overridden: true, points: 3 });
    expect(card.rows[2]).toMatchObject({ strokes: null, points: null, net: null });
    expect(card.total).toMatchObject({ holes: 2, strokes: 9, points: 5, toPar: 1 });
    expect(card.adjustedGross).toBeNull();
    expect(card.differential).toBeNull();
  });

  it('caps at net double bogey on the course handicap and computes the differential', () => {
    // Bogey everywhere except a 10 on hole 1 (SI 1: NDB = 4 + 2 + 1 = 7).
    const scores = holes.map((h) => score(h.number, h.number === 1 ? 10 : h.par + 1));
    const card = buildScorecard(round, bundle(), scores);
    expect(card.total.strokes).toBe(72 + 17 + 6);
    expect(card.adjustedGross).toBe(72 + 17 + 3);
    // (113 / 128) × (92 − 71.2) = 18.36… → 18.4
    expect(card.differential).toBe(18.4);
    // 13 playing strokes on SI 1–13: holes 2–13 net par (2 pts each), hole 1 net 9 (0),
    // holes 14–18 net bogey (1 pt each).
    expect(card.total.points).toBe(12 * 2 + 5);
    expect(finishTotals(card)).toEqual({
      gross: 95,
      adjustedGross: 92,
      stableford: card.total.points,
      differential: 18.4,
    });
  });

  it('gives no strokes when the tee set has no stroke indexes', () => {
    const card = buildScorecard(round, bundle(false), [score(1, 5)]);
    expect(card.rows[0]).toMatchObject({ received: 0, net: 5, points: 1 });
  });
});
