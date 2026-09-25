import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyConditions,
  DEFAULT_CONDITION_MODEL,
  resolveConditionModel,
} from '../conditions/index.js';
import type { ClubPattern } from '../dispersion/index.js';
import {
  fromClubFrame,
  fromLocalXY,
  haversineDistanceM,
  initialBearingDeg,
  toClubFrame,
  toLocalXY,
  type LatLng,
  type Polygon,
} from '../geo/index.js';
import { expectedStrokes } from '../scoring/index.js';
import { FLAT_STANCE, STANDARD_CONDITIONS, type Conditions } from '../types/index.js';
import {
  classifyLanding,
  conditionedMean,
  DEFAULT_LANDING,
  DEFAULT_TREE_RADIUS_M,
  drawSamples,
  evaluateChoice,
  evaluateOption,
  expectedAfterLanding,
  explainOption,
  hashInputs,
  landingCategory,
  pointAlongLine,
  prepareHole,
  recommend,
  STRATEGY_ENGINE_VERSION,
  toRecommendationSnapshot,
  type EvaluateOptionInput,
  type HoleFeature,
  type HoleGeometry,
  type LandingClass,
  type RecommendInput,
  type StrategyClub,
  type StrategyOption,
} from './index.js';

// ---------------------------------------------------------------- fixtures

const ORIGIN: LatLng = { lat: 53.45, lng: -6.75 };
/** Local metres (x east, y north) from the tee → lat/lng. */
const ll = (x: number, y: number): LatLng => fromLocalXY(ORIGIN, { x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)],
});
const circle = (cx: number, cy: number, r: number, n = 24): Polygon => ({
  outer: Array.from({ length: n }, (_, i) =>
    ll(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)),
  ),
});

function pat(mean: number, sdD: number, sdL: number, pMiss = 0.04, bias = 0): ClubPattern {
  const z = 1.2815515655446004;
  return {
    distance: { mean, sd: sdD, q10: mean - z * sdD, q50: mean, q90: mean + z * sdD },
    lateral: {
      mean: bias,
      sd_left: sdL,
      sd_right: sdL,
      q10: bias - z * sdL,
      q50: bias,
      q90: bias + z * sdL,
    },
    rho: 0,
    n_effective: 30,
    n_raw: 30,
    n_sim: 10,
    n_course: 20,
    miss: {
      p_miss: pMiss,
      distance: { mean: mean * 0.7, sd: mean * 0.1 },
      lateral: { mean: 0, sd: sdL * 2 },
    },
    confidence: 'established',
  };
}

const club = (id: string, kind: StrategyClub['kind'], p: ClubPattern, loftDeg?: number) => {
  const c: StrategyClub = { id, label: id, kind, pattern: p };
  if (loftDeg !== undefined) c.loftDeg = loftDeg;
  return c;
};

const DRIVER = club('Driver', 'driver', pat(230, 14, 22), 10.5);
const HYBRID = club('4h', 'hybrid', pat(190, 10, 12), 22);
const I5 = club('5i', 'iron', pat(170, 8, 10), 27);
const I6 = club('6i', 'iron', pat(160, 7, 9), 30);
const I7 = club('7i', 'iron', pat(150, 7, 8.5), 34);
const I8 = club('8i', 'iron', pat(140, 6, 8), 38);
const I9 = club('9i', 'iron', pat(130, 6, 7.5), 42);
const PUTTER: StrategyClub = { id: 'P', kind: 'putter', pattern: pat(5, 1, 0.3) };
const BAG = [DRIVER, HYBRID, I5, I6, I7, I8, I9, PUTTER];

const GREEN = circle(0, 380, 14);
const PIN = ll(0, 380);

