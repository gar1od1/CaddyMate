import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SG_LIE_CATEGORIES, expectedStrokes } from './baselines.js';
import {
  rollingSg,
  sgCategory,
  sgForShot,
  sgSummary,
  strokesCharged,
  type SgRoundSummary,
} from './strokesGained.js';

describe('sgForShot', () => {
  it('reproduces known values', () => {
    // 150 yd fairway approach to 10 ft: ≈ +0.5 for scratch.
    const approach = sgForShot({
      before: { category: 'fairway', distanceM: 137 },
      after: { category: 'green', distanceM: 3 },
    });
    expect(approach).toBeCloseTo(0.49, 9);
    expect(approach).toBeCloseTo(0.5, 1);

    expect(sgForShot({ before: { category: 'green', distanceM: 1 }, after: 'holed' })).toBeCloseTo(
      0.01,
      9,
    );

    // Same shot is worth less against a weaker baseline's expectations.
    const hcp15 = sgForShot(
      {
        before: { category: 'fairway', distanceM: 137 },
        after: { category: 'green', distanceM: 3 },
      },
      'hcp15',
    );
    expect(hcp15).toBeCloseTo(3.35 - 1.61 - 1, 9);
  });

  it('charges penalties', () => {
    expect(strokesCharged()).toBe(1);
    expect(strokesCharged(1, 'lateral')).toBe(2);
    expect(strokesCharged(2, 'ob')).toBe(2);
    expect(strokesCharged(1, 'ob')).toBe(2);
    expect(strokesCharged(2, 'none')).toBe(2);

    // OB off the tee, replaying from the tee: exactly −2.
    expect(
      sgForShot({
        before: { category: 'tee', distanceM: 400 },
        after: { category: 'tee', distanceM: 400 },
        strokeCount: 2,
        penalty: 'ob',
      }),
    ).toBeCloseTo(-2, 9);

    // Lateral drop in the rough at 180 m.
    const eDrop = expectedStrokes('scratch', 'rough', 180);
    expect(
      sgForShot({
        before: { category: 'tee', distanceM: 400 },
        after: { category: 'rough', distanceM: 180 },
        penalty: 'lateral',
      }),
    ).toBeCloseTo(4.12 - eDrop - 2, 9);
  });

  it('holing out gains E(before) − 1 (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SG_LIE_CATEGORIES),
        fc.double({ min: 0, max: 600, noNaN: true }),
        fc.constantFrom('scratch' as const, 'hcp10' as const, 'hcp15' as const, 'hcp20' as const),
        (category, distanceM, baseline) => {
          const sg = sgForShot({ before: { category, distanceM }, after: 'holed' }, baseline);
          expect(sg).toBeCloseTo(expectedStrokes(baseline, category, distanceM) - 1, 12);
        },
      ),
    );
  });
});

describe('sgCategory', () => {
  it('classifies OTT/APP/ARG/PUTT with the 27 m rule', () => {
    const at = (category: 'tee' | 'fairway' | 'green', distanceM: number) => ({
      category,
      distanceM,
    });
    expect(sgCategory({ before: at('tee', 380), seq: 1, par: 4 })).toBe('ott');
    expect(sgCategory({ before: at('tee', 480), seq: 1, par: 5 })).toBe('ott');
    expect(sgCategory({ before: at('tee', 150), seq: 1, par: 3 })).toBe('app');
    expect(sgCategory({ before: at('tee', 25), seq: 1, par: 3 })).toBe('arg');
    expect(sgCategory({ before: at('fairway', 27), seq: 2, par: 4 })).toBe('arg');
    expect(sgCategory({ before: at('fairway', 27.1), seq: 2, par: 4 })).toBe('app');
    expect(sgCategory({ before: at('green', 12), seq: 3, par: 4 })).toBe('putt');
  });
});

describe('sgSummary / rollingSg', () => {
  it('totals a round by category and club', () => {
    const s = sgSummary([
      { sg: 0.2, category: 'ott', clubId: 'D' },
      { sg: -0.4, category: 'app', clubId: '7i' },
      { sg: 0.1, category: 'app', clubId: '7i' },
      { sg: -0.3, category: 'arg', clubId: 'SW' },
      { sg: 0.05, category: 'putt', clubId: 'P' },
      { sg: -0.1, category: 'putt' },
      { sg: 0.3, category: 'app', clubId: null },
    ]);
    expect(s.total).toBeCloseTo(-0.15, 9);
    expect(s.byCategory.ott).toBeCloseTo(0.2, 9);
    expect(s.byCategory.app).toBeCloseTo(0, 9);
    expect(s.byCategory.arg).toBeCloseTo(-0.3, 9);
    expect(s.byCategory.putt).toBeCloseTo(-0.05, 9);
    expect(s.counts).toEqual({ ott: 1, app: 3, arg: 1, putt: 2 });
    expect(Object.keys(s.byClub).sort()).toEqual(['7i', 'D']);
    expect(s.byClub['7i']!.count).toBe(2);
    expect(s.byClub['7i']!.sg).toBeCloseTo(-0.3, 9);
    expect(sgSummary([]).total).toBe(0);
  });

  it('computes trailing means', () => {
    const r = (total: number): SgRoundSummary =>
      sgSummary([{ sg: total, category: 'app', clubId: '7i' }]);
    const out = rollingSg([r(1), r(2), r(4)], 2);
    expect(out.map((p) => p.n)).toEqual([1, 2, 2]);
    expect(out.map((p) => p.total)).toEqual([1, 1.5, 3]);
    expect(out[2]!.byCategory).toEqual({ ott: 0, app: 3, arg: 0, putt: 0 });
    expect(rollingSg([], 5)).toEqual([]);
    expect(() => rollingSg([r(1)], 0)).toThrow(RangeError);
    expect(() => rollingSg([r(1)], 1.5)).toThrow(RangeError);
  });
});
