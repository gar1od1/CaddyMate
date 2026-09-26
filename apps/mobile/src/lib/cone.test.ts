import {
  STANDARD_CONDITIONS,
  FLAT_STANCE,
  fitPattern,
  resolveConditionModel,
  haversineDistanceM,
  priorFor,
  type ClubPattern,
  type ConditionContext,
} from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { at, circle, PIN, TEE } from '@/test/fixtures';
import {
  buildDispersionOverlay,
  conditionMap,
  conditionPattern,
  currentBucketKey,
  overlayLabel,
  type OverlayInput,
} from './cone';

const seeded7i: ClubPattern = fitPattern([], {
  prior: priorFor({ kind: 'iron', stockTotalM: 146 }),
});

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  club: { kind: 'iron', loftDeg: 30.5 },
  lineBearingDeg: 0,
  conditions: STANDARD_CONDITIONS,
  lie: 'fairway',
  slope: FLAT_STANCE,
  handedness: 'R',
  ...over,
});

describe('conditionPattern', () => {
  it('is the identity in standard conditions from the fairway', () => {
    const c = conditionPattern(seeded7i, ctx());
    expect(c.distance.mean).toBeCloseTo(146, 9);
    expect(c.distance.sd).toBeCloseTo(seeded7i.distance.sd, 9);
    expect(c.lateral).toEqual(seeded7i.lateral);
  });

  it('shortens into a headwind, drifts with a crosswind, widens from the rough', () => {
    const into = conditionPattern(
      seeded7i,
      ctx({ conditions: { ...STANDARD_CONDITIONS, windSpeedMps: 5, windFromDeg: 0 } }),
    );
    expect(into.distance.mean).toBeLessThan(140);
    // Wind from the west while playing north pushes the ball right.
    const cross = conditionPattern(
      seeded7i,
      ctx({ conditions: { ...STANDARD_CONDITIONS, windSpeedMps: 5, windFromDeg: 270 } }),
    );
    expect(cross.lateral.mean).toBeGreaterThan(5);
    const rough = conditionPattern(seeded7i, ctx({ lie: 'rough' }));
    expect(rough.distance.mean).toBeCloseTo(146 * 0.93, 6);
    expect(rough.lateral.sd_left).toBeGreaterThan(seeded7i.lateral.sd_left);
    expect(rough.distance.sd).toBeGreaterThan(seeded7i.distance.sd * 0.93);
  });

  it('recovers the affine map exactly', () => {
    const m = conditionMap(ctx({ lie: 'rough' }), 146);
    expect(m.F).toBeCloseTo(0.93, 9);
    expect(m.E).toBeCloseTo(0, 9);
    expect(m.sigmaLateralM).toBe(3);
  });
});

const input = (over: Partial<OverlayInput> = {}): OverlayInput => ({
  origin: TEE,
  aim: at(146),
  club: { kind: 'iron', loftDeg: 30.5 },
  pattern: seeded7i,
  empirical: null,
  conditions: STANDARD_CONDITIONS,
  lie: 'fairway',
  slope: FLAT_STANCE,
  handedness: 'R',
  green: circle(PIN, 14),
  greenFrontM: haversineDistanceM(TEE, PIN) - 14,
  ...over,
});

describe('buildDispersionOverlay', () => {
  it('conditions the pattern with the player condition model (decision 007)', () => {
    const into = { ...STANDARD_CONDITIONS, windSpeedMps: 6, windFromDeg: 0 };
    const dflt = buildDispersionOverlay(input({ conditions: into }))!;
    const learned = resolveConditionModel({ wind: { headPerMps: 0.042 } });
    const o = buildDispersionOverlay(input({ conditions: into, model: learned }))!;
    expect(o.meanAlongM).toBeCloseTo(seeded7i.distance.mean * (1 - 0.042 * 6), 6);
    expect(o.meanAlongM).toBeLessThan(dflt.meanAlongM);
    expect(
      conditionPattern(seeded7i, ctx({ conditions: into, model: learned })).distance.mean,
    ).toBeCloseTo(o.meanAlongM, 9);
  });

  it('draws a cone from the ball, dashed and labelled while seeded', () => {
    const o = buildDispersionOverlay(input())!;
    expect(o.mode).toBe('cone');
    expect(o.rings.map((r) => r.kind)).toEqual(['cone', 'core']);
    expect(o.dashed).toBe(true);
    expect(o.label).toBe('seeded · 0 shots · estimated');
    expect(haversineDistanceM(TEE, o.centre)).toBeCloseTo(146, 0);
    // Closed rings, [lng, lat].
    const ring = o.rings[0]!.ring;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Math.abs(ring[0]![1] - TEE.lat)).toBeLessThan(0.01);
  });

  it('switches to 1σ / 80 % / 95 % ellipses when the club reaches the green', () => {
    const o = buildDispersionOverlay(
      input({ origin: at(230), aim: PIN, greenFrontM: haversineDistanceM(at(230), PIN) - 14 }),
    )!;
    expect(o.mode).toBe('ellipse');
    expect(o.rings.map((r) => r.kind)).toEqual(['e95', 'e80', 'e1']);
    // Aim on the green also switches, even when the mean is short.
    const short = buildDispersionOverlay(input({ origin: at(100), aim: PIN, greenFrontM: 400 }))!;
    expect(short.mode).toBe('ellipse');
  });

  it('draws the empirical bucket pattern when it has ≥ 15 shots', () => {
    const established: ClubPattern = { ...seeded7i, confidence: 'established', n_raw: 44 };
    const empirical = {
      params: { ...seeded7i, distance: { ...seeded7i.distance, mean: 120 } },
      nEffective: 23.4,
    };
    const o = buildDispersionOverlay(input({ pattern: established, empirical }))!;
    expect(o.empirical).toBe(true);
    expect(o.meanAlongM).toBe(120);
    expect(o.dashed).toBe(false);
    expect(o.label).toBe('established · 44 shots · from 23 similar shots');
    const thin = buildDispersionOverlay(input({ empirical: { ...empirical, nEffective: 9 } }))!;
    expect(thin.empirical).toBe(false);
    expect(thin.meanAlongM).toBeCloseTo(146, 6);
  });

  it('draws nothing for a putter', () => {
    expect(buildDispersionOverlay(input({ club: { kind: 'putter' } }))).toBeNull();
  });

  it('labels and buckets', () => {
    expect(overlayLabel('forming', 1, null)).toBe('forming · 1 shot · estimated');
    expect(
      currentBucketKey('rough', { ...STANDARD_CONDITIONS, windSpeedMps: 3, windFromDeg: 0 }, 0),
    ).toBe('rough|h:+1..4|c:-1..1');
  });
});