/** Synthetic par 4, 380 m, due north. */
function par4(overrides: Partial<HoleGeometry> = {}, fairwayHalfWidth = 15): HoleGeometry {
  const features: HoleFeature[] = [
    {
      kind: 'fairway',
      penalty: 'none',
      polygon: rect(-fairwayHalfWidth, 180, fairwayHalfWidth, 345),
    },
    { kind: 'bunker', penalty: 'none', polygon: rect(-26, 368, -15, 388) },
    { kind: 'bunker', penalty: 'none', polygon: rect(15, 235, 26, 255) },
    { kind: 'water', penalty: 'lateral', polygon: rect(17, 350, 60, 410) },
    { kind: 'ob', penalty: 'ob', polygon: rect(-90, -10, -70, 450) },
  ];
  return {
    green: GREEN,
    greenCentre: ll(0, 380),
    pin: PIN,
    features,
    lineOfPlay: [ll(0, 0), ll(0, 240), ll(0, 380)],
    ...overrides,
  };
}

const HOLE = prepareHole(par4());
const APPROACH_START = ll(0, 230);

function ctx(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return {
    start: APPROACH_START,
    startLie: 'fairway',
    pin: PIN,
    conditions: STANDARD_CONDITIONS,
    slope: FLAT_STANCE,
    handedness: 'R',
    hole: HOLE,
    baseline: 'hcp15',
    clubs: BAG,
    ...overrides,
  };
}

function evalCtx(overrides: Partial<EvaluateOptionInput> = {}): EvaluateOptionInput {
  return {
    start: APPROACH_START,
    startLie: 'fairway',
    pin: PIN,
    conditions: STANDARD_CONDITIONS,
    slope: FLAT_STANCE,
    handedness: 'R',
    hole: HOLE,
    baseline: 'hcp15',
    club: I7,
    aim: PIN,
    seed: 7,
    ...overrides,
  };
}

const at = (x: number, y: number) => classifyLanding(HOLE, ll(x, y));

// ---------------------------------------------------------------- geometry

describe('classifyLanding', () => {
  it('classifies the synthetic hole', () => {
    expect(at(0, 380)).toMatchObject({ lie: 'green', penalty: 'none', hazard: null });
    expect(at(0, 250)).toMatchObject({ lie: 'fairway', penalty: 'none' });
    expect(at(-20, 375)).toMatchObject({ lie: 'sand', hazard: 'bunker' });
    expect(at(30, 380)).toMatchObject({ lie: 'rough', penalty: 'lateral', hazard: 'water' });
    expect(at(-80, 200)).toMatchObject({ penalty: 'ob', hazard: null });
    expect(at(40, 100)).toBe(DEFAULT_LANDING);
    expect(DEFAULT_LANDING).toMatchObject({ lie: 'rough', penalty: 'none', recovery: false });
    expect(at(0, 250).feature?.kind).toBe('fairway');
  });

  it('applies precedence OB > penalty > bunker > green > trees > deep rough > rough > first cut > fairway > bare', () => {
    const p = ll(0, 0);
    const sq = rect(-5, -5, 5, 5);
    const layers: [HoleFeature, Partial<LandingClass>][] = [
      [{ kind: 'ob', penalty: 'ob', polygon: sq }, { penalty: 'ob' }],
      [
        { kind: 'water', penalty: 'none', polygon: sq },
        { penalty: 'yellow', hazard: 'water' },
      ],
      [
        { kind: 'bunker', penalty: 'none', polygon: sq },
        { lie: 'sand', hazard: 'bunker' },
      ],
      [{ kind: 'cart_path', penalty: 'none', polygon: sq }, { lie: 'green' }],
      [
        { kind: 'tree', penalty: 'none', point: p },
        { lie: 'rough', recovery: true, hazard: 'tree' },
      ],
      [{ kind: 'deep_rough', penalty: 'none', polygon: sq }, { lie: 'deep_rough' }],
      [
        { kind: 'rough', penalty: 'none', polygon: sq },
        { lie: 'rough', hazard: null },
      ],
      [{ kind: 'first_cut', penalty: 'none', polygon: sq }, { lie: 'first_cut' }],
      [{ kind: 'fairway', penalty: 'none', polygon: sq }, { lie: 'fairway' }],
      [{ kind: 'pine_straw', penalty: 'none', polygon: sq }, { lie: 'pine_straw' }],
    ];
    // Features are listed in reverse so ordering comes from precedence, not input order.
    for (let i = 0; i < layers.length; i++) {
      const features = layers
        .slice(i)
        .map(([f]) => f)
        .reverse();
      const green = i <= 3 ? sq : rect(50, 50, 60, 60);
      const hole = prepareHole({ green, greenCentre: p, pin: p, features });
      expect(classifyLanding(hole, p)).toMatchObject(layers[i]![1]);
    }
  });

  it('handles penalty flags on any kind, trees, holes and shapeless features', () => {
    const p = ll(0, 0);
    const far = rect(50, 50, 60, 60);
    const hole = prepareHole({
      green: far,
      greenCentre: p,
      pin: p,
      features: [
        { kind: 'fairway', penalty: 'ob', polygon: rect(100, 100, 110, 110) },
        { kind: 'rough', penalty: 'lateral', polygon: rect(200, 200, 210, 210) },
        { kind: 'tree', penalty: 'none', point: ll(300, 300) },
        { kind: 'wooded', penalty: 'none', point: ll(400, 400), radiusM: 10 },
        { kind: 'hardpan', penalty: 'none', polygon: rect(500, 500, 510, 510) },
        {
          kind: 'fairway',
          penalty: 'none',
          polygon: {
            outer: rect(600, 600, 640, 640).outer,
            holes: [rect(610, 610, 620, 620).outer],
          },
        },
        { kind: 'bunker', penalty: 'none' },
      ],
    });
    const c = (x: number, y: number) => classifyLanding(hole, ll(x, y));
    expect(c(105, 105).penalty).toBe('ob');
    expect(c(205, 205)).toMatchObject({ penalty: 'lateral', hazard: 'rough' });
    expect(c(300 + DEFAULT_TREE_RADIUS_M - 0.5, 300).recovery).toBe(true);
    expect(c(300 + DEFAULT_TREE_RADIUS_M + 0.5, 300)).toBe(DEFAULT_LANDING);
    // In the tree's bbox corner but outside its radius.
    expect(c(302.6, 302.6)).toBe(DEFAULT_LANDING);
    expect(c(409, 400)).toMatchObject({ recovery: true, hazard: 'wooded' });
    expect(c(505, 505).lie).toBe('hardpan');
    expect(c(630, 630).lie).toBe('fairway');
    expect(c(615, 615)).toBe(DEFAULT_LANDING);
    expect(hole.entries).toHaveLength(7);
  });
});

