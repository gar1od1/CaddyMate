import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mphToMps } from '../units/index.js';
import {
  FLAT_STANCE,
  STANDARD_CONDITIONS,
  type ClubKind,
  type Conditions,
  type Lie,
  type SlopeStrength,
} from '../types/index.js';
import {
  CONDITION_MODEL_VERSION,
  DEFAULT_CONDITION_MODEL,
  airDensityRatio,
  applyConditions,
  conditionBucketKey,
  normaliseShot,
  playsLikeDistance,
  predictEffects,
  resolveConditionModel,
  windComponents,
  type ConditionContext,
  type ConditionModelOverrides,
  type PredictEffectsInput,
} from './index.js';

const MPH10 = mphToMps(10);

const base = (over: Partial<PredictEffectsInput> = {}): PredictEffectsInput => ({
  club: { kind: 'iron' },
  nominalDistanceM: 150,
  lineBearingDeg: 0,
  conditions: STANDARD_CONDITIONS,
  lie: 'fairway',
  slope: FLAT_STANCE,
  handedness: 'R',
  ...over,
});

const withWind = (speed: number, fromDeg: number): Conditions => ({
  ...STANDARD_CONDITIONS,
  windSpeedMps: speed,
  windFromDeg: fromDeg,
});

describe('windComponents', () => {
  it.each([
    // [from, line, head sign, cross sign] for a 10 m/s wind
    ['into the face', 0, 0, 10, 0],
    ['from behind', 180, 0, -10, 0],
    ['from the left', 270, 0, 0, 10],
    ['from the right', 90, 0, 0, -10],
    ['from the left, line east', 0, 90, 0, 10],
    ['from the right, line east', 180, 90, 0, -10],
    ['quartering into and from the left', 315, 0, 7.0711, 7.0711],
    ['quartering behind and from the right', 135, 0, -7.0711, -7.0711],
  ])('%s', (_label, from, line, head, cross) => {
    const w = windComponents(10, from, line);
    expect(w.headMps).toBeCloseTo(head, 3);
    expect(w.crossMps).toBeCloseTo(cross, 3);
  });

  it('preserves magnitude', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        (s, from, line) => {
          const { headMps, crossMps } = windComponents(s, from, line);
          expect(Math.hypot(headMps, crossMps)).toBeCloseTo(s, 9);
        },
      ),
    );
  });
});

describe('airDensityRatio', () => {
  it('is 1 at the reference atmosphere', () => {
    expect(airDensityRatio(20, 1013.25)).toBe(1);
  });
  it('follows the ideal gas law', () => {
    expect(airDensityRatio(30, 1013.25)).toBeCloseTo(293.15 / 303.15, 12);
    expect(airDensityRatio(20, 983)).toBeCloseTo(983 / 1013.25, 12);
    expect(airDensityRatio(5, 1030)).toBeGreaterThan(1);
  });
});

