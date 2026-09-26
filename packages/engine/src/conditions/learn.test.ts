import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FLAT_STANCE,
  STANDARD_CONDITIONS,
  type ClubKind,
  type Lie,
  type SlopeStrength,
  type StanceSlope,
} from '../types/index.js';
import {
  DEFAULT_CONDITION_MODEL,
  LEARN_CLAMP,
  LEARN_MIN_SHOTS,
  applyConditions,
  fitConditionCoefficients,
  resolveConditionModel,
  toConditionOverrides,
  type ConditionModelV1,
  type KindConditionEstimate,
  type LearnShot,
} from './index.js';

/** Deterministic PRNG (mulberry32) so a failing property replays exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  return { next, normal, pick, uniform: (lo: number, hi: number) => lo + (hi - lo) * next() };
}

const MEAN_ALONG: Record<ClubKind, number> = {
  driver: 230,
  wood: 200,
  hybrid: 180,
  iron: 150,
  wedge: 100,
  putter: 5,
};

const LIES: readonly Lie[] = ['tee', 'fairway', 'fairway', 'first_cut', 'rough'];
const STRENGTHS: readonly SlopeStrength[] = ['none', 'none', 'none', 'mild', 'severe'];

interface TrueCoefficients {
  head: number;
  tail: number;
  cross: number;
  elev: number;
}

function trueModel(kind: ClubKind, k: TrueCoefficients): ConditionModelV1 {
  return resolveConditionModel({
    wind: { headPerMps: k.head, tailPerMps: k.tail, crossPerMps: { [kind]: k.cross } },
    elevation: { perMetre: { [kind]: k.elev } },
  });
}

const T0 = Date.UTC(2026, 0, 1);

/**
 * `n` synthetic course shots of `kind`: a neutral result drawn around the
 * club's mean (σ 5 % along, 6 % lateral), then conditioned with `model`.
 * Winds 0–10 m/s from anywhere, rises ±15 m, random lie / slope / handedness.
 */
function synthShots(
  seed: number,
  n: number,
  kind: ClubKind,
  model: ConditionModelV1,
  over: Partial<LearnShot> = {},
): LearnShot[] {
  const r = rng(seed);
  const mu = { alongM: MEAN_ALONG[kind], lateralM: r.uniform(-5, 5) };
  return Array.from({ length: n }, (_, i) => {
    const slope: StanceSlope = {
      uphill: r.pick(STRENGTHS),
      downhill: 'none',
      ballAboveFeet: 'none',
      ballBelowFeet: r.pick(STRENGTHS),
    };
    const rise = r.uniform(-15, 15);
    const shot: LearnShot = {
      observed: { alongM: 0, lateralM: 0 },
      neutralMean: mu,
      club: kind === 'iron' && i % 2 === 0 ? { kind, loftDeg: 30 } : { kind },
      lineBearingDeg: r.uniform(0, 360),
      conditions: {
        windSpeedMps: r.uniform(0, 10),
        windFromDeg: r.uniform(0, 360),
        tempC: r.uniform(5, 30),
        pressureHpa: r.uniform(990, 1030),
        elevationStartM: 20,
        elevationEndM: 20 + rise,
      },
      lie: r.pick(LIES),
      slope,
      handedness: r.next() < 0.8 ? 'R' : 'L',
      playedAt: T0 + i * 3_600_000,
      source: 'course',
      strike: 'good',
      ...over,
    };
    const neutral = {
      alongM: mu.alongM * (1 + 0.05 * r.normal()),
      lateralM: mu.lateralM + 0.06 * mu.alongM * r.normal(),
    };
    shot.observed = applyConditions(neutral, { ...shot, model });
    return shot;
  });
}

const DEF = DEFAULT_CONDITION_MODEL;
const defaultsFor = (kind: ClubKind): TrueCoefficients => ({
  head: DEF.wind.headPerMps,
  tail: DEF.wind.tailPerMps,
  cross: DEF.wind.crossPerMps[kind],
  elev: DEF.elevation.perMetre[kind],
});

