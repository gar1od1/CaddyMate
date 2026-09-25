import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { yardsToMetres } from '../units/index.js';
import type { FrameResult } from '../types/index.js';
import {
  DEFAULT_DRIVER_DISTANCE_M,
  DISPERSION_ENGINE_VERSION,
  EMPIRICAL_MIN_N,
  LEVEL_SIGMA_SCALE,
  PRIOR_PSEUDO_COUNT,
  Z90,
  confidenceFor,
  conePolygon,
  ellipsePolygon,
  fitConditionPatterns,
  fitPattern,
  fromStandardNormal,
  handicapBandFor,
  isExcludedShot,
  lateralScale,
  loftTableYards,
  mulberry32,
  priorFor,
  recencyWeight,
  sampleShots,
  shotWeight,
  sourceWeight,
  weightedQuantile,
  type ClubPattern,
  type PatternShot,
} from './index.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25);

/** Deterministic standard normals for synthetic data. */
function normals(seed: number): () => number {
  const r = mulberry32(seed);
  return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

function synth(
  n: number,
  seed: number,
  along: [number, number],
  lateral: [number, number],
  extra: Partial<PatternShot> = {},
): PatternShot[] {
  const z = normals(seed);
  return Array.from({ length: n }, () => ({
    alongM: along[0] + along[1] * z(),
    lateralM: lateral[0] + lateral[1] * z(),
    playedAt: NOW,
    source: 'sim' as const,
    strike: 'good' as const,
    ...extra,
  }));
}

const shot = (alongM: number, lateralM: number, extra: Partial<PatternShot> = {}): PatternShot => ({
  alongM,
  lateralM,
  playedAt: NOW,
  source: 'course',
  strike: 'good',
  ...extra,
});

/** Ray-casting point-in-polygon in the club frame. */
function inside(poly: readonly FrameResult[], p: FrameResult): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (
      a.lateralM > p.lateralM !== b.lateralM > p.lateralM &&
      p.alongM <
        ((b.alongM - a.alongM) * (p.lateralM - a.lateralM)) / (b.lateralM - a.lateralM) + a.alongM
    ) {
      c = !c;
    }
  }
  return c;
}

describe('weights (§8.1, §8.2)', () => {
  it('halves every half-life and accepts Date or epoch ms', () => {
    expect(DISPERSION_ENGINE_VERSION).toBe(1);
    expect(recencyWeight(NOW, NOW)).toBe(1);
    expect(recencyWeight(NOW - 180 * DAY, NOW)).toBeCloseTo(0.5, 12);
    expect(recencyWeight(new Date(NOW - 365 * DAY), new Date(NOW))).toBeCloseTo(0.2455, 3);
    expect(recencyWeight(NOW - 30 * DAY, NOW, 30)).toBeCloseTo(0.5, 12);
    // Future-dated shots count as played now.
    expect(recencyWeight(NOW + 10 * DAY, NOW)).toBe(1);
    expect(() => recencyWeight(NOW, NOW, 0)).toThrow(RangeError);
    expect(() => recencyWeight(NOW, NOW, Number.NaN)).toThrow(RangeError);
  });

  it('recency weight lies in (0, 1] (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 20_000, noNaN: true }),
        fc.double({ min: 30, max: 1000, noNaN: true }),
        (ageDays, h) => {
          const w = recencyWeight(NOW - ageDays * DAY, NOW, h);
          return w > 0 && w <= 1;
        },
      ),
    );
  });

  it('source weights default to 1 and are configurable', () => {
    expect(sourceWeight('sim')).toBe(1);
    expect(sourceWeight('course', {})).toBe(1);
    expect(sourceWeight('sim', { sim: 0.5 })).toBe(0.5);
    const s = shot(150, 0, { source: 'sim', weight: 0.5, playedAt: NOW - 180 * DAY });
    expect(shotWeight(s, NOW, 180, { sim: 0.5 })).toBeCloseTo(0.125, 12);
    expect(shotWeight(shot(150, 0), NOW)).toBe(1);
  });

  it('applies the §8.1 exclusions', () => {
    expect(isExcludedShot(shot(150, 0))).toBe(false);
    expect(isExcludedShot(shot(150, 0, { penalty: 'none' }))).toBe(false);
    expect(isExcludedShot(shot(150, 0, { penalty: 'ob' }))).toBe(true);
    expect(isExcludedShot(shot(150, 0, { isPutt: true }))).toBe(true);
    expect(isExcludedShot(shot(150, 0, { isPutt: false }))).toBe(false);
    expect(isExcludedShot(shot(150, 0, { reconstructed: true, endAccuracyM: 20 }))).toBe(true);
    expect(isExcludedShot(shot(150, 0, { reconstructed: true, endAccuracyM: 15 }))).toBe(false);
    expect(isExcludedShot(shot(150, 0, { reconstructed: true }))).toBe(true);
    expect(isExcludedShot(shot(150, 0, { endAccuracyM: 40 }))).toBe(false);
    expect(isExcludedShot(shot(Number.NaN, 0))).toBe(true);
    expect(isExcludedShot(shot(150, Infinity))).toBe(true);
  });
});