describe('predictEffects — hand-checked numbers', () => {
  it('10 mph headwind on a 150 m 7-iron ≈ −14 m', () => {
    const e = predictEffects(base({ conditions: withWind(MPH10, 0) }));
    expect(e.deltaAlongM).toBeCloseTo(-150 * 0.021 * 4.4704, 9);
    expect(e.deltaAlongM).toBeCloseTo(-14.08, 2);
    expect(e.breakdown.wind.alongM).toBeCloseTo(e.deltaAlongM, 12);
    expect(e.deltaLateralM).toBeCloseTo(0, 12);
  });

  it('10 mph tailwind helps less (+7.4 m)', () => {
    const e = predictEffects(base({ conditions: withWind(MPH10, 180) }));
    expect(e.deltaAlongM).toBeCloseTo(7.376, 3);
  });

  it('10 mph wind from the left drifts a 7-iron ≈ 8 m right; a wedge more per metre', () => {
    const iron = predictEffects(base({ conditions: withWind(MPH10, 270) }));
    expect(iron.deltaLateralM).toBeCloseTo(0.012 * 4.4704 * 150, 9);
    expect(iron.breakdown.wind.lateralM).toBe(iron.deltaLateralM);
    const wedge = predictEffects(
      base({ club: { kind: 'wedge' }, nominalDistanceM: 100, conditions: withWind(MPH10, 270) }),
    );
    const driver = predictEffects(
      base({ club: { kind: 'driver' }, nominalDistanceM: 230, conditions: withWind(MPH10, 270) }),
    );
    expect(wedge.deltaLateralM / 100).toBeGreaterThan(iron.deltaLateralM / 150);
    expect(driver.deltaLateralM / 230).toBeLessThan(iron.deltaLateralM / 150);
  });

  it('putters get no crosswind drift', () => {
    const e = predictEffects(
      base({ club: { kind: 'putter' }, nominalDistanceM: 10, conditions: withWind(10, 270) }),
    );
    expect(e.deltaLateralM).toBe(0);
  });

  it('uses the loft curve when loft is known', () => {
    const at = (loftDeg: number): number =>
      predictEffects(base({ club: { kind: 'iron', loftDeg }, conditions: withWind(10, 270) }))
        .deltaLateralM / 18;
    // 18 = 0.012 · 10 · 150, so `at` returns the hang factor.
    expect(at(33)).toBeCloseTo(1.0, 12);
    expect(at(27)).toBeCloseTo(0.925, 12);
    expect(at(5)).toBeCloseTo(0.6, 12);
    expect(at(70)).toBeCloseTo(1.35, 12);
    expect(at(Number.NaN)).toBeCloseTo(1.0, 12);
    const noTable = resolveConditionModel({ wind: { hangByLoft: [] } });
    expect(
      predictEffects(
        base({
          club: { kind: 'wedge', loftDeg: 56 },
          conditions: withWind(10, 270),
          model: noTable,
        }),
      ).deltaLateralM / 18,
    ).toBeCloseTo(1.25, 12);
  });

  it('10 m uphill costs an iron 9 m, a driver 7 m, a wedge 10 m', () => {
    const up: Conditions = { ...STANDARD_CONDITIONS, elevationEndM: 10 };
    const kinds: [ClubKind, number][] = [
      ['iron', -9],
      ['driver', -7],
      ['wood', -7],
      ['hybrid', -8],
      ['wedge', -10],
    ];
    for (const [kind, delta] of kinds) {
      const e = predictEffects(base({ club: { kind }, conditions: up }));
      expect(e.deltaAlongM).toBeCloseTo(delta, 12);
      expect(e.breakdown.elevation.alongM).toBeCloseTo(delta, 12);
    }
  });

  it('warm air flies further; 3 % thinner air ≈ +1.65 %', () => {
    const e = predictEffects(base({ conditions: { ...STANDARD_CONDITIONS, tempC: 30 } }));
    expect(e.deltaAlongM).toBeCloseTo(150 * 0.55 * (1 - 293.15 / 303.15), 9);
    expect(e.breakdown.density.alongM).toBeCloseTo(e.deltaAlongM, 12);
    const thin = predictEffects(
      base({ conditions: { ...STANDARD_CONDITIONS, pressureHpa: 1013.25 * 0.97 } }),
    );
    expect(thin.deltaAlongM / 150).toBeCloseTo(0.0165, 9);
  });

  it('applies the §7.4 lie table', () => {
    const e = predictEffects(base({ lie: 'rough' }));
    expect(e.deltaAlongM).toBeCloseTo(-10.5, 9);
    expect(e.breakdown.lie.alongM).toBeCloseTo(-10.5, 9);
    expect(e.extraSigmaAlongM).toBe(6);
    expect(e.extraSigmaLateralM).toBe(3);
    expect(e.flyerProbability).toBe(0.15);
    const fw = predictEffects(base());
    expect(fw.deltaAlongM).toBe(0);
    expect(fw.extraSigmaAlongM).toBe(0);
    expect(fw.playsLikeDistanceM).toBe(150);
  });

  it.each<[string, 'R' | 'L', number]>([
    ['right-hander pulls left', 'R', -1.5],
    ['left-hander pulls right', 'L', 1.5],
  ])('severe uphill: %s', (_label, handedness, lateral) => {
    const e = predictEffects(base({ handedness, slope: { ...FLAT_STANCE, uphill: 'severe' } }));
    expect(e.deltaAlongM).toBeCloseTo(-10.5, 9);
    expect(e.deltaLateralM).toBeCloseTo(lateral, 12);
    expect(e.breakdown.slope.lateralM).toBeCloseTo(lateral, 12);
  });

  it.each<[SlopeStrength, 'R' | 'L', number, number]>([
    ['mild', 'R', -6, 6],
    ['severe', 'R', -13.5, 13.5],
    ['mild', 'L', 6, -6],
    ['severe', 'L', 13.5, -13.5],
  ])('ball above/below feet %s (%s)', (strength, handedness, above, below) => {
    const a = predictEffects(
      base({ handedness, slope: { ...FLAT_STANCE, ballAboveFeet: strength } }),
    );
    const b = predictEffects(
      base({ handedness, slope: { ...FLAT_STANCE, ballBelowFeet: strength } }),
    );
    expect(a.deltaLateralM).toBeCloseTo(above, 12);
    expect(b.deltaLateralM).toBeCloseTo(below, 12);
  });

  it('combines slope toggles additively', () => {
    const e = predictEffects(
      base({
        slope: { uphill: 'mild', downhill: 'none', ballAboveFeet: 'mild', ballBelowFeet: 'none' },
      }),
    );
    expect(e.deltaAlongM).toBeCloseTo(-6, 9);
    expect(e.deltaLateralM).toBeCloseTo(-6, 12);
    const down = predictEffects(base({ slope: { ...FLAT_STANCE, downhill: 'severe' } }));
    expect(down.deltaAlongM).toBeCloseTo(6, 9);
    expect(down.deltaLateralM).toBeCloseTo(3, 12);
  });

  it('breakdown sums to the totals under mixed conditions', () => {
    const e = predictEffects(
      base({
        lie: 'first_cut',
        slope: { ...FLAT_STANCE, downhill: 'mild', ballBelowFeet: 'severe' },
        conditions: {
          windSpeedMps: 6,
          windFromDeg: 200,
          tempC: 8,
          pressureHpa: 1002,
          elevationStartM: 40,
          elevationEndM: 35,
        },
        lineBearingDeg: 30,
      }),
    );
    const b = e.breakdown;
    const along =
      b.wind.alongM + b.elevation.alongM + b.density.alongM + b.lie.alongM + b.slope.alongM;
    const lateral =
      b.wind.lateralM +
      b.elevation.lateralM +
      b.density.lateralM +
      b.lie.lateralM +
      b.slope.lateralM;
    expect(along).toBeCloseTo(e.deltaAlongM, 9);
    expect(lateral).toBeCloseTo(e.deltaLateralM, 9);
  });

  it('clamps an absurd headwind instead of reversing the ball', () => {
    const e = predictEffects(base({ conditions: withWind(100, 0) }));
    expect(e.deltaAlongM).toBeCloseTo(150 * 0.05 - 150, 9);
    expect(Number.isFinite(e.playsLikeDistanceM)).toBe(true);
  });
});

