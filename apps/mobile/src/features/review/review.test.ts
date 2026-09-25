import {
  newRound,
  newShot,
  type CourseBundle,
  type RoundReviewSummary,
  type Shot,
} from '@caddymate/api';
import {
  destinationPoint,
  fitPattern,
  haversineDistanceM,
  initialBearingDeg,
  toClubFrame,
  type SgCategory,
} from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import {
  fmtSg,
  holeAverages,
  holeView,
  localRoundReview,
  niceDomain,
  replayShots,
  rollingSeries,
  scale,
  scatterDomains,
  shotEllipse,
  teeStrategy,
} from './review';

const TEE = { lat: 53.4, lng: -6.9 };
const PIN = destinationPoint(TEE, 0, 360);

const bundle: CourseBundle = {
  course: {
    id: 'c1',
    name: 'Moyvalley',
    slug: 'moyvalley',
    country: 'IE',
    centroid: null,
    currentVersion: 1,
    status: 'published',
  },
  version: 1,
  holes: [
    {
      id: 'h1',
      number: 1,
      par: 4,
      lineOfPlay: [TEE, PIN],
      green: null,
      greenCentre: PIN,
      features: [],
    },
  ],
  teeSets: [
    {
      id: 't1',
      name: 'White',
      colourHex: null,
      courseRating: 71,
      slopeRating: 125,
      bogeyRating: null,
      par: 72,
      markers: [{ id: 'm1', holeId: 'h1', point: TEE, strokeIndex: 5, yardageM: 360 }],
    },
  ],
};

const round = newRound({
  id: 'r1',
  userId: 'u',
  courseId: 'c1',
  courseVersion: 1,
  teeSetId: 't1',
  handicapIndexUsed: 14,
});

const pattern = fitPattern([], {
  prior: { n0: 8, distance: { mean: 150, sd: 8 }, lateral: { mean: 2, sd: 9 } },
});

const shot = (p: Partial<Shot> & { seq: number }): Shot =>
  newShot({ id: `s${String(p.seq)}`, userId: 'u', roundId: 'r1', holeNumber: 1, ...p });

describe('fmtSg', () => {
  it('signs and rounds', () => {
    expect(fmtSg(0.4234)).toBe('+0.42');
    expect(fmtSg(-1.1)).toBe('−1.10');
    expect(fmtSg(-0.001)).toBe('0.00');
    expect(fmtSg(null)).toBe('–');
    expect(fmtSg(2.26, 1)).toBe('+2.3');
  });
});

describe('localRoundReview + replay', () => {
  const mid = destinationPoint(TEE, 0, 220);
  const aim = destinationPoint(mid, 0, 140);
  const shots = [
    shot({
      seq: 1,
      clubId: 'dr',
      lie: 'tee',
      start: TEE,
      end: mid,
      distanceToPinBeforeM: 360,
      target: mid,
    }),
    shot({
      seq: 2,
      clubId: '7i',
      lie: 'fairway',
      start: mid,
      end: PIN,
      holed: true,
      distanceToPinBeforeM: 140,
      recommendation: {
        engineVersions: { strategy: 1, conditionModel: 1, dispersion: 1 },
        inputsHash: 'x',
        options: [],
        baseline: {} as never,
        chosen: {
          clubId: '7i',
          clubLabel: '7i',
          kind: 'approach',
          aim,
          aimOffsetM: { alongM: 0, lateralM: 0 },
          lineOffsetM: 0,
          expectedStrokes: 2.1,
          pFairway: 0,
          pGreen: 0.6,
          pHazardByKind: {},
          pOb: 0,
          pPenalty: 0,
          expectedRemainingM: 10,
          meanLanding: destinationPoint(mid, 5, 135),
        },
        savedVsBaseline: 0,
      },
    }),
  ];
  const review = localRoundReview({
    round,
    bundle,
    scores: [],
    shots: [...shots, shot({ seq: 3, clubId: null, penalty: 'none', source: 'sim' as const })],
    clubs: [
      {
        id: '7i',
        name: '7i',
        kind: 'iron',
        loftDeg: 34,
        bagOrder: 6,
        active: true,
        stockTotalM: 150,
        stockCarryM: null,
        simNameAliases: [],
      },
    ],
    patterns: [
      {
        clubId: '7i',
        params: pattern,
        nEffective: 0,
        nRaw: 0,
        confidence: 'seeded',
        fittedAt: '',
        engineVersion: 1,
      },
    ],
    officialIndex: null,
  });

  it('builds a review from the bundle pars, handicap baseline and labels', () => {
    expect(review.baseline).toBe('hcp15');
    expect(review.holes).toHaveLength(1);
    expect(review.holes[0]!.shots).toHaveLength(2); // sim shot ignored
    expect(review.sgSummary.counts.ott).toBe(1);
    expect(review.perClubSg.find((c) => c.clubId === '7i')?.label).toBe('7i');
  });

  it('replays each shot with its chosen aim and a pattern ellipse around the expected landing', () => {
    const frames = replayShots(review.holes[0]!, new Map([['7i', pattern]]), review.clubLabels);
    expect(frames.map((f) => f.seq)).toEqual([1, 2]);
    expect(frames[0]!.ellipse).toBeNull(); // no driver pattern
    expect(frames[0]!.aim).toEqual(mid);
    const f = frames[1]!;
    expect(f.aim).toEqual(aim);
    expect(f.ellipseSource).toBe('pattern');
    // The ellipse is centred on the snapshot's mean landing (≈ 135 m out, 5° right).
    const ring = f.ellipse!;
    const c = {
      lat: ring.slice(0, -1).reduce((t, p) => t + p.lat, 0) / (ring.length - 1),
      lng: ring.slice(0, -1).reduce((t, p) => t + p.lng, 0) / (ring.length - 1),
    };
    expect(haversineDistanceM(c, destinationPoint(mid, 5, 135))).toBeLessThan(3);
  });
});