describe('prior (§8.3)', () => {
  it('hits the persona anchors: driver 240, 7i 160, PW 120 yd', () => {
    const drv = priorFor({ kind: 'driver', loftDeg: 9 });
    expect(drv.n0).toBe(PRIOR_PSEUDO_COUNT);
    expect(drv.distance.mean).toBeCloseTo(yardsToMetres(240), 9);
    expect(drv.distance.sd).toBeCloseTo(0.055 * yardsToMetres(240), 9);
    expect(drv.lateral).toEqual({ mean: 0, sd: 0.08 * yardsToMetres(240) });
    const i7 = priorFor({ kind: 'iron', loftDeg: 30 });
    expect(i7.distance.mean).toBeCloseTo(yardsToMetres(160), 9);
    expect(i7.lateral.sd).toBeCloseTo(0.065 * yardsToMetres(160), 9);
    expect(priorFor({ kind: 'iron', loftDeg: 45 }).distance.mean).toBeCloseTo(
      yardsToMetres(120),
      9,
    );
  });

  it('prefers stock distance, falls back to kind default loft, scales by driver distance', () => {
    expect(priorFor({ kind: 'iron', stockTotalM: 140 }).distance.mean).toBe(140);
    expect(priorFor({ kind: 'iron', stockTotalM: null, loftDeg: null }).distance.mean).toBeCloseTo(
      yardsToMetres(160),
      9,
    );
    expect(priorFor({ kind: 'wedge', stockTotalM: 0 }).distance.mean).toBeCloseTo(
      yardsToMetres(107),
      9,
    );
    expect(priorFor({ kind: 'driver' }, 200).distance.mean).toBe(200);
    expect(
      priorFor({ kind: 'iron', loftDeg: 30 }, DEFAULT_DRIVER_DISTANCE_M / 2).distance.mean,
    ).toBeCloseTo(yardsToMetres(80), 9);
    const wood = priorFor({ kind: 'wood' }, undefined, '0-5');
    expect(wood.lateral.sd / wood.distance.mean).toBeCloseTo(0.055, 12);
    const hyb = priorFor({ kind: 'hybrid', loftDeg: 22 }, undefined, '21+');
    expect(hyb.lateral.sd / hyb.distance.mean).toBeCloseTo(0.09, 12);
    expect(() => priorFor({ kind: 'putter' })).toThrow(RangeError);
  });

  it('loft table interpolates, clamps, and is monotone', () => {
    expect(loftTableYards(5)).toBe(240);
    expect(loftTableYards(70)).toBe(72);
    expect(loftTableYards(32)).toBeCloseTo(154.5, 9);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 80, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (l, d) => loftTableYards(l + d) <= loftTableYards(l),
      ),
    );
  });

  it('bands handicaps', () => {
    expect([-2, 5, 8, 13, 18, 28].map(handicapBandFor)).toEqual([
      '0-5',
      '0-5',
      '6-10',
      '11-15',
      '16-20',
      '21+',
    ]);
  });
});