// ---------------------------------------------------------------- expected

describe('expectedAfterLanding', () => {
  const start = { lie: 'tee' as const, distanceM: 380 };
  it('uses the landing lie with no penalty', () => {
    expect(expectedAfterLanding(at(0, 250), 130, 'hcp15', start)).toBe(
      expectedStrokes('hcp15', 'fairway', 130),
    );
    expect(expectedAfterLanding(at(0, 380), 3, 'scratch', start)).toBe(
      expectedStrokes('scratch', 'green', 3),
    );
    const tree = { ...DEFAULT_LANDING, recovery: true };
    expect(landingCategory(tree)).toBe('recovery');
    expect(expectedAfterLanding(tree, 150, 'hcp15', start)).toBe(
      expectedStrokes('hcp15', 'recovery', 150),
    );
  });

  it('adds exactly one stroke for penalty areas (drop in rough) and OB (stroke and distance)', () => {
    const water = at(30, 380);
    expect(expectedAfterLanding(water, 25, 'hcp15', start)).toBeCloseTo(
      expectedStrokes('hcp15', 'rough', 25) + 1,
      12,
    );
    const yellow = { ...water, penalty: 'yellow' as const };
    expect(expectedAfterLanding(yellow, 25, 'hcp15', start)).toBeCloseTo(
      expectedStrokes('hcp15', 'rough', 25) + 1,
      12,
    );
    const ob = at(-80, 200);
    expect(expectedAfterLanding(ob, 180, 'hcp15', start)).toBeCloseTo(
      expectedStrokes('hcp15', 'tee', 380) + 1,
      12,
    );
  });
});

// ---------------------------------------------------------------- evaluate