describe('playsLikeDistance', () => {
  it('adds elevation and wind, ignores lie and slope', () => {
    const up: Conditions = { ...STANDARD_CONDITIONS, elevationEndM: 10 };
    expect(playsLikeDistance(150, base({ conditions: up }))).toBeCloseTo(159, 12);
    expect(playsLikeDistance(150, base({ conditions: withWind(MPH10, 0) }))).toBeCloseTo(
      150 / (1 - 0.021 * 4.4704),
      9,
    );
    expect(
      playsLikeDistance(
        150,
        base({ lie: 'deep_rough', slope: { ...FLAT_STANCE, uphill: 'severe' } }),
      ),
    ).toBe(150);
  });

  it('a neutral shot of the plays-like length reaches the target (no lie/slope)', () => {
    const ctx = base({
      conditions: { ...withWind(5, 20), tempC: 12, pressureHpa: 995, elevationEndM: -6 },
    });
    const pl = playsLikeDistance(170, ctx);
    expect(applyConditions({ alongM: pl, lateralM: 0 }, ctx).alongM).toBeCloseTo(170, 9);
  });
});

describe('resolveConditionModel', () => {
  it('returns the defaults with no overrides', () => {
    expect(resolveConditionModel()).toEqual(DEFAULT_CONDITION_MODEL);
    expect(resolveConditionModel(null)).toEqual(DEFAULT_CONDITION_MODEL);
    expect(DEFAULT_CONDITION_MODEL.version).toBe(CONDITION_MODEL_VERSION);
  });

  it('merges deep partials without mutating the defaults', () => {
    const m = resolveConditionModel({
      wind: { headPerMps: 0.03, crossPerMps: { iron: 0.02 } },
      lie: { rough: { distanceFactor: 0.9 } },
    });
    expect(m.wind.headPerMps).toBe(0.03);
    expect(m.wind.tailPerMps).toBe(0.011);
    expect(m.wind.crossPerMps.iron).toBe(0.02);
    expect(m.wind.crossPerMps.driver).toBe(0.012);
    expect(m.lie.rough).toEqual({ ...DEFAULT_CONDITION_MODEL.lie.rough, distanceFactor: 0.9 });
    expect(DEFAULT_CONDITION_MODEL.wind.headPerMps).toBe(0.021);
    const e = predictEffects(base({ conditions: withWind(10, 0), model: m }));
    expect(e.deltaAlongM).toBeCloseTo(-45, 9);
  });

  it('ignores junk from untrusted JSON', () => {
    const junk = {
      version: 99,
      unknownKey: 1,
      wind: { headPerMps: 'fast', tailPerMps: Number.NaN, hangByLoft: { a: 1 } },
      elevation: 3,
      density: { k: Infinity },
    } as unknown as ConditionModelOverrides;
    expect(resolveConditionModel(junk)).toEqual(DEFAULT_CONDITION_MODEL);
  });

  it('replaces arrays wholesale', () => {
    const m = resolveConditionModel({ wind: { hangByLoft: [[10, 1]] } });
    expect(m.wind.hangByLoft).toEqual([[10, 1]]);
  });
});