describe('fitPattern (§8.4)', () => {
  it('recovers N(150, 8) × N(+3, 6) from 40 shots', () => {
    const p = fitPattern(synth(40, 1, [150, 8], [3, 6]), { now: NOW });
    expect(p.distance.mean).toBeCloseTo(150, -1);
    expect(Math.abs(p.distance.mean - 150)).toBeLessThan(3);
    expect(Math.abs(p.distance.sd - 8)).toBeLessThan(2.5);
    expect(Math.abs(p.lateral.mean - 3)).toBeLessThan(2.5);
    expect(Math.abs(p.lateral.sd_left - 6)).toBeLessThan(2.5);
    expect(Math.abs(p.lateral.sd_right - 6)).toBeLessThan(2.5);
    expect(Math.abs(p.rho)).toBeLessThan(0.35);
    expect(p.n_effective).toBe(40);
    expect(p.n_raw).toBe(40);
    expect(p.n_sim).toBe(40);
    expect(p.n_course).toBe(0);
    expect(p.confidence).toBe('established');
    expect(p.miss).toEqual({
      p_miss: 0,
      distance: { mean: 0, sd: 0 },
      lateral: { mean: 0, sd: 0 },
    });
    // Empirical quantiles at n_effective ≥ 15.
    expect(p.distance.q10).toBeLessThan(p.distance.q50);
    expect(Math.abs(p.distance.q90 - (150 + Z90 * 8))).toBeLessThan(5);
  });

  it('a right-heavy sample gives sd_right > sd_left', () => {
    const z = normals(7);
    const shots = Array.from({ length: 60 }, () => {
      const l = z();
      return shot(150 + 6 * z(), l < 0 ? 4 * l : 15 * l);
    });
    const p = fitPattern(shots, { prior: priorFor({ kind: 'iron', loftDeg: 30 }) });
    expect(p.lateral.sd_right).toBeGreaterThan(p.lateral.sd_left + 2);
    expect(p.lateral.q90 - p.lateral.q50).toBeGreaterThan(p.lateral.q50 - p.lateral.q10);
    expect(p.n_course).toBe(60);
  });

  it('routes mishits to the miss pattern and drops exclusions', () => {
    const good = synth(20, 3, [150, 5], [0, 4]);
    const misses = [shot(110, -10, { strike: 'fat' }), shot(120, 10, { strike: 'thin' })];
    const excluded = [
      shot(400, 90, { penalty: 'lateral' }),
      shot(2, 0, { isPutt: true }),
      shot(300, 50, { reconstructed: true, endAccuracyM: 25 }),
      shot(999, 999, { weight: 0 }),
    ];
    const base = fitPattern(good);
    const p = fitPattern([...good, ...misses, ...excluded]);
    expect(p.distance).toEqual(base.distance);
    expect(p.lateral).toEqual(base.lateral);
    expect(p.n_raw).toBe(20);
    expect(p.miss.p_miss).toBeCloseTo(2 / 22, 12);
    expect(p.miss.distance).toEqual({ mean: 115, sd: 5 });
    expect(p.miss.lateral).toEqual({ mean: 0, sd: 10 });
  });

  it('the prior dominates at n = 0 and vanishes as n → ∞', () => {
    const prior = priorFor({ kind: 'iron', stockTotalM: 150 });
    const p0 = fitPattern([], { prior, now: NOW });
    expect(p0.distance.mean).toBe(150);
    expect(p0.distance.sd).toBeCloseTo(prior.distance.sd, 12);
    expect(p0.lateral.mean).toBe(0);
    expect(p0.lateral.sd_left).toBeCloseTo(prior.lateral.sd, 12);
    expect(p0.lateral.sd_right).toBeCloseTo(prior.lateral.sd, 12);
    expect(p0.rho).toBe(0);
    expect(p0.n_effective).toBe(0);
    expect(p0.confidence).toBe('seeded');
    // Normal quantiles below the empirical threshold.
    expect(p0.distance.q90).toBeCloseTo(150 + Z90 * prior.distance.sd, 9);
    expect(p0.lateral.q10).toBeCloseTo(-Z90 * prior.lateral.sd, 9);

    // 8 shots at 170: halfway between prior and data.
    const p8 = fitPattern(synth(8, 5, [170, 0], [0, 0]), { prior });
    expect(p8.distance.mean).toBeCloseTo(160, 9);
    expect(p8.confidence).toBe('seeded');

    const big = fitPattern(synth(20_000, 9, [170, 6], [2, 5]), { prior });
    expect(Math.abs(big.distance.mean - 170)).toBeLessThan(0.3);
    expect(Math.abs(big.distance.sd - 6)).toBeLessThan(0.2);
    expect(Math.abs(big.lateral.mean - 2)).toBeLessThan(0.2);
  });

  it('down-weights old shots (recency)', () => {
    const shots = [
      shot(100, 0, { playedAt: NOW - 360 * DAY }),
      shot(200, 0, { playedAt: new Date(NOW) }),
    ];
    // Weights 0.25 and 1 ⇒ mean 180; `now` defaults to the latest shot.
    expect(fitPattern(shots).distance.mean).toBeCloseTo(180, 9);
    expect(fitPattern(shots, { halfLifeDays: 1e9 }).distance.mean).toBeCloseTo(150, 3);
  });

  it('estimates rho and handles degenerate spreads', () => {
    const z = normals(11);
    const shots = Array.from({ length: 400 }, () => {
      const a = z();
      const b = z();
      return shot(150 + 8 * a, 5 * (0.6 * a + 0.8 * b));
    });
    expect(Math.abs(fitPattern(shots).rho - 0.6)).toBeLessThan(0.08);
    const flat = fitPattern([shot(150, 3), shot(150, 3)]);
    expect(flat.rho).toBe(0);
    expect(flat.distance.sd).toBe(0);
  });

  it('throws with no usable good shots and no prior', () => {
    expect(() => fitPattern([])).toThrow(RangeError);
    expect(() => fitPattern([shot(100, 0, { strike: 'shank' })])).toThrow(RangeError);
  });

  it('confidence tiers', () => {
    expect([0, 11.9, 12, 30, 30.1].map(confidenceFor)).toEqual([
      'seeded',
      'seeded',
      'forming',
      'forming',
      'established',
    ]);
  });

  const shotArb = fc.record({
    alongM: fc.double({ min: 0, max: 300, noNaN: true }),
    lateralM: fc.double({ min: -60, max: 60, noNaN: true }),
    ageDays: fc.double({ min: 0, max: 2000, noNaN: true }),
    source: fc.constantFrom('course' as const, 'sim' as const, 'manual' as const),
    strike: fc.constantFrom('good' as const, 'good' as const, 'good' as const, 'fat' as const),
  });

  it('quantiles are monotone and moments finite (property)', () => {
    fc.assert(
      fc.property(fc.array(shotArb, { maxLength: 60 }), fc.boolean(), (raw, withPrior) => {
        const shots = raw.map((s) =>
          shot(s.alongM, s.lateralM, {
            playedAt: NOW - s.ageDays * DAY,
            source: s.source,
            strike: s.strike,
          }),
        );
        const opts = withPrior
          ? { now: NOW, prior: priorFor({ kind: 'iron' as const, loftDeg: 34 }) }
          : { now: NOW };
        let p: ClubPattern;
        try {
          p = fitPattern(shots, opts);
        } catch {
          return !withPrior;
        }
        const eps = 1e-9;
        return (
          p.distance.q10 <= p.distance.q50 + eps &&
          p.distance.q50 <= p.distance.q90 + eps &&
          p.lateral.q10 <= p.lateral.q50 + eps &&
          p.lateral.q50 <= p.lateral.q90 + eps &&
          p.rho >= -1 &&
          p.rho <= 1 &&
          p.miss.p_miss >= 0 &&
          p.miss.p_miss <= 1 &&
          [p.distance.sd, p.lateral.sd_left, p.lateral.sd_right].every(
            (x) => Number.isFinite(x) && x >= 0,
          )
        );
      }),
    );
  });
});

