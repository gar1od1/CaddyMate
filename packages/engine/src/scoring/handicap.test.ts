import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  courseHandicap,
  handicapIndex,
  netDoubleBogeyAdjusted,
  playingHandicap,
  roundHalfUp,
  roundScorecard,
  scoreDifferential,
  stablefordPoints,
  strokesReceivedOnHole,
  whsScoreTable,
  type DatedDifferential,
  type ScorecardHoleInput,
} from './handicap.js';

describe('course and playing handicap', () => {
  it('matches the WHS worked example', () => {
    // 13.0 × 128/113 + (71.4 − 72) = 14.13 → 14; 95 % → 13.3 → 13.
    expect(courseHandicap(13.0, 128, 71.4, 72)).toBe(14);
    expect(playingHandicap(14)).toBe(13);
    expect(playingHandicap(14, 1)).toBe(14);
    // 10.4 × 132/113 + (72.1 − 71) = 13.25 → 13
    expect(courseHandicap(10.4, 132, 72.1, 71)).toBe(13);
    expect(courseHandicap(0, 113, 70, 72)).toBe(-2);
    // 0.95 × 10 = 9.5 rounds up; 0.95 × 30 = 28.5 → 29.
    expect(playingHandicap(10)).toBe(10);
    expect(playingHandicap(30)).toBe(29);
  });

  it('rounds halves up without −0', () => {
    expect(roundHalfUp(14.5)).toBe(15);
    expect(roundHalfUp(-2.5)).toBe(-2);
    expect(roundHalfUp(-0.4)).toBe(0);
    expect(Object.is(roundHalfUp(-0.04, 1), 0)).toBe(true);
    expect(roundHalfUp(12.05, 1)).toBe(12.1);
    expect(roundHalfUp(0.95 * 14)).toBe(13);
  });
});

describe('strokesReceivedOnHole', () => {
  it('allocates by stroke index', () => {
    expect(strokesReceivedOnHole(13, 13)).toBe(1);
    expect(strokesReceivedOnHole(13, 14)).toBe(0);
    expect(strokesReceivedOnHole(0, 1)).toBe(0);
    expect(strokesReceivedOnHole(18, 18)).toBe(1);
    expect(strokesReceivedOnHole(20, 1)).toBe(2);
    expect(strokesReceivedOnHole(20, 2)).toBe(2);
    expect(strokesReceivedOnHole(20, 3)).toBe(1);
    expect(strokesReceivedOnHole(36, 18)).toBe(2);
    expect(strokesReceivedOnHole(40, 4)).toBe(3);
    expect(strokesReceivedOnHole(40, 5)).toBe(2);
  });

  it('gives strokes back for plus handicaps from SI 18', () => {
    expect(strokesReceivedOnHole(-2, 18)).toBe(-1);
    expect(strokesReceivedOnHole(-2, 17)).toBe(-1);
    expect(strokesReceivedOnHole(-2, 16)).toBe(0);
    expect(strokesReceivedOnHole(-2, 1)).toBe(0);
    expect(strokesReceivedOnHole(-20, 18)).toBe(-2);
    expect(strokesReceivedOnHole(-20, 16)).toBe(-1);
  });

  it('rejects bad input', () => {
    expect(() => strokesReceivedOnHole(13.3, 1)).toThrow(RangeError);
    expect(() => strokesReceivedOnHole(13, 0)).toThrow(RangeError);
    expect(() => strokesReceivedOnHole(13, 19)).toThrow(RangeError);
    expect(() => strokesReceivedOnHole(13, 1.5)).toThrow(RangeError);
  });

  it('allocates exactly the playing handicap over 18 holes (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -54, max: 72 }), (ph) => {
        let total = 0;
        for (let si = 1; si <= 18; si++) {
          const s = strokesReceivedOnHole(ph, si);
          // Harder holes never receive fewer strokes than easier ones.
          if (si > 1) expect(s).toBeLessThanOrEqual(strokesReceivedOnHole(ph, si - 1));
          total += s;
        }
        expect(total).toBe(ph);
      }),
    );
  });
});