describe('conditionBucketKey', () => {
  it('matches the example format', () => {
    expect(conditionBucketKey('fairway', 2, -3)).toBe('fairway|h:+1..4|c:-4..-1');
  });

  it.each([
    [-Infinity, '..-4'],
    [-4, '..-4'],
    [-3.999, '-4..-1'],
    [-1, '-4..-1'],
    [-0.999, '-1..1'],
    [0, '-1..1'],
    [1, '-1..1'],
    [1.0001, '+1..4'],
    [4, '+1..4'],
    [4.0001, '+4..'],
    [Infinity, '+4..'],
    [Number.NaN, '-1..1'],
  ])('bins %d m/s as %s (right-closed edges)', (v, label) => {
    expect(conditionBucketKey('rough', v, 0)).toBe(`rough|h:${label}|c:-1..1`);
    expect(conditionBucketKey('rough', 0, v)).toBe(`rough|h:-1..1|c:${label}`);
  });

  it('is total and deterministic', () => {
    const lies: Lie[] = Object.keys(DEFAULT_CONDITION_MODEL.lie) as Lie[];
    fc.assert(
      fc.property(fc.constantFrom(...lies), fc.double(), fc.double(), (lie, h, c) => {
        const k = conditionBucketKey(lie, h, c);
        expect(k).toBe(conditionBucketKey(lie, h, c));
        expect(k).toMatch(
          /^[a-z_]+\|h:(\.\.-4|-4\.\.-1|-1\.\.1|\+1\.\.4|\+4\.\.)\|c:(\.\.-4|-4\.\.-1|-1\.\.1|\+1\.\.4|\+4\.\.)$/,
        );
      }),
    );
  });
});