describe('weightedQuantile', () => {
  it('interpolates between weighted midpoints and clamps to the ends', () => {
    const pts = [
      { x: 3, w: 1 },
      { x: 1, w: 1 },
      { x: 2, w: 2 },
    ];
    // Midpoints: x=1 @ 0.125, x=2 @ 0.5, x=3 @ 0.875.
    expect(weightedQuantile(pts, 0.1)).toBe(1);
    expect(weightedQuantile(pts, 0.5)).toBe(2);
    expect(weightedQuantile(pts, 0.3125)).toBeCloseTo(1.5, 12);
    expect(weightedQuantile(pts, 0.95)).toBe(3);
  });

  it('is monotone in q (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.double({ min: -100, max: 100, noNaN: true }),
            w: fc.double({ min: 0.01, max: 5, noNaN: true }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pts, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return weightedQuantile(pts, lo) <= weightedQuantile(pts, hi) + 1e-9;
        },
      ),
    );
  });
});

describe('fitConditionPatterns (§8.5)', () => {
  it('keeps buckets with n_effective ≥ 15, empirical and prior-free', () => {
    const shots = [
      ...synth(20, 21, [140, 6], [4, 5], { bucketKey: 'fairway|h:0|c:0' }),
      ...synth(10, 22, [150, 6], [0, 5], { bucketKey: 'rough|h:0|c:0' }),
      ...synth(3, 23, [150, 6], [0, 5], { bucketKey: 'sand|h:0|c:0', strike: 'fat' }),
      ...synth(30, 24, [150, 6], [0, 5]),
    ];
    const out = fitConditionPatterns(shots);
    expect([...out.keys()]).toEqual(['fairway|h:0|c:0']);
    const fw = out.get('fairway|h:0|c:0')!;
    expect(fw.n_effective).toBe(20);
    expect(fw.params).toEqual(fitPattern(shots.slice(0, 20), { now: NOW }));
    expect(fw.params.n_effective).toBeGreaterThanOrEqual(EMPIRICAL_MIN_N);
  });

  it('applies recency and source weights', () => {
    const shots = synth(20, 25, [140, 6], [4, 5], { bucketKey: 'tee|h:0|c:0' });
    expect(fitConditionPatterns(shots, { now: NOW + 180 * DAY }).size).toBe(0);
    expect(fitConditionPatterns(shots, { sourceWeights: { sim: 0.5 } }).size).toBe(0);
    expect(fitConditionPatterns(shots, { halfLifeDays: 90 }).size).toBe(1);
  });
});