const values = (e: KindConditionEstimate): TrueCoefficients => ({
  head: e.kHead.value,
  tail: e.kTail.value,
  cross: e.kCross.value,
  elev: e.kElev.value,
});

/** |estimate − truth| as a fraction of the default (the scale the clamps use). */
const errVsDefault = (kind: ClubKind, a: TrueCoefficients, b: TrueCoefficients) => {
  const d = defaultsFor(kind);
  return {
    head: Math.abs(a.head - b.head) / d.head,
    tail: Math.abs(a.tail - b.tail) / d.tail,
    cross: Math.abs(a.cross - b.cross) / d.cross,
    elev: Math.abs(a.elev - b.elev) / d.elev,
  };
};

const maxOf = (e: TrueCoefficients) => Math.max(e.head, e.tail, e.cross, e.elev);

const kindArb = fc.constantFrom<ClubKind>('driver', 'wood', 'hybrid', 'iron', 'wedge');
const factorArb = fc.double({ min: 0.5, max: 2, noNaN: true });

describe('fitConditionCoefficients: recovery', () => {
  it('recovers known coefficients, more closely as n grows', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        kindArb,
        factorArb,
        factorArb,
        factorArb,
        factorArb,
        (seed, kind, fh, ft, fc_, fe) => {
          const d = defaultsFor(kind);
          const truth = {
            head: d.head * fh,
            tail: d.tail * ft,
            cross: d.cross * fc_,
            elev: d.elev * fe,
          };
          const model = trueModel(kind, truth);
          const fits = [240, 3840].map((n) => {
            const [est] = fitConditionCoefficients(synthShots(seed, n, kind, model));
            expect(est!.fitted).toBe(true);
            return est!;
          });
          const errs = fits.map((e) => errVsDefault(kind, values(e), truth));
          // Large n: within 15 % of the default's size on every coefficient…
          expect(maxOf(errs[1]!)).toBeLessThan(0.15);
          // …and the uncertainty shrinks with n (≈ 1/√n: 16× the shots, ¼ the SE).
          for (const key of ['kHead', 'kTail', 'kCross', 'kElev'] as const) {
            expect(fits[1]![key].se!).toBeLessThan(0.5 * fits[0]![key].se!);
          }
          // The reported SE is honest: error ≤ 5 SE + the prior's pull (N₀ / (N₀ + n)).
          for (const est of fits) {
            for (const [key, t] of [
              ['kHead', truth.head],
              ['kTail', truth.tail],
              ['kCross', truth.cross],
              ['kElev', truth.elev],
            ] as const) {
              const c = est[key];
              const pull = (60 / (60 + c.n)) * Math.abs(t - c.prior);
              expect(Math.abs(c.value - t)).toBeLessThanOrEqual(5 * c.se! + pull + 1e-12);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('mean error shrinks with n (the ADR 007 table)', () => {
    const kind: ClubKind = 'iron';
    const d = defaultsFor(kind);
    const truth = {
      head: d.head * 1.5,
      tail: d.tail * 0.6,
      cross: d.cross * 1.4,
      elev: d.elev * 0.7,
    };
    const model = trueModel(kind, truth);
    const meanErr = (n: number) => {
      const errs = Array.from({ length: 20 }, (_, s) =>
        errVsDefault(
          kind,
          values(fitConditionCoefficients(synthShots(s + 1, n, kind, model))[0]!),
          truth,
        ),
      );
      return errs.reduce((a, e) => a + maxOf(e), 0) / errs.length;
    };
    const [e60, e240, e960, e3840] = [60, 240, 960, 3840].map(meanErr);
    expect(e240!).toBeLessThan(e60!);
    expect(e960!).toBeLessThan(e240!);
    expect(e3840!).toBeLessThan(e960!);
    expect(e3840!).toBeLessThan(0.05);
  });
});

/** Noise-free shot straight down a north line with `headMps` into the face. */
function headShot(i: number, headMps: number, model: ConditionModelV1 = DEF): LearnShot {
  const shot: LearnShot = {
    observed: { alongM: 0, lateralM: 0 },
    neutralMean: { alongM: 150, lateralM: 0 },
    club: { kind: 'iron' },
    lineBearingDeg: 0,
    conditions: { ...STANDARD_CONDITIONS, windSpeedMps: headMps, windFromDeg: 0 },
    lie: 'fairway',
    slope: FLAT_STANCE,
    handedness: 'R',
    playedAt: T0,
    source: 'course',
    strike: 'good',
  };
  shot.observed = applyConditions(shot.neutralMean, { ...shot, model });
  return { ...shot, playedAt: T0 + i };
}

describe('fitConditionCoefficients: prior and shrinkage', () => {
  const doubled = resolveConditionModel({ wind: { headPerMps: 2 * DEF.wind.headPerMps } });

  it.each([
    [60, 0.5],
    [180, 0.25],
    [540, 0.1],
  ])('%i informing shots: the prior keeps weight %f (N₀ / (N₀ + n))', (n, priorWeight) => {
    const shots = Array.from({ length: n }, (_, i) => headShot(i, 3 + (i % 5), doubled));
    const [est] = fitConditionCoefficients(shots, { now: T0 });
    const k0 = DEF.wind.headPerMps;
    expect(est!.kHead.n).toBeCloseTo(n, 6);
    expect(est!.kHead.value).toBeCloseTo(k0 + (1 - priorWeight) * k0, 6);
    // Nothing informs the others: they stay exactly at the defaults, without an SE.
    for (const c of [est!.kTail, est!.kCross, est!.kElev]) {
      expect(c.value).toBe(c.prior);
      expect(c.se).toBeNull();
      expect(c.n).toBe(0);
    }
  });

  it('calm, level shots carry no signal: exactly the defaults and an empty override', () => {
    const shots = Array.from({ length: 80 }, (_, i) => headShot(i, 0));
    const [est] = fitConditionCoefficients(shots);
    expect(est!.fitted).toBe(true);
    expect(values(est!)).toEqual(defaultsFor('iron'));
    expect(toConditionOverrides([est!])).toEqual({});
  });

  it('data generated by the default model gives back the defaults (within 5 SE)', () => {
    fc.assert(
      fc.property(fc.integer(), kindArb, (seed, kind) => {
        const [est] = fitConditionCoefficients(synthShots(seed, 400, kind, DEF));
        for (const key of ['kHead', 'kTail', 'kCross', 'kElev'] as const) {
          const c = est![key];
          expect(Math.abs(c.value - c.prior)).toBeLessThanOrEqual(5 * c.se!);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('below the minimum the defaults come back untouched', () => {
    const truth = trueModel('iron', { head: 0.04, tail: 0.02, cross: 0.02, elev: 0.5 });
    const [est] = fitConditionCoefficients(synthShots(7, LEARN_MIN_SHOTS - 1, 'iron', truth));
    expect(est).toMatchObject({ kind: 'iron', n: LEARN_MIN_SHOTS - 1, fitted: false });
    expect(values(est!)).toEqual(defaultsFor('iron'));
    expect(est!.kHead.se).toBeNull();
    expect(toConditionOverrides([est!])).toEqual({});
    // A lower threshold fits the same shots.
    expect(
      fitConditionCoefficients(synthShots(7, 59, 'iron', truth), { minShots: 50 })[0]!.fitted,
    ).toBe(true);
  });

  it('priorShots must be positive', () => {
    expect(() => fitConditionCoefficients([], { priorShots: 0 })).toThrow(RangeError);
    expect(fitConditionCoefficients([])).toEqual([]);
  });

  it("ignores opts.model's own wind/elevation coefficients but uses its other terms", () => {
    const shots = synthShots(3, 120, 'wedge', DEF);
    const a = fitConditionCoefficients(shots);
    const b = fitConditionCoefficients(shots, {
      model: resolveConditionModel({
        wind: { headPerMps: 0.2 },
        elevation: { perMetre: { wedge: 3 } },
      }),
    });
    expect(b).toEqual(a);
    const c = fitConditionCoefficients(shots, {
      model: resolveConditionModel({ lie: { rough: { distanceFactor: 0.5 } } }),
    });
    expect(c).not.toEqual(a);
  });

  it('recency weights: an older batch counts for less', () => {
    const shots = synthShots(5, 100, 'hybrid', DEF);
    const [now] = fitConditionCoefficients(shots);
    const [later] = fitConditionCoefficients(shots, {
      now: T0 + 400 * 86_400_000,
      halfLifeDays: 90,
    });
    expect(later!.nEffective).toBeLessThan(now!.nEffective / 10);
    expect(later!.n).toBe(100);
  });
});

describe('fitConditionCoefficients: exclusions and clamps', () => {
  it('skips sim, miss-tagged, penalty, putt, putter, reconstructed and unusable shots', () => {
    const good = synthShots(11, 60, 'iron', DEF);
    const base = good[0]!;
    const bad: LearnShot[] = [
      { ...base, source: 'sim' },
      { ...base, strike: 'thin' },
      { ...base, penalty: 'ob' },
      { ...base, isPutt: true },
      { ...base, lie: 'green' },
      { ...base, club: { kind: 'putter' } },
      { ...base, reconstructed: true, endAccuracyM: 30 },
      { ...base, neutralMean: { alongM: 0, lateralM: 0 } },
      { ...base, neutralMean: { alongM: 150, lateralM: Number.NaN } },
      { ...base, conditions: { ...base.conditions, windSpeedMps: 25 } },
      { ...base, conditions: { ...base.conditions, windSpeedMps: Number.NaN } },
      { ...base, conditions: { ...base.conditions, tempC: Number.NaN } },
      { ...base, observed: { alongM: Number.POSITIVE_INFINITY, lateralM: 0 } },
      { ...base, weight: 0 },
    ];
    const [withBad] = fitConditionCoefficients([...good, ...bad]);
    const [clean] = fitConditionCoefficients(good);
    expect(withBad!.n).toBe(60);
    expect(withBad).toEqual(clean);
    // A reconstructed shot with a good fix still counts.
    const [rec] = fitConditionCoefficients([
      ...good,
      { ...base, reconstructed: true, endAccuracyM: 5 },
    ]);
    expect(rec!.n).toBe(61);
  });

  it('every coefficient stays within [0.3×, 3×] its default, whatever the data', () => {
    const obs = fc.record({
      alongM: fc.double({ min: -500, max: 800, noNaN: true }),
      lateralM: fc.double({ min: -300, max: 300, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.integer(),
        kindArb,
        fc.array(obs, { minLength: 60, maxLength: 120 }),
        (seed, kind, junk) => {
          const shots = synthShots(seed, junk.length, kind, DEF).map((s, i) => ({
            ...s,
            observed: junk[i]!,
          }));
          const [est] = fitConditionCoefficients(shots);
          for (const key of ['kHead', 'kTail', 'kCross', 'kElev'] as const) {
            const c = est![key];
            expect(c.value).toBeGreaterThanOrEqual(c.prior * LEARN_CLAMP.min);
            expect(c.value).toBeLessThanOrEqual(c.prior * LEARN_CLAMP.max);
            expect(c.clamped).toBe(
              c.value === c.prior * LEARN_CLAMP.min || c.value === c.prior * LEARN_CLAMP.max,
            );
          }
          const over = resolveConditionModel(toConditionOverrides([est!]));
          expect(over.wind.headPerMps).toBeGreaterThan(0);
          expect(over.wind.tailPerMps).toBeGreaterThan(0);
          expect(over.wind.crossPerMps[kind]).toBeGreaterThan(0);
          expect(over.elevation.perMetre[kind]).toBeGreaterThan(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('a wild batch is clamped, not sign-flipped', () => {
    // Shots that go further the stronger the headwind: the raw fit wants k_head < 0.
    const shots = Array.from({ length: 200 }, (_, i) => {
      const head = 2 + (i % 7);
      const s = headShot(i, head);
      return { ...s, observed: { alongM: s.observed.alongM + 15 * head, lateralM: 0 } };
    });
    const [est] = fitConditionCoefficients(shots);
    expect(est!.kHead.clamped).toBe(true);
    expect(est!.kHead.value).toBeCloseTo(DEF.wind.headPerMps * LEARN_CLAMP.min, 12);
  });

  it('a constant offset is absorbed by the intercept, not the coefficients', () => {
    const shots = Array.from({ length: 200 }, (_, i) => {
      const s = headShot(i, 2 + (i % 7));
      return {
        ...s,
        observed: { alongM: s.observed.alongM - 6, lateralM: s.observed.lateralM + 3 },
      };
    });
    const [est] = fitConditionCoefficients(shots);
    expect(est!.kHead.value).toBeCloseTo(DEF.wind.headPerMps, 12);
    // A steady wind of one strength cannot be told apart from a baseline bias.
    const steady = Array.from({ length: 80 }, (_, i) => headShot(i, 5));
    expect(fitConditionCoefficients(steady)[0]!.kHead).toMatchObject({ n: 0, se: null });
  });
});

describe('toConditionOverrides', () => {
  const kindFit = (kind: ClubKind, n: number, k: TrueCoefficients) =>
    fitConditionCoefficients(synthShots(n, n, kind, trueModel(kind, k)))[0]!;

  it('writes per-kind k_cross / k_elev and n-weighted single k_head / k_tail', () => {
    const iron = kindFit('iron', 400, { head: 0.03, tail: 0.008, cross: 0.016, elev: 0.8 });
    const driver = kindFit('driver', 200, { head: 0.025, tail: 0.012, cross: 0.01, elev: 0.6 });
    const few = kindFit('wedge', 20, { head: 0.05, tail: 0.02, cross: 0.03, elev: 2 });
    const out = toConditionOverrides([iron, driver, few]);
    const pooled = (a: KindConditionEstimate['kHead'], b: KindConditionEstimate['kHead']) =>
      (a.n * a.value + b.n * b.value) / (a.n + b.n);
    expect(out.wind!.headPerMps).toBeCloseTo(pooled(iron.kHead, driver.kHead), 5);
    expect(out.wind!.tailPerMps).toBeCloseTo(pooled(iron.kTail, driver.kTail), 5);
    expect(out.wind!.crossPerMps).toEqual({
      iron: Number(iron.kCross.value.toPrecision(4)),
      driver: Number(driver.kCross.value.toPrecision(4)),
    });
    expect(Object.keys(out.elevation!.perMetre!)).toEqual(['iron', 'driver']);
    expect('version' in out).toBe(false);
    // Round-trips through resolveConditionModel; untouched kinds keep their defaults.
    const m = resolveConditionModel(out);
    expect(m.wind.crossPerMps.iron).toBe(out.wind!.crossPerMps!.iron);
    expect(m.wind.crossPerMps.wedge).toBe(DEF.wind.crossPerMps.wedge);
    expect(m.elevation.perMetre.driver).toBe(out.elevation!.perMetre!.driver);
  });

  it('leaves out coefficients no shot informs', () => {
    const shots = Array.from({ length: 70 }, (_, i) => headShot(i, 3 + (i % 5)));
    const out = toConditionOverrides(fitConditionCoefficients(shots));
    expect(out).toEqual({ wind: { headPerMps: DEF.wind.headPerMps } });
  });

  it('returns kinds in a stable order', () => {
    const shots = [
      ...synthShots(1, 10, 'wedge', DEF),
      ...synthShots(2, 10, 'driver', DEF),
      ...synthShots(3, 10, 'hybrid', DEF),
    ];
    expect(fitConditionCoefficients(shots).map((e) => e.kind)).toEqual([
      'driver',
      'hybrid',
      'wedge',
    ]);
  });
});