describe('evaluateOption', () => {
  it('is deterministic for a seed and varies with it', () => {
    const a = evaluateOption(evalCtx());
    const b = evaluateOption(evalCtx());
    expect(a).toEqual(b);
    const c = evaluateOption(evalCtx({ seed: 8 }));
    expect(c.expectedStrokes).not.toBe(a.expectedStrokes);
    expect(evaluateOption(evalCtx({ samples: 400 }))).toEqual(a);
  });

  it('reproduces applyConditions + fromClubFrame exactly for a zero-spread pattern', () => {
    const conditions: Conditions = {
      ...STANDARD_CONDITIONS,
      windSpeedMps: 6,
      windFromDeg: 250,
      tempC: 8,
      elevationEndM: 4,
    };
    const slope = { ...FLAT_STANCE, ballAboveFeet: 'mild' as const };
    const tight = club('7i', 'iron', pat(150, 0, 0, 0, 2), 34);
    const aim = ll(-10, 380);
    const input = evalCtx({ club: tight, aim, conditions, slope, handedness: 'L', samples: 16 });
    const ev = evaluateOption(input);
    const bearing = initialBearingDeg(APPROACH_START, aim);
    const expected = fromClubFrame(
      APPROACH_START,
      bearing,
      applyConditions(
        { alongM: 150, lateralM: 2 },
        {
          club: { kind: 'iron', loftDeg: 34 },
          lineBearingDeg: bearing,
          conditions,
          lie: 'fairway',
          slope,
          handedness: 'L',
        },
      ),
    );
    expect(haversineDistanceM(ev.meanLanding, expected)).toBeLessThan(1e-6);
    const cm = conditionedMean(input);
    expect(toClubFrame(APPROACH_START, bearing, ev.meanLanding).alongM).toBeCloseTo(cm.alongM, 6);
    expect(ev.ellipse80).toHaveLength(35);
    expect(ev.ellipse80[0]).toEqual(ev.ellipse80[34]);
  });

  it('adds the flyer mixture and extra spread from the lie', () => {
    const tight = club('7i', 'iron', pat(150, 0, 0, 0), 34);
    const input = evalCtx({ club: tight, startLie: 'rough', samples: 2000 });
    const ev = evaluateOption(input);
    const cm = conditionedMean(input);
    const along = toClubFrame(APPROACH_START, 0, ev.meanLanding).alongM;
    // 15 % flyers × 8 % ≈ +1.2 % of the (rough-shortened) distance.
    expect(along - cm.alongM).toBeGreaterThan(0.008 * cm.alongM);
    expect(along - cm.alongM).toBeLessThan(0.016 * cm.alongM);
    // Extra σ inflates the ellipse relative to the fairway one.
    const fw = evaluateOption(evalCtx({ club: tight, samples: 1 }));
    const width = (ring: LatLng[]) => {
      const xs = ring.map((p) => toLocalXY(ORIGIN, p).x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(ev.ellipse80)).toBeGreaterThan(width(fw.ellipse80));
  });

  it('scores OB with stroke and distance and water with a drop', () => {
    const start = ll(-60, 230);
    const intoOb = evaluateOption(
      evalCtx({ start, club: club('7i', 'iron', pat(25, 1, 1, 0)), aim: ll(-80, 230) }),
    );
    expect(intoOb.pOb).toBe(1);
    expect(intoOb.pPenalty).toBe(1);
    const d = haversineDistanceM(start, PIN);
    expect(intoOb.expectedRemainingM).toBeCloseTo(d, 9);
    expect(intoOb.expectedStrokes).toBeCloseTo(expectedStrokes('hcp15', 'fairway', d) + 1, 9);

    const intoWater = evaluateOption(evalCtx({ aim: ll(40, 380) }));
    expect(intoWater.pHazardByKind.water).toBeGreaterThan(0.5);
    expect(intoWater.pPenalty).toBeGreaterThanOrEqual(intoWater.pHazardByKind.water!);
    expect(intoWater.pOb).toBe(0);
  });

  it('returns zeros for zero samples and honours a model override', () => {
    const ev = evaluateOption(evalCtx({ samples: 0 }));
    expect(ev.expectedStrokes).toBe(0);
    expect(ev.pGreen).toBe(0);
    const noFlyer = resolveConditionModel({ flyerDistanceFrac: 0 });
    const tight = club('7i', 'iron', pat(150, 0, 0, 0));
    const input = evalCtx({ club: tight, startLie: 'rough', samples: 500, model: noFlyer });
    const along = toClubFrame(APPROACH_START, 0, evaluateOption(input).meanLanding).alongM;
    expect(along).toBeCloseTo(conditionedMean(input).alongM, 0);
  });

  it('reuses draws: drawSamples is deterministic', () => {
    expect(drawSamples(I7.pattern, 10, 3)).toEqual(drawSamples(I7.pattern, 10, 3));
    expect(drawSamples(I7.pattern, 10, 3).n).toBe(10);
  });
});

// ---------------------------------------------------------------- properties

describe('properties', () => {
  it('probabilities are in [0, 1], disjoint outcomes sum ≤ 1, E ≥ 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: 250, max: 420, noNaN: true }),
        fc.double({ min: 0, max: 15, noNaN: true }),
        fc.double({ min: 0, max: 359, noNaN: true }),
        fc.constantFrom('fairway', 'rough', 'sand', 'tee', 'deep_rough'),
        fc.integer({ min: 0, max: 1000 }),
        (x, y, wind, dir, lie, seed) => {
          const ev = evaluateOption(
            evalCtx({
              aim: ll(x, y),
              startLie: lie,
              conditions: { ...STANDARD_CONDITIONS, windSpeedMps: wind, windFromDeg: dir },
              samples: 100,
              seed,
            }),
          );
          const hz = Object.values(ev.pHazardByKind);
          for (const p of [ev.pFairway, ev.pGreen, ev.pOb, ev.pPenalty, ...hz]) {
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
          }
          const sum = ev.pFairway + ev.pGreen + ev.pOb + hz.reduce((a, b) => a + b, 0);
          expect(sum).toBeLessThanOrEqual(1 + 1e-9);
          expect(ev.pOb).toBeLessThanOrEqual(ev.pPenalty);
          expect(ev.expectedStrokes).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('options are sorted ascending and never worse than the baseline', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: 160, max: 300, noNaN: true }),
        fc.integer({ min: 1, max: 1000 }),
        (x, y, seed) => {
          const rec = recommend(ctx({ start: ll(x, y), samples: 100, seed }));
          for (let i = 1; i < rec.options.length; i++) {
            expect(rec.options[i]!.expectedStrokes).toBeGreaterThanOrEqual(
              rec.options[i - 1]!.expectedStrokes,
            );
          }
          expect(rec.options[0]!.expectedStrokes).toBeGreaterThanOrEqual(1);
          expect(rec.savedVsBaseline).toBeGreaterThanOrEqual(0);
          expect(rec.options.length).toBeLessThanOrEqual(5);
        },
      ),
      { numRuns: 12 },
    );
  });
});