/** A hand-built pattern for the geometry tests. */
function pattern(over: Partial<ClubPattern> = {}): ClubPattern {
  return {
    distance: { mean: 150, sd: 8, q10: 0, q50: 0, q90: 0 },
    lateral: { mean: 3, sd_left: 5, sd_right: 9, q10: 0, q50: 0, q90: 0 },
    rho: 0,
    n_effective: 30,
    n_raw: 30,
    n_sim: 30,
    n_course: 0,
    miss: { p_miss: 0, distance: { mean: 0, sd: 0 }, lateral: { mean: 0, sd: 0 } },
    confidence: 'forming',
    ...over,
  };
}

describe('rendering (§8.7)', () => {
  it('cone spans mean ± kσ radially and the skewed lateral bounds angularly', () => {
    const p = pattern();
    const k = LEVEL_SIGMA_SCALE[0.8];
    const poly = conePolygon(p, { steps: 10 });
    expect(poly).toHaveLength(2 * 11 + 1);
    expect(poly[poly.length - 1]).toEqual(poly[0]);
    const far = poly[0]!;
    expect(Math.hypot(far.alongM, far.lateralM)).toBeCloseTo(150 + k * 8, 9);
    expect(far.lateralM / far.alongM).toBeCloseTo((3 - k * 5) / 150, 9);
    const farRight = poly[10]!;
    expect(farRight.lateralM / farRight.alongM).toBeCloseTo((3 + k * 9) / 150, 9);
    const nearRight = poly[11]!;
    expect(Math.hypot(nearRight.alongM, nearRight.lateralM)).toBeCloseTo(150 - k * 8, 9);
    // Wider on the big-miss (right) side.
    expect(Math.abs(farRight.lateralM)).toBeGreaterThan(Math.abs(far.lateralM));
    expect(inside(poly, { alongM: 150, lateralM: 3 })).toBe(true);
    // Defaults: 80 %, 24 steps; 95 % is wider than the 1σ core.
    expect(conePolygon(p)).toHaveLength(51);
    const core = conePolygon(p, { quantile: 1, steps: 4 });
    const outer = conePolygon(p, { quantile: 0.95, steps: 4 });
    expect(outer[0]!.alongM).toBeGreaterThan(core[0]!.alongM);
    // Near edge clamps at the ball for a very loose pattern.
    const loose = conePolygon(pattern({ distance: { mean: 20, sd: 30, q10: 0, q50: 0, q90: 0 } }), {
      steps: 2,
    });
    expect(loose[3]).toEqual({ alongM: 0, lateralM: 0 });
  });

  it('ellipse honours asymmetric widths and rho', () => {
    const p = pattern();
    const k = LEVEL_SIGMA_SCALE[0.95];
    const poly = ellipsePolygon(p, 0.95, 4);
    expect(poly).toHaveLength(7);
    const along = poly.map((q) => q.alongM);
    const lat = poly.map((q) => q.lateralM);
    expect(Math.max(...along)).toBeCloseTo(150 + k * 8, 9);
    expect(Math.min(...along)).toBeCloseTo(150 - k * 8, 9);
    expect(Math.max(...lat)).toBeCloseTo(3 + k * 9, 9);
    expect(Math.min(...lat)).toBeCloseTo(3 - k * 5, 9);
    expect(ellipsePolygon(p)).toHaveLength(51);
    expect(ellipsePolygon(p, 1, 1)).toHaveLength(6);
    // Positive rho tilts long shots to the right.
    const tilted = fromStandardNormal(pattern({ rho: 0.8 }), 1, 0);
    expect(tilted.lateralM).toBeCloseTo(3 + 0.8 * 9, 9);
    expect(lateralScale(p, -1)).toBe(5);
    expect(lateralScale(p, 0)).toBe(9);
  });

  const patternArb = fc.record({
    meanD: fc.double({ min: 30, max: 280, noNaN: true }),
    sdD: fc.double({ min: 0.5, max: 30, noNaN: true }),
    meanL: fc.double({ min: -20, max: 20, noNaN: true }),
    sdLeft: fc.double({ min: 0.5, max: 30, noNaN: true }),
    sdRight: fc.double({ min: 0.5, max: 30, noNaN: true }),
    rho: fc.double({ min: -0.95, max: 0.95, noNaN: true }),
  });
  const build = (a: {
    meanD: number;
    sdD: number;
    meanL: number;
    sdLeft: number;
    sdRight: number;
    rho: number;
  }): ClubPattern =>
    pattern({
      distance: { mean: a.meanD, sd: a.sdD, q10: 0, q50: 0, q90: 0 },
      lateral: { mean: a.meanL, sd_left: a.sdLeft, sd_right: a.sdRight, q10: 0, q50: 0, q90: 0 },
      rho: a.rho,
    });

  it('a lopsided, strongly correlated ellipse still encloses the mean at coarse steps', () => {
    const p = build({ meanD: 30, sdD: 0.5, meanL: 0, sdLeft: 13.9, sdRight: 0.5, rho: 0.95 });
    for (let steps = 3; steps <= 30; steps++) {
      expect(inside(ellipsePolygon(p, 0.8, steps), { alongM: 30, lateralM: 0 })).toBe(true);
    }
  });

  it('ellipse polygons are closed and contain the mean (property)', () => {
    fc.assert(
      fc.property(
        patternArb,
        fc.constantFrom(1 as const, 0.8 as const, 0.95 as const),
        fc.integer({ min: 3, max: 90 }),
        (a, level, steps) => {
          const p = build(a);
          const poly = ellipsePolygon(p, level, steps);
          const first = poly[0]!;
          const last = poly[poly.length - 1]!;
          return (
            poly.length === steps + 3 &&
            first.alongM === last.alongM &&
            first.lateralM === last.lateralM &&
            inside(poly, { alongM: a.meanD, lateralM: a.meanL })
          );
        },
      ),
    );
  });

  it('cone polygons are closed and contain the mean direction at mean distance (property)', () => {
    fc.assert(
      fc.property(patternArb, (a) => {
        const poly = conePolygon(build(a), { quantile: 0.8, steps: 16 });
        const first = poly[0]!;
        const last = poly[poly.length - 1]!;
        // The cone is polar: the mean shot sits on the bias ray at radius = mean distance.
        const th = Math.atan2(a.meanL, a.meanD);
        return (
          first.alongM === last.alongM &&
          first.lateralM === last.lateralM &&
          inside(poly, { alongM: a.meanD * Math.cos(th), lateralM: a.meanD * Math.sin(th) })
        );
      }),
    );
  });
});