describe('Stableford and net double bogey', () => {
  it('scores points', () => {
    expect(stablefordPoints(4, 4)).toBe(2);
    expect(stablefordPoints(3, 4)).toBe(3);
    expect(stablefordPoints(2, 4)).toBe(4);
    expect(stablefordPoints(5, 4)).toBe(1);
    expect(stablefordPoints(6, 4)).toBe(0);
    expect(stablefordPoints(9, 4)).toBe(0);
    expect(stablefordPoints(1, 3)).toBe(4);
  });

  it('points are never negative (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 20 }), fc.integer({ min: 3, max: 6 }), (net, par) => {
        const p = stablefordPoints(net, par);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBe(Math.max(0, par + 2 - net));
      }),
    );
  });

  it('caps at net double bogey', () => {
    expect(netDoubleBogeyAdjusted(9, 4, 1)).toBe(7);
    expect(netDoubleBogeyAdjusted(6, 4, 1)).toBe(6);
    expect(netDoubleBogeyAdjusted(8, 5, 2)).toBe(8);
    expect(netDoubleBogeyAdjusted(7, 4, 0)).toBe(6);
    expect(netDoubleBogeyAdjusted(6, 4, -1)).toBe(5);
  });
});

describe('scoreDifferential', () => {
  it('matches the WHS arithmetic', () => {
    // (113/128) × (85 − 71.4) = 12.006 → 12.0
    expect(scoreDifferential(85, 71.4, 128)).toBe(12);
    // (113/135) × (90 − 72.5 − 1) = 13.81 → 13.8
    expect(scoreDifferential(90, 72.5, 135, 1)).toBe(13.8);
    expect(scoreDifferential(68, 71, 113)).toBe(-3);
    // (113/113) × (72 − 71.95) = 0.05 → 0.1 (half up)
    expect(scoreDifferential(72, 71.95, 113)).toBe(0.1);
  });
});

describe('handicapIndex', () => {
  const RECORD = [
    12.0, 14.3, 11.8, 16.2, 13.5, 10.9, 15.0, 12.7, 17.1, 13.3, 11.2, 14.8, 12.4, 18.0, 13.9, 10.5,
    15.6, 12.9, 16.7, 11.6,
  ];
  /** Oldest first, one round per day from 2026-01-01. */
  const dated = (values: readonly number[], startDay = 0): DatedDifferential[] =>
    values.map((value, i) => ({
      value,
      date: new Date(Date.UTC(2026, 0, 1 + startDay + i)).toISOString(),
    }));

  it('implements the WHS 1–20 score table', () => {
    expect(whsScoreTable(0)).toBeNull();
    expect(whsScoreTable(2)).toBeNull();
    const expected: Record<number, [number, number]> = {
      3: [1, -2],
      4: [1, -1],
      5: [1, 0],
      6: [2, -1],
      7: [2, 0],
      8: [2, 0],
      9: [3, 0],
      10: [3, 0],
      11: [3, 0],
      12: [4, 0],
      13: [4, 0],
      14: [4, 0],
      15: [5, 0],
      16: [5, 0],
      17: [6, 0],
      18: [6, 0],
      19: [7, 0],
      20: [8, 0],
    };
    for (const [n, [used, adjustment]] of Object.entries(expected)) {
      expect(whsScoreTable(Number(n))).toEqual({ used, adjustment });
    }
  });

  it('computes the index for every record size 3–20', () => {
    // Differentials 1..n: mean of the lowest k is (k + 1) / 2.
    const expected: Record<number, number> = {
      3: -1,
      4: 0,
      5: 1,
      6: 0.5,
      7: 1.5,
      8: 1.5,
      9: 2,
      10: 2,
      11: 2,
      12: 2.5,
      13: 2.5,
      14: 2.5,
      15: 3,
      16: 3,
      17: 3.5,
      18: 3.5,
      19: 4,
      20: 4.5,
    };
    for (const [n, idx] of Object.entries(expected)) {
      const values = Array.from({ length: Number(n) }, (_, i) => Number(n) - i);
      expect(handicapIndex(dated(values))?.index).toBe(idx);
    }
    expect(handicapIndex(dated([10, 12]))).toBeNull();
    expect(handicapIndex([])).toBeNull();
  });

  it('averages the best 8 of the most recent 20', () => {
    const r = handicapIndex(dated(RECORD));
    // lowest 8: 10.5 10.9 11.2 11.6 11.8 12.0 12.4 12.7 → 93.1 / 8 = 11.6375
    expect(r).toEqual({
      index: 11.6,
      uncapped: 11.6,
      cap: 'none',
      counted: 20,
      used: 8,
      adjustment: 0,
    });

    // An older 21st score drops out of the window.
    expect(handicapIndex([...dated([0], -5), ...dated(RECORD)])?.index).toBe(11.6);
    // A new round pushes the oldest (12.0) out: lowest 8 now include 9.0.
    const newer = [...dated(RECORD), { value: 9.0, date: new Date(Date.UTC(2026, 5, 1)) }];
    // 9.0 10.5 10.9 11.2 11.6 11.8 12.4 12.7 → 90.1 / 8 = 11.2625
    expect(handicapIndex(newer)?.index).toBe(11.3);
    // Input order does not matter, dates do.
    expect(handicapIndex([...newer].reverse())?.index).toBe(11.3);
  });

  it('breaks same-date ties by input order (later = more recent)', () => {
    const sameDay = [0, ...RECORD].map((value) => ({ value, date: '2026-03-01' }));
    expect(handicapIndex(sameDay)?.index).toBe(11.6);
  });

  it('caps at 54', () => {
    expect(handicapIndex(dated([60, 61, 62]))?.index).toBe(54);
  });

  it('applies soft and hard caps relative to the 365-day low', () => {
    expect(handicapIndex(dated(RECORD), 10)).toMatchObject({ index: 11.6, cap: 'none' });
    expect(handicapIndex(dated(RECORD), 8.6)).toMatchObject({ index: 11.6, cap: 'none' });
    // rise 3.6 → 8.0 + 3 + 0.3
    expect(handicapIndex(dated(RECORD), 8.0)).toMatchObject({
      index: 11.3,
      uncapped: 11.6,
      cap: 'soft',
    });
    // rise 6.6 → 5 + 3 + 1.8 = 9.8 (< hard cap 10.0)
    expect(handicapIndex(dated(RECORD), 5.0)).toMatchObject({ index: 9.8, cap: 'soft' });
    // rise 7.6 → soft 9.3 would exceed hard cap 9.0
    expect(handicapIndex(dated(RECORD), 4.0)).toMatchObject({ index: 9, cap: 'hard' });
  });

  it('never exceeds the hard cap (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -5, max: 54, noNaN: true }), { minLength: 3, maxLength: 25 }),
        fc.double({ min: -5, max: 54, noNaN: true }),
        (values, low) => {
          const r = handicapIndex(dated(values), low)!;
          expect(r.index).toBeLessThanOrEqual(roundHalfUp(low + 5, 1) + 1e-9);
          expect(r.index).toBeLessThanOrEqual(r.uncapped);
          expect(r.index).toBeLessThanOrEqual(54);
        },
      ),
    );
  });
});