// ---------------------------------------------------------------- search

describe('recommend', () => {
  it('approach: candidate clubs, sorted options, baseline and snapshot', () => {
    const rec = recommend(ctx());
    const ids = rec.options.map((o) => o.clubId);
    // 150 m: window 90–165 m → 6i, 7i, 8i, 9i (5i at 170 m is out, putter never).
    expect(new Set(ids)).toEqual(new Set(['6i', '7i', '8i', '9i']));
    expect(rec.options.every((o) => o.kind === 'approach')).toBe(true);
    expect(rec.options.every((o) => Math.abs(o.aimOffsetM.alongM) < 0.01)).toBe(true);
    expect(rec.options.every((o) => o.lineOffsetM === o.aimOffsetM.lateralM)).toBe(true);
    expect(rec.baseline.clubId).toBe('7i');
    expect(Math.abs(rec.baseline.aimOffsetM.lateralM)).toBeLessThan(1e-6);
    expect(rec.savedVsBaseline).toBeCloseTo(
      rec.baseline.expectedStrokes - rec.options[0]!.expectedStrokes,
      12,
    );
    expect(rec.engineVersion).toBe(STRATEGY_ENGINE_VERSION);
    expect(rec.engineVersions).toEqual({ strategy: 1, conditionModel: 1, dispersion: 1 });
    expect(rec.options[0]!.ellipse80.length).toBeGreaterThan(10);
    expect(rec.chosen).toBeUndefined();

    const snap = toRecommendationSnapshot(rec);
    expect(snap.chosen).toBeNull();
    expect(snap.options).toHaveLength(rec.options.length);
    expect('ellipse80' in snap.options[0]!).toBe(false);
    expect('ellipse80' in snap.baseline).toBe(false);
    expect(snap.inputsHash).toMatch(/^[0-9a-f]{8}$/);
    const chosen = evaluateChoice(ctx(), I8, ll(-6, 380));
    expect(toRecommendationSnapshot(rec, chosen).chosen?.clubId).toBe('8i');
    expect(toRecommendationSnapshot({ ...rec, chosen }).chosen?.aim).toEqual(ll(-6, 380));
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it('moves the aim away from water guarding the pin', () => {
    const pin = ll(8, 380);
    const withWater = prepareHole(par4({ pin }));
    const dry = prepareHole(
      par4({ pin, features: par4().features.filter((f) => f.kind !== 'water') }),
    );
    const wet = recommend(ctx({ pin, hole: withWater })).options[0]!;
    const safe = recommend(ctx({ pin, hole: dry })).options[0]!;
    expect(wet.aimOffsetM.lateralM).toBeLessThan(-2);
    expect(wet.aimOffsetM.lateralM).toBeLessThan(safe.aimOffsetM.lateralM - 2);
  });

  it('a wider fairway favours driver over hybrid off the tee', () => {
    const tee = (half: number, obAt: number) =>
      recommend(
        ctx({
          start: ll(0, 0),
          startLie: 'tee',
          isTeeShot: true,
          clubs: [HYBRID, DRIVER],
          hole: prepareHole(
            par4(
              {
                features: [
                  { kind: 'fairway', penalty: 'none', polygon: rect(-half, 150, half, 345) },
                  { kind: 'ob', penalty: 'ob', polygon: rect(obAt, -10, obAt + 60, 450) },
                  { kind: 'ob', penalty: 'ob', polygon: rect(-obAt - 60, -10, -obAt, 450) },
                ],
              },
              half,
            ),
          ),
        }),
      );
    const e = (rec: ReturnType<typeof recommend>, id: string) =>
      rec.options.find((o) => o.clubId === id)!.expectedStrokes;
    const wide = tee(40, 60);
    const narrow = tee(10, 20);
    expect(wide.options.every((o) => o.kind === 'layup')).toBe(true);
    expect(wide.options[0]!.clubId).toBe('Driver');
    expect(e(wide, 'Driver')).toBeLessThan(e(wide, '4h'));
    expect(e(narrow, '4h')).toBeLessThan(e(narrow, 'Driver'));
    expect(wide.baseline.clubId).toBe('Driver');
    expect(Math.abs(wide.baseline.lineOffsetM)).toBeLessThan(1e-6);
    expect(explainOption(wide.options[0]!, wide.baseline)).toMatch(/^Driver — play to \d+ yds out/);
  });

  it('lays up with clubs that finish 40 m short when nothing reaches', () => {
    const start = ll(0, 0);
    const rec = recommend(
      ctx({
        start,
        pin: ll(0, 480),
        hole: prepareHole(
          par4({ pin: ll(0, 480), lineOfPlay: [ll(0, -5), ll(0, 200), ll(60, 470)] }),
        ),
      }),
    );
    expect(rec.options.every((o) => o.kind === 'layup')).toBe(true);
    // Clubs up to 440 m qualify: all but the putter.
    expect(rec.options).toHaveLength(5);
    // Stations follow the dogleg: the driver aims right of the pin line.
    const driver = evaluateChoice(ctx({ start, pin: ll(0, 480) }), DRIVER, ll(0, 230));
    expect(driver.kind).toBe('layup');
    expect(Math.abs(driver.lineOffsetM)).toBeLessThan(1e-6);
    expect(rec.baseline.clubId).toBe('Driver');
    expect(rec.baseline.aimOffsetM.lateralM).toBeGreaterThan(0);
  });

  it('non-tee layup excludes approach-window clubs and clubs within 40 m', () => {
    // 250 m out, longest club 190 m (< 90 %): window 150–275 m holds 4h, 5i, 7i.
    const rec = recommend(ctx({ start: ll(0, 130), clubs: [HYBRID, I5, I7, I9], maxOptions: 10 }));
    const kinds = new Map(rec.options.map((o) => [o.clubId, o.kind]));
    expect(kinds.get('4h')).toBe('approach');
    expect(kinds.get('7i')).toBe('approach');
    // 9i (130 m) is below the 150 m window and ≤ 250 − 40 → layup.
    expect(kinds.get('9i')).toBe('layup');
    expect(rec.baseline.clubId).toBe('4h');
  });

  it('falls back to the closest club when no window fits, and needs a real club', () => {
    // 50 m out with only long clubs: nothing in the window, yet the green is "reached".
    const start = ll(0, 330);
    for (const clubs of [
      [DRIVER, HYBRID, PUTTER],
      [HYBRID, DRIVER],
    ]) {
      const rec = recommend(ctx({ start, clubs }));
      expect(rec.options.map((o) => o.clubId)).toEqual(['4h']);
      expect(rec.baseline.clubId).toBe('4h');
    }
    const unlabeled: StrategyClub = { id: 'club-uuid', kind: 'wedge', pattern: pat(50, 3, 4) };
    expect(evaluateChoice(ctx({ start }), unlabeled, PIN).clubLabel).toBe('club-uuid');
    expect(() => recommend(ctx({ clubs: [PUTTER] }))).toThrow(RangeError);
  });

  it('coarse-to-fine lands within a few hundredths of the exhaustive search', () => {
    const coarse = recommend(ctx({ seed: 5 }));
    const full = recommend(ctx({ seed: 5, exhaustive: true }));
    expect(coarse.options[0]!.expectedStrokes - full.options[0]!.expectedStrokes).toBeLessThan(
      0.02,
    );
    expect(coarse.options[0]!.expectedStrokes).toBeGreaterThanOrEqual(
      full.options[0]!.expectedStrokes - 1e-12,
    );
  });

  it('uses a straight line of play when the hole has none, and honours maxOptions and model', () => {
    const noLine = prepareHole(par4({ lineOfPlay: [ll(0, 0)] }));
    const rec = recommend(ctx({ hole: noLine, maxOptions: 2 }));
    expect(rec.options).toHaveLength(2);
    const noLine2 = prepareHole({ ...par4() });
    delete (noLine2.geometry as { lineOfPlay?: unknown }).lineOfPlay;
    const layup = evaluateChoice(ctx({ start: ll(0, 0), hole: noLine2 }), I7, ll(5, 150));
    expect(layup.lineOffsetM).toBeCloseTo(5, 1);
    const m = { ...DEFAULT_CONDITION_MODEL };
    expect(recommend(ctx({ model: m, samples: 50 })).engineVersions.conditionModel).toBe(1);
  });

  it('hashes inputs stably', () => {
    const a = hashInputs(ctx());
    const reordered = Object.fromEntries(Object.entries(ctx()).reverse()) as RecommendInput;
    expect(hashInputs(reordered)).toBe(a);
    expect(hashInputs(ctx({ seed: 2 }))).not.toBe(a);
    expect(hashInputs(ctx({ seed: 1, samples: 400 }))).toBe(a);
  });
});

describe('pointAlongLine', () => {
  it('walks the polyline and extends past its end', () => {
    const line = [ll(0, 0), ll(0, 100), ll(100, 100)];
    const p = toLocalXY(ORIGIN, pointAlongLine(ORIGIN, line, 125));
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(125, 6);
    expect(p.y).toBeCloseTo(100, 6);
    expect(p.x).toBeCloseTo(75, 6);
    const q = toLocalXY(ORIGIN, pointAlongLine(ORIGIN, line, 300));
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(300, 1);
    expect(q.x).toBeCloseTo(q.y, 1);
  });
});

// ---------------------------------------------------------------- explain

function option(o: Partial<StrategyOption>): StrategyOption {
  return {
    clubId: '7i',
    clubLabel: '7i',
    kind: 'approach',
    aim: PIN,
    aimOffsetM: { alongM: 0, lateralM: 0 },
    lineOffsetM: 0,
    expectedStrokes: 3,
    pFairway: 0,
    pGreen: 0.5,
    pHazardByKind: {},
    pOb: 0,
    pPenalty: 0,
    expectedRemainingM: 10,
    ellipse80: [],
    meanLanding: PIN,
    ...o,
  };
}

describe('explainOption', () => {
  it('matches the §9.4 example', () => {
    const o = option({
      aimOffsetM: { alongM: 0, lateralM: -8.2 },
      pGreen: 0.61,
      pHazardByKind: { bunker: 0.09, water: 0.004 },
      expectedStrokes: 3.01,
    });
    const base = option({ expectedStrokes: 3.2 });
    expect(explainOption(o, base, 'yards')).toBe(
      '7i — aim 9 yds left of pin. 61 % green, 9 % bunker, 0.19 strokes better than at the pin.',
    );
  });

  it('covers sides, units, hazards, OB and comparisons', () => {
    const base = option({ expectedStrokes: 3 });
    expect(explainOption(option({ aimOffsetM: { alongM: 0, lateralM: 4 } }), base, 'metres')).toBe(
      '7i — aim 4 m right of pin. 50 % green, same as at the pin.',
    );
    expect(explainOption(option({ aimOffsetM: { alongM: 0, lateralM: 0.3 } }), base)).toMatch(
      /aim at the pin/,
    );
    const other = option({
      clubId: '8i',
      clubLabel: '8i',
      expectedStrokes: 3.25,
      pHazardByKind: { water: 0.12, tree: 0.2 },
      pOb: 0.03,
    });
    expect(explainOption(other, base)).toBe(
      '8i — aim at the pin. 50 % green, 20 % trees, 3 % OB, 0.25 strokes worse than 7i at the pin.',
    );
    expect(explainOption(option({ pHazardByKind: { deep_rough: 0.1 } }), base)).toMatch(
      /10 % penalty area/,
    );
  });

  it('describes layups against a layup baseline', () => {
    const lay = option({
      clubId: '4h',
      clubLabel: '4h',
      kind: 'layup',
      aimOffsetM: { alongM: -150, lateralM: 0 },
      lineOffsetM: -5,
      pFairway: 0.72,
      expectedStrokes: 4.1,
    });
    const base = option({
      clubId: 'D',
      clubLabel: 'Driver',
      kind: 'layup',
      lineOffsetM: 0,
      expectedStrokes: 4.2,
    });
    expect(explainOption(lay, base)).toBe(
      '4h — play to 164 yds out, 5 yds left of the line. 72 % fairway, 0.10 strokes better than Driver down the line.',
    );
    expect(explainOption({ ...lay, lineOffsetM: 3 }, base, 'metres')).toMatch(
      /play to 150 m out, 3 m right of the line/,
    );
    expect(explainOption({ ...lay, lineOffsetM: 0.2 }, base)).toMatch(/out, down the line\./);
  });
});

// ---------------------------------------------------------------- performance

describe('performance', () => {
  it('full approach search: 4 clubs × 45 aims × 400 samples in < 400 ms', () => {
    const input = ctx({ clubs: [I6, I7, I8, I9], exhaustive: true });
    recommend(input); // warm-up (JIT)
    const t0 = performance.now();
    const rec = recommend(input);
    const exhaustiveMs = performance.now() - t0;
    const t1 = performance.now();
    recommend({ ...input, exhaustive: false });
    const coarseMs = performance.now() - t1;
    const t2 = performance.now();
    recommend(ctx({ start: ll(0, 0), startLie: 'tee', isTeeShot: true }));
    const teeMs = performance.now() - t2;
    console.log(
      `strategy perf: exhaustive approach ${exhaustiveMs.toFixed(1)} ms, coarse-to-fine ${coarseMs.toFixed(1)} ms, tee (7 clubs) ${teeMs.toFixed(1)} ms`,
    );
    expect(rec.options).toHaveLength(4);
    expect(exhaustiveMs).toBeLessThan(400);
  });
});