describe('sampleShots', () => {
  it('is deterministic for a seed', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 50 }), (seed, n) => {
        const p = pattern({
          miss: { p_miss: 0.2, distance: { mean: 100, sd: 10 }, lateral: { mean: 0, sd: 12 } },
        });
        const a = sampleShots(p, n, seed);
        expect(a).toEqual(sampleShots(p, n, seed));
        expect(a).toHaveLength(n);
      }),
    );
    expect(sampleShots(pattern(), 5, 1)).not.toEqual(sampleShots(pattern(), 5, 2));
    expect(sampleShots(pattern(), -3, 1)).toEqual([]);
  });

  it('sample moments approach the pattern', () => {
    const p = pattern({
      rho: 0.4,
      miss: { p_miss: 0.1, distance: { mean: 100, sd: 10 }, lateral: { mean: -5, sd: 12 } },
    });
    const s = sampleShots(p, 40_000, 42);
    const main = s.filter((x) => !x.miss);
    const miss = s.filter((x) => x.miss);
    expect(miss.length / s.length).toBeCloseTo(0.1, 2);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const along = main.map((x) => x.alongM);
    const mA = mean(along);
    expect(mA).toBeCloseTo(150, 0);
    expect(Math.sqrt(mean(along.map((x) => (x - mA) ** 2)))).toBeCloseTo(8, 0);
    // Two-piece lateral: half the mass either side of the mean, each half-RMS = its half-SD.
    const lat = main.map((x) => x.lateralM - 3);
    const left = lat.filter((x) => x < 0);
    const right = lat.filter((x) => x >= 0);
    expect(left.length / lat.length).toBeCloseTo(0.5, 1);
    expect(Math.sqrt(mean(left.map((x) => x * x)))).toBeCloseTo(5, 0);
    expect(Math.sqrt(mean(right.map((x) => x * x)))).toBeCloseTo(9, 0);
    expect(mean(miss.map((x) => x.alongM))).toBeCloseTo(100, -1);
    expect(mean(miss.map((x) => x.lateralM))).toBeCloseTo(-5, -1);
    // Refit on the sampled main shots recovers the spreads.
    const refit = fitPattern(main.map((x) => shot(x.alongM, x.lateralM)));
    expect(refit.distance.sd).toBeCloseTo(8, 0);
    expect(refit.rho).toBeGreaterThan(0.3);
  });
});
