import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Lie } from '../types/index.js';
import {
  BASELINES,
  BASELINE_IDS,
  SG_LIE_CATEGORIES,
  baselineForHandicap,
  expectedStrokes,
  fromBaselineRows,
  interpolate,
  lieToSgCategory,
  overlayBaseline,
  toBaselineRows,
} from './baselines.js';

describe('baselines', () => {
  it('matches the benchmark values', () => {
    expect(expectedStrokes('scratch', 'fairway', 137)).toBeCloseTo(2.98, 3);
    expect(expectedStrokes('hcp15', 'fairway', 137)).toBeCloseTo(3.35, 3);
    expect(expectedStrokes('scratch', 'green', 1)).toBeCloseTo(1.01, 3);
    expect(expectedStrokes('scratch', 'green', 3)).toBeCloseTo(1.49, 3);
    expect(expectedStrokes('scratch', 'green', 10)).toBeCloseTo(1.9, 3);
    expect(expectedStrokes('hcp10', 'fairway', 137)).toBeCloseTo(3.227, 3);
    expect(expectedStrokes('hcp20', 'fairway', 137)).toBeCloseTo(3.473, 3);
  });

  it('interpolates linearly and clamps at the ends', () => {
    // fairway 128 → 2.95, 137 → 2.98
    expect(expectedStrokes('scratch', 'fairway', 132.5)).toBeCloseTo(2.965, 9);
    expect(expectedStrokes('scratch', 'fairway', 0)).toBe(2.1);
    expect(expectedStrokes('scratch', 'fairway', 5000)).toBe(4.72);
    expect(expectedStrokes('scratch', 'fairway', Infinity)).toBe(4.72);
    expect(expectedStrokes(BASELINES.scratch, 'green', -1)).toBe(1);
    expect(() => expectedStrokes('scratch', 'green', NaN)).toThrow(RangeError);
    expect(() => interpolate([], 1)).toThrow(RangeError);
  });

  it('is monotone in distance and ordered by handicap (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SG_LIE_CATEGORIES),
        fc.double({ min: 0, max: 700, noNaN: true }),
        fc.double({ min: 0, max: 700, noNaN: true }),
        (cat, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          let prev = -Infinity;
          for (const id of BASELINE_IDS) {
            const eLo = expectedStrokes(id, cat, lo);
            expect(eLo).toBeLessThanOrEqual(expectedStrokes(id, cat, hi) + 1e-12);
            expect(eLo).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(eLo).toBeGreaterThanOrEqual(1);
            prev = eLo;
          }
        },
      ),
    );
  });

  it('picks the nearest band for a handicap index', () => {
    expect(baselineForHandicap(-2)).toBe('scratch');
    expect(baselineForHandicap(8)).toBe('hcp10');
    expect(baselineForHandicap(15.4)).toBe('hcp15');
    expect(baselineForHandicap(28)).toBe('hcp20');
  });

  it('maps lies to categories', () => {
    const expected: Record<Lie, string> = {
      tee: 'tee',
      fairway: 'fairway',
      first_cut: 'fairway',
      hardpan: 'fairway',
      rough: 'rough',
      deep_rough: 'rough',
      sand: 'sand',
      pine_straw: 'recovery',
      green: 'green',
    };
    for (const [lie, cat] of Object.entries(expected)) {
      expect(lieToSgCategory(lie as Lie)).toBe(cat);
    }
  });

  it('overlays a self table per category', () => {
    const t = overlayBaseline('hcp15', {
      green: [
        [0, 1],
        [10, 2],
      ],
    });
    expect(expectedStrokes(t, 'green', 5)).toBe(1.5);
    expect(expectedStrokes(t, 'fairway', 137)).toBe(expectedStrokes('hcp15', 'fairway', 137));
    expect(BASELINES.hcp15.green).not.toBe(t.green);
    expect(() => overlayBaseline('scratch', { sand: [] })).toThrow(RangeError);
    expect(() =>
      overlayBaseline(BASELINES.scratch, {
        sand: [
          [10, 2],
          [10, 3],
        ],
      }),
    ).toThrow(RangeError);
  });

  it('exports sg_baselines rows and reads them back', () => {
    const rows = toBaselineRows();
    const perBand = SG_LIE_CATEGORIES.reduce((n, c) => n + BASELINES.scratch[c].length, 0);
    expect(rows).toHaveLength(4 * perBand);
    expect(rows).toContainEqual({
      baseline_id: 'hcp15',
      category: 'fairway',
      distance_m: 137,
      expected_strokes: 3.35,
    });
    const back = fromBaselineRows(rows);
    expect(back).toEqual(BASELINES);

    const self = toBaselineRows({ 'self:u1': BASELINES.scratch });
    expect(self.every((r) => r.baseline_id === 'self:u1')).toBe(true);

    // numeric columns can arrive as strings and in any order
    const parsed = fromBaselineRows([
      { baseline_id: 'x', category: 'green', distance_m: '10.0', expected_strokes: '2.000' },
      { baseline_id: 'x', category: 'green', distance_m: 0, expected_strokes: 1 },
    ]);
    expect(parsed).toEqual({
      x: {
        green: [
          [0, 1],
          [10, 2],
        ],
      },
    });
  });
});