describe('roundScorecard', () => {
  const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
  const SI = [7, 1, 15, 11, 3, 13, 17, 5, 9, 8, 16, 2, 12, 4, 14, 18, 10, 6];
  const GROSS = [5, 6, 4, 5, 9, 5, 3, 5, 6, 4, 4, 5, 7, 5, 5, 3, 6, 5];
  const card = (gross: readonly (number | null)[]): ScorecardHoleInput[] =>
    PAR.map((par, i) => ({ par, strokeIndex: SI[i]!, gross: gross[i]! }));

  it('scores a full 18-hole card (golden)', () => {
    const c = roundScorecard(card(GROSS), 13, 71.4, 128);
    expect(c.holes.map((h) => h.strokesReceived)).toEqual([
      1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1,
    ]);
    expect(c.holes.map((h) => h.net)).toEqual([
      4, 5, 4, 4, 8, 4, 3, 4, 5, 3, 4, 4, 6, 4, 5, 3, 5, 4,
    ]);
    expect(c.holes.map((h) => h.points)).toEqual([
      2, 1, 1, 3, 0, 2, 2, 2, 2, 3, 1, 2, 1, 2, 1, 2, 2, 2,
    ]);
    expect(c.holes[4]!.adjustedGross).toBe(7); // 9 on a par 4 with a stroke → NDB 7
    expect(c).toMatchObject({
      par: 72,
      gross: 92,
      net: 79,
      points: 31,
      adjustedGross: 90,
      // (113/128) × (90 − 71.4) = 16.42
      differential: 16.4,
    });
  });

  it('treats a pick-up as net double bogey with zero points', () => {
    const gross = [...GROSS] as (number | null)[];
    gross[4] = null;
    const c = roundScorecard(card(gross), 13, 71.4, 128, 0);
    expect(c.holes[4]).toMatchObject({ net: null, points: 0, adjustedGross: 7 });
    expect(c).toMatchObject({ gross: null, net: null, points: 31, adjustedGross: 90 });
    expect(c.differential).toBe(16.4);
  });

  it('omits the differential for non-18-hole cards', () => {
    const c = roundScorecard(card(GROSS).slice(0, 9), 13, 71.4, 128);
    expect(c.par).toBe(36);
    expect(c.gross).toBe(48);
    expect(c.points).toBe(15);
    expect(c.differential).toBeNull();
  });
});