describe('shotEllipse', () => {
  it('uses the pattern mean along the aim line without a landing', () => {
    const start = TEE;
    const aim = destinationPoint(start, 90, 150);
    const ring = shotEllipse(start, aim, pattern);
    const frame = ring.map((p) => toClubFrame(start, initialBearingDeg(start, aim), p));
    const along = frame.map((p) => p.alongM);
    expect(Math.min(...along)).toBeCloseTo(150 - 1.794 * 8, 0);
    expect(Math.max(...along)).toBeCloseTo(150 + 1.794 * 8, 0);
  });
});

describe('holeView', () => {
  it('fits tee, line and shots, bearing tee → green', () => {
    const extra = destinationPoint(TEE, 270, 80);
    const v = holeView(bundle, round, 1, [{ start: TEE, end: extra }])!;
    expect(v.bounds[0]).toBeCloseTo(extra.lng, 9);
    expect(v.bearing).toBeCloseTo(0, 6);
    expect(holeView(bundle, round, 9)).toBeNull();
  });
});

const cats = (v: number): Record<SgCategory, number> => ({ ott: v, app: v, arg: v, putt: v });

function summary(i: number, p: Partial<RoundReviewSummary> = {}): RoundReviewSummary {
  return {
    roundId: `r${String(i)}`,
    courseId: 'c1',
    courseName: 'Moyvalley',
    startedAt: `2026-0${String(i)}-01T09:00:00Z`,
    totals: {
      par: 72,
      gross: 85,
      net: 71,
      points: 36,
      putts: 32,
      penalties: 1,
      adjustedGross: 84,
      differential: 12,
      holesPlayed: 18,
    },
    sg: { total: i * 4, byCategory: cats(i), counts: cats(1), byClub: {} },
    grading: { strategyLoss: 0, executionLoss: 0, cost: 0, count: 0 },
    matrix: {
      goodDecisionGoodExecution: 0,
      goodDecisionPoorExecution: 0,
      poorDecisionGoodExecution: 0,
      poorDecisionPoorExecution: 0,
    },
    holes: [
      { number: 1, par: 4, strokes: 4 + i, sg: -i },
      { number: 2, par: 3, strokes: null, sg: 0 },
    ],
    teeShots: [],
    ...p,
  };
}

describe('trends', () => {
  it('rolls SG over a window, aligned with the rounds', () => {
    const s = rollingSeries([summary(1), summary(2), summary(3)], 2);
    expect(s.map((p) => p.total)).toEqual([4, 6, 10]);
    expect(s[2]!.byCategory.app).toBe(2.5);
    expect(s[2]!.roundId).toBe('r3');
  });

  it('averages scoring per hole at a course', () => {
    const h = holeAverages([summary(1), summary(3), summary(2, { courseId: 'other' })], 'c1');
    expect(h).toEqual([{ number: 1, par: 4, n: 2, avgStrokes: 6, avgToPar: 2, avgSg: -2 }]);
  });

  it('compares tee clubs on par 4/5s by actual outcome', () => {
    const tee = (clubId: string, sg: number, surface: 'fairway' | 'rough', penalty = false) => ({
      roundId: 'r',
      courseId: 'c1',
      holeNumber: 4,
      par: 4,
      clubId,
      clubLabel: clubId === 'dr' ? 'Driver' : '5W',
      sg,
      resultSurface: surface,
      penalty,
      remainingM: 150,
      recommendedClubId: '5w',
    });
    const out = teeStrategy(
      [
        summary(1, {
          teeShots: [
            tee('dr', -0.4, 'rough', true),
            tee('dr', 0.2, 'fairway'),
            tee('5w', 0.1, 'fairway'),
            { ...tee('dr', 1, 'fairway'), par: 3, holeNumber: 2 },
          ],
        }),
      ],
      'c1',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.clubs.map((c) => c.clubId)).toEqual(['5w', 'dr']);
    const dr = out[0]!.clubs[1]!;
    expect(dr).toMatchObject({ label: 'Driver', n: 2, fairwayPct: 0.5, penaltyPct: 0.5 });
    expect(dr.avgSg).toBeCloseTo(-0.1, 9);
    expect(out[0]!.clubs[0]!.recommendedPct).toBe(1);
  });
});

describe('chart scaling', () => {
  it('pads domains, includes zero and never collapses', () => {
    const d = niceDomain([1, 3], [0]);
    expect(d.min).toBeLessThan(0);
    expect(d.max).toBeGreaterThan(3);
    expect(niceDomain([])).toEqual({ min: 0, max: 1 });
    const flat = niceDomain([2, 2]);
    expect(flat.max - flat.min).toBeGreaterThan(0);
    const s = scale({ min: 0, max: 10 }, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
  });

  it('makes square scatter domains around points and rings', () => {
    const d = scatterDomains(
      [{ alongM: 140, lateralM: 5 }],
      [
        [
          { alongM: 120, lateralM: -10 },
          { alongM: 170, lateralM: 12 },
        ],
      ],
    );
    expect(d.x.max - d.x.min).toBeCloseTo(d.y.max - d.y.min, 9);
    expect(d.y.min).toBeLessThanOrEqual(120);
    expect(d.y.max).toBeGreaterThanOrEqual(170);
  });
});