describe('properties', () => {
  const lies = Object.keys(DEFAULT_CONDITION_MODEL.lie) as Lie[];
  const strength = fc.constantFrom<SlopeStrength>('none', 'mild', 'severe');
  const context: fc.Arbitrary<ConditionContext> = fc.record({
    club: fc.record(
      {
        kind: fc.constantFrom<ClubKind>('driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'),
        loftDeg: fc.double({ min: 0, max: 64, noNaN: true }),
      },
      { requiredKeys: ['kind'] },
    ),
    lineBearingDeg: fc.double({ min: 0, max: 360, noNaN: true }),
    conditions: fc.record({
      windSpeedMps: fc.double({ min: 0, max: 60, noNaN: true }),
      windFromDeg: fc.double({ min: 0, max: 360, noNaN: true }),
      tempC: fc.double({ min: -10, max: 45, noNaN: true }),
      pressureHpa: fc.double({ min: 850, max: 1060, noNaN: true }),
      elevationStartM: fc.double({ min: -50, max: 500, noNaN: true }),
      elevationEndM: fc.double({ min: -50, max: 500, noNaN: true }),
    }),
    lie: fc.constantFrom(...lies),
    slope: fc.record({
      uphill: strength,
      downhill: strength,
      ballAboveFeet: strength,
      ballBelowFeet: strength,
    }),
    handedness: fc.constantFrom<'R' | 'L'>('R', 'L'),
  });
  const frame = fc.record({
    alongM: fc.double({ min: -50, max: 350, noNaN: true }),
    lateralM: fc.double({ min: -80, max: 80, noNaN: true }),
  });

  it('normaliseShot ∘ applyConditions = identity', () => {
    fc.assert(
      fc.property(context, frame, (ctx, neutral) => {
        const back = normaliseShot(applyConditions(neutral, ctx), ctx);
        expect(Math.abs(back.alongM - neutral.alongM)).toBeLessThan(1e-9);
        expect(Math.abs(back.lateralM - neutral.lateralM)).toBeLessThan(1e-9);
      }),
    );
  });

  it('applyConditions ∘ normaliseShot = identity', () => {
    fc.assert(
      fc.property(context, frame, (ctx, observed) => {
        const back = applyConditions(normaliseShot(observed, ctx), ctx);
        expect(Math.abs(back.alongM - observed.alongM)).toBeLessThan(1e-9);
        expect(Math.abs(back.lateralM - observed.lateralM)).toBeLessThan(1e-9);
      }),
    );
  });

  it('predictEffects agrees with applyConditions on a straight shot', () => {
    fc.assert(
      fc.property(context, fc.double({ min: 0, max: 350, noNaN: true }), (ctx, d) => {
        const e = predictEffects({ ...ctx, nominalDistanceM: d });
        const c = applyConditions({ alongM: d, lateralM: 0 }, ctx);
        expect(e.deltaAlongM).toBeCloseTo(c.alongM - d, 9);
        expect(e.deltaLateralM).toBeCloseTo(c.lateralM, 9);
      }),
    );
  });

  it('more headwind → shorter', () => {
    fc.assert(
      fc.property(
        context,
        fc.double({ min: 1, max: 350, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: 0.01, max: 20, noNaN: true }),
        (ctx, d, w, extra) => {
          // Wind straight down the line; `w` > 0 is headwind.
          const at = (head: number): number =>
            predictEffects({
              ...ctx,
              nominalDistanceM: d,
              conditions: {
                ...ctx.conditions,
                windSpeedMps: Math.abs(head),
                windFromDeg: head >= 0 ? ctx.lineBearingDeg : ctx.lineBearingDeg + 180,
              },
            }).deltaAlongM;
          expect(at(w + extra)).toBeLessThan(at(w) + 1e-9);
        },
      ),
    );
  });
});
