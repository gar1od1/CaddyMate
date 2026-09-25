import {
  expectedStrokes,
  fitPattern,
  type ClubPattern,
  type RecommendationSnapshot,
  type SnapshotOption,
} from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import {
  approxOutcomeP20,
  buildRoundReview,
  describeBucket,
  dispersionHistory,
  explainGradedShot,
  gradeRound,
  holeShotSg,
  listRoundReviews,
  missTendencies,
  normalCdf,
  probRight,
  whsLedger,
} from './review.js';
import { newRound } from './rounds.js';
import { newShot, shotToRow } from './shots.js';
import { FakeDb, type Rec } from './testing/fakeDb.js';
import type { Shot } from './types.js';

const USER = 'user-1';
const ROUND = 'round-1';
const COURSE = 'course-1';

let n = 0;
function shot(p: Partial<Shot> & { holeNumber?: number; seq: number }): Shot {
  return newShot({
    id: `s${String(++n)}`,
    userId: USER,
    roundId: ROUND,
    holeNumber: 1,
    playedAt: '2026-09-20T10:00:00Z',
    clubId: '7i',
    ...p,
  });
}

function option(p: Partial<SnapshotOption>): SnapshotOption {
  return {
    expectedStrokes: 3,
    pFairway: 0,
    pGreen: 0.6,
    pHazardByKind: {},
    pOb: 0,
    pPenalty: 0,
    expectedRemainingM: 12,
    meanLanding: { lat: 0, lng: 0 },
    clubId: '7i',
    clubLabel: '7i',
    kind: 'approach',
    aim: { lat: 0, lng: 0 },
    aimOffsetM: { alongM: 0, lateralM: 0 },
    lineOffsetM: 0,
    ...p,
  };
}

function snapshot(best: SnapshotOption, chosen: SnapshotOption): RecommendationSnapshot {
  return {
    engineVersions: { strategy: 1, conditionModel: 1, dispersion: 1 },
    inputsHash: 'abcd1234',
    options: [best, chosen],
    baseline: chosen,
    chosen,
    savedVsBaseline: Math.max(0, chosen.expectedStrokes - best.expectedStrokes),
  };
}

const E = (c: Parameters<typeof expectedStrokes>[1], d: number) => expectedStrokes('hcp15', c, d);

describe('holeShotSg', () => {
  it('sums to E(start) − strokes over a holed-out hole', () => {
    const shots = [
      shot({ seq: 1, lie: 'tee', distanceToPinBeforeM: 350, clubId: 'dr' }),
      shot({ seq: 2, lie: 'fairway', distanceToPinBeforeM: 140 }),
      shot({ seq: 3, lie: 'green', distanceToPinBeforeM: 5, clubId: 'pt' }),
      shot({ seq: 4, lie: 'green', distanceToPinBeforeM: 1, clubId: 'pt', holed: true }),
    ];
    const sg = holeShotSg(shots, 4, 'hcp15');
    expect(sg.get(shots[0]!.id)!.sg).toBeCloseTo(E('tee', 350) - E('fairway', 140) - 1, 9);
    expect(sg.get(shots[0]!.id)!.category).toBe('ott');
    expect(sg.get(shots[1]!.id)!.category).toBe('app');
    expect(sg.get(shots[2]!.id)!.category).toBe('putt');
    expect(sg.get(shots[3]!.id)!.sg).toBeCloseTo(E('green', 1) - 1, 9);
    const total = [...sg.values()].reduce((t, s) => t + s.sg, 0);
    expect(total).toBeCloseTo(E('tee', 350) - 4, 9);
  });

  it('charges a relief record to the shot that caused it, played from the drop', () => {
    const shots = [
      shot({ seq: 1, lie: 'tee', distanceToPinBeforeM: 350, clubId: 'dr' }),
      shot({ seq: 2, clubId: null, penalty: 'lateral', strokeCount: 1 }),
      shot({ seq: 3, lie: 'rough', distanceToPinBeforeM: 150 }),
      shot({ seq: 4, lie: 'sand', distanceToPinBeforeM: 20, holed: true }),
    ];
    const sg = holeShotSg(shots, 4, 'hcp15');
    expect(sg.has(shots[1]!.id)).toBe(false);
    const first = sg.get(shots[0]!.id)!;
    expect(first.sg).toBeCloseTo(E('tee', 350) - E('rough', 150) - 2, 9);
    expect(first.charged).toBeCloseTo(2, 9);
    expect(sg.get(shots[3]!.id)!.category).toBe('arg');
    const total = [...sg.values()].reduce((t, s) => t + s.sg, 0);
    expect(total).toBeCloseTo(E('tee', 350) - 4, 9);
  });

  it('uses the recorded finish for a last shot that was not holed, else skips it', () => {
    const a = shot({
      seq: 1,
      lie: 'fairway',
      distanceToPinBeforeM: 100,
      resultSurface: 'green',
      distanceToPinAfterM: 6,
    });
    const b = shot({ seq: 1, lie: 'fairway', distanceToPinBeforeM: 100 });
    expect(holeShotSg([a], 3, 'hcp15').get(a.id)!.sg).toBeCloseTo(
      E('fairway', 100) - E('green', 6) - 1,
      9,
    );
    expect(holeShotSg([b], 3, 'hcp15').size).toBe(0);
    // Par 3 tee shot is APP, not OTT.
    expect(holeShotSg([a], 3, 'hcp15').get(a.id)!.category).toBe('app');
  });
});

describe('approxOutcomeP20', () => {
  const pattern: ClubPattern = fitPattern([], {
    prior: { n0: 8, distance: { mean: 150, sd: 8 }, lateral: { mean: 0, sd: 10 } },
  });

  it('sits above the mean and grows with penalty risk and spread', () => {
    const o = option({ expectedStrokes: 3.1, pGreen: 0.5, expectedRemainingM: 15 });
    const base = approxOutcomeP20(o, 'hcp15', pattern, 150);
    expect(base).toBeGreaterThan(o.expectedStrokes);
    expect(approxOutcomeP20({ ...o, pPenalty: 0.3 }, 'hcp15', pattern, 150)).toBeGreaterThan(base);
    expect(approxOutcomeP20(o, 'hcp15', null, 300)).toBeGreaterThan(
      approxOutcomeP20(o, 'hcp15', null, 100),
    );
  });

  it('is the mean when the outcome is certain', () => {
    const o = option({ pGreen: 1, pPenalty: 0, expectedRemainingM: 0 });
    expect(approxOutcomeP20(o, 'hcp15', null, 0)).toBeCloseTo(o.expectedStrokes, 9);
  });
});

describe('explainGradedShot', () => {
  const best = option({
    clubId: '6i',
    clubLabel: '6i',
    expectedStrokes: 3.0,
    aimOffsetM: { alongM: 0, lateralM: -11 },
    pHazardByKind: { water: 0.06 },
  });
  const chosen = option({ expectedStrokes: 3.25, pHazardByKind: { water: 0.31, bunker: 0.05 } });

  it('explains a poor decision from the snapshot', () => {
    const snap = snapshot(best, chosen);
    const grade = {
      strategyLoss: 0.25,
      executionLoss: 0,
      decisionGrade: 'poor' as const,
      executionGrade: 'good' as const,
      eBest: 3,
      eChosen: 3.25,
      eActual: 3.25,
      eP20: 3.8,
    };
    expect(
      explainGradedShot(snap, grade, {
        holed: false,
        surface: 'green',
        distanceAfterM: 8,
        penalty: false,
      }),
    ).toBe('Aimed at the pin with 7i: 31 % wet. Best: 6i 12 yds left, 6 % wet (0.25 strokes).');
  });

  it('explains the execution when the decision was good', () => {
    const snap = snapshot(chosen, chosen);
    const grade = {
      strategyLoss: 0,
      executionLoss: -0.6,
      decisionGrade: 'good' as const,
      executionGrade: 'poor' as const,
      eBest: 3.25,
      eChosen: 3.25,
      eActual: 3.85,
      eP20: 3.6,
    };
    expect(
      explainGradedShot(snap, grade, {
        holed: false,
        surface: 'sand',
        distanceAfterM: 30,
        penalty: false,
      }),
    ).toBe(
      '7i at the pin (31 % wet) was the right call; finished 33 yds away on the sand, 0.60 worse than expected.',
    );
  });
});

function seedRound(db: FakeDb, over: Partial<Rec> = {}, id = ROUND) {
  const round = newRound({
    id,
    userId: USER,
    courseId: COURSE,
    courseVersion: 1,
    teeSetId: 'tee-1',
    startedAt: '2026-09-20T09:00:00Z',
    handicapIndexUsed: 15,
  });
  db.table('rounds').push({
    round_id: round.id,
    user_id: USER,
    course_id: COURSE,
    course_version: 1,
    tee_set_id: 'tee-1',
    started_at: round.startedAt,
    finished_at: '2026-09-20T13:00:00Z',
    status: 'complete',
    weather_snapshot: null,
    pin_overrides: {},
    handicap_index_used: 15,
    course_handicap: 16,
    playing_handicap: 15,
    gross: 5,
    adjusted_gross: 5,
    stableford: 2,
    differential: null,
    ...over,
  });
}

function fixture() {
  const db = new FakeDb({
    holes: [
      { course_id: COURSE, version: 1, hole_number: 1, par: 4 },
      { course_id: COURSE, version: 2, hole_number: 1, par: 5 },
    ],
    courses: [{ course_id: COURSE, name: 'Moyvalley' }],
    clubs: [
      { club_id: '7i', name: '7i', kind: 'iron', loft_deg: 34, stock_total_m: 150 },
      { club_id: 'dr', name: 'Driver', kind: 'driver', loft_deg: 10, stock_total_m: 230 },
    ],
    profiles: [{ user_id: USER, handicap_index_official: 14.2 }],
    hole_scores: [
      {
        round_id: ROUND,
        hole_number: 1,
        strokes_logged: 5,
        strokes_override: null,
        override_reason: null,
        putts: 2,
        penalties: 0,
        points: 2,
        net_strokes: 4,
      },
    ],
  });
  seedRound(db);
  const best = option({
    clubId: '6i',
    clubLabel: '6i',
    expectedStrokes: 3.05,
    aimOffsetM: { alongM: 0, lateralM: -10 },
  });
  const chosen = option({ expectedStrokes: 3.2, pHazardByKind: { water: 0.2 } });
  const shots = [
    shot({ seq: 1, lie: 'tee', distanceToPinBeforeM: 360, clubId: 'dr' }),
    shot({
      seq: 2,
      lie: 'fairway',
      distanceToPinBeforeM: 140,
      recommendation: snapshot(best, chosen),
    }),
    shot({ seq: 3, lie: 'rough', distanceToPinBeforeM: 25, clubId: 'sw' }),
    shot({ seq: 4, lie: 'green', distanceToPinBeforeM: 4, clubId: 'pt' }),
    shot({ seq: 5, lie: 'green', distanceToPinBeforeM: 0.5, clubId: 'pt', holed: true }),
  ];
  for (const s of shots) db.table('shots').push(shotToRow(s));
  return { db, shots, best, chosen };
}

describe('gradeRound', () => {
  it('grades against the snapshot, writes the columns back and summarises', async () => {
    const { db, shots, chosen } = fixture();
    const review = await gradeRound(db.asDb(), ROUND);
    expect(review.baseline).toBe('hcp15');
    const approach = review.holes[0]!.shots[1]!;
    const eActual = E('rough', 25);
    expect(approach.sg).toBeCloseTo(E('fairway', 140) - eActual - 1, 9);
    expect(approach.grade).toMatchObject({ eBest: 3.05, eChosen: 3.2, decisionGrade: 'poor' });
    expect(approach.grade!.strategyLoss).toBeCloseTo(0.15, 9);
    expect(approach.grade!.executionLoss).toBeCloseTo(chosen.expectedStrokes - eActual, 9);
    expect(approach.grade!.eActual).toBeCloseTo(eActual, 9);
    expect(approach.explanation).toContain('Aimed at the pin with 7i: 20 % wet. Best: 6i');

    // SG over the hole = E(tee) − strokes.
    expect(review.sgSummary.total).toBeCloseTo(E('tee', 360) - 5, 9);
    expect(review.sgSummary.counts).toEqual({ ott: 1, app: 1, arg: 1, putt: 2 });
    expect(review.perClubSg.map((c) => c.clubId).sort()).toEqual(['7i', 'dr']);
    expect(review.perClubSg.find((c) => c.clubId === 'dr')!.label).toBe('Driver');
    expect(review.roundGradingSummary.totals.count).toBe(1);
    const cell =
      approach.grade!.executionGrade === 'good'
        ? 'poorDecisionGoodExecution'
        : 'poorDecisionPoorExecution';
    expect(review.matrix[cell]).toBe(1);
    expect(review.totals).toMatchObject({ par: 4, gross: 5, points: 2, net: 4, putts: 2 });

    const rows = db.table('shots');
    const row = rows.find((r) => r.shot_id === shots[1]!.id)!;
    expect(row.sg).toBeCloseTo(approach.sg!, 3);
    expect(row.sg_category).toBe('app');
    expect(row.strategy_loss).toBe(0.15);
    expect(row.decision_grade).toBe('poor');
    expect(row.execution_grade).toBe(approach.grade!.executionGrade);
    const tee = rows.find((r) => r.shot_id === shots[0]!.id)!;
    expect(tee.sg_category).toBe('ott');
    expect(tee.decision_grade).toBeNull();
  });

  it('uses the official index for the baseline when the round has none, and can skip writing', async () => {
    const { db } = fixture();
    db.table('rounds')[0]!.handicap_index_used = null;
    db.table('profiles')[0]!.handicap_index_official = 3;
    const review = await gradeRound(db.asDb(), ROUND, { write: false });
    expect(review.baseline).toBe('scratch');
    expect(db.log.some((l) => l.table === 'shots' && l.op === 'update')).toBe(false);
  });

  it('grades execution poor when the result is beyond the 20th-percentile outcome', () => {
    const { shots, best } = fixture();
    const chosen = option({ expectedStrokes: 2.2, pGreen: 0.9, expectedRemainingM: 8 });
    const s = { ...shots[1]!, recommendation: snapshot(best, chosen) };
    const review = buildRoundReview({
      round: newRound({
        id: ROUND,
        userId: USER,
        courseId: COURSE,
        courseVersion: 1,
        teeSetId: 't',
      }),
      holeScores: [],
      shots: [shots[0]!, s, ...shots.slice(2)],
      pars: { 1: 4 },
      baseline: 'hcp15',
    });
    const g = review.holes[0]!.shots[1]!.grade!;
    expect(g.eActual).toBeGreaterThan(g.eP20);
    expect(g.executionGrade).toBe('poor');
    expect(g.decisionGrade).toBe('good');
    expect(review.mostExpensive[0]!.shot.shotId).toBe(s.id);
  });
});

describe('listRoundReviews', () => {
  it('returns the last n complete rounds oldest first with tee-shot outcomes', async () => {
    const { db } = fixture();
    seedRound(db, { started_at: '2026-09-10T09:00:00Z' }, 'round-0');
    seedRound(db, { started_at: '2026-09-01T09:00:00Z' }, 'round-old');
    seedRound(db, { status: 'live', started_at: '2026-09-22T09:00:00Z' }, 'round-live');
    const list = await listRoundReviews(db.asDb(), 2);
    expect(list.map((r) => r.roundId)).toEqual(['round-0', ROUND]);
    const last = list[1]!;
    expect(last.courseName).toBe('Moyvalley');
    expect(last.holes).toEqual([{ number: 1, par: 4, strokes: 5, sg: last.sg.total }]);
    expect(last.teeShots).toHaveLength(1);
    expect(last.teeShots[0]).toMatchObject({
      clubId: 'dr',
      clubLabel: 'Driver',
      penalty: false,
      remainingM: 140,
    });
    expect(db.log.some((l) => l.op === 'update')).toBe(false);
  });
});

describe('dispersionHistory', () => {
  it('re-fits the pattern from the shots played up to each round finish', async () => {
    const db = new FakeDb({
      clubs: [{ club_id: '7i', name: '7i', kind: 'iron', loft_deg: 34, stock_total_m: 150 }],
    });
    seedRound(db, { finished_at: '2026-09-01T13:00:00Z', started_at: '2026-09-01T09:00:00Z' }, 'a');
    seedRound(db, { finished_at: '2026-09-08T13:00:00Z', started_at: '2026-09-08T09:00:00Z' }, 'b');
    seedRound(db, { finished_at: '2026-09-15T13:00:00Z', started_at: '2026-09-15T09:00:00Z' }, 'c');
    const add = (date: string, along: number, lateral: number) =>
      db.table('shots').push({
        shot_id: `p${String(++n)}`,
        club_id: '7i',
        source: 'sim',
        lie: null,
        penalty: 'none',
        strike: 'good',
        reconstructed: false,
        end_accuracy_m: null,
        played_at: date,
        conditions: null,
        target_bearing_deg: null,
        neutral_distance_m: null,
        neutral_lateral_m: null,
        observed_distance_m: null,
        observed_lateral_m: null,
        sim_total_m: along,
        sim_offline_m: lateral,
      });
    for (let i = 0; i < 6; i++) add('2026-08-30T10:00:00Z', 160, 10);
    for (let i = 0; i < 6; i++) add('2026-09-05T10:00:00Z', 160, 10);
    const hist = await dispersionHistory(db.asDb(), '7i', { rounds: 2 });
    expect(hist.map((h) => h.roundId)).toEqual(['b', 'c']);
    expect(hist[0]!.pattern.n_raw).toBe(12);
    expect(hist[1]!.pattern.n_raw).toBe(12);
    // Recency: a week later the same shots weigh a little less.
    expect(hist[1]!.pattern.n_effective).toBeLessThan(hist[0]!.pattern.n_effective);
    const all = await dispersionHistory(db.asDb(), '7i', { rounds: 5 });
    expect(all.map((h) => h.pattern.n_raw)).toEqual([6, 12, 12]);
    expect(all[0]!.pattern.lateral.mean).toBeGreaterThan(0);
  });

  it('is empty for a putter', async () => {
    const db = new FakeDb({ clubs: [{ club_id: 'pt', kind: 'putter' }] });
    expect(await dispersionHistory(db.asDb(), 'pt')).toEqual([]);
  });
});

describe('miss tendencies', () => {
  const pattern = (lateralMean: number, sdL: number, sdR: number, nEff = 20): ClubPattern => {
    const p = fitPattern([], {
      prior: { n0: 8, distance: { mean: 150, sd: 7 }, lateral: { mean: 0, sd: 8 } },
    });
    return {
      ...p,
      lateral: { ...p.lateral, mean: lateralMean, sd_left: sdL, sd_right: sdR },
      n_effective: nEff,
    };
  };

  it('has a sane normal CDF and right-miss probability', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.2815515655446004)).toBeCloseTo(0.9, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
    expect(probRight(pattern(0, 8, 8))).toBeCloseTo(0.5, 7);
    expect(probRight(pattern(4, 8, 8))).toBeCloseTo(normalCdf(0.5), 7);
    expect(probRight(pattern(-4, 8, 8))).toBeCloseTo(1 - normalCdf(0.5), 7);
  });

  it('describes condition buckets', () => {
    expect(describeBucket('fairway|h:-1..1|c:+1..4')).toBe('in a left-to-right wind');
    expect(describeBucket('rough|h:+4..|c:-1..1')).toBe('from the rough in a strong headwind');
    expect(describeBucket('deep_rough|h:-4..-1|c:..-4')).toBe(
      'from the deep rough in a strong right-to-left downwind',
    );
    expect(describeBucket('fairway|h:-1..1|c:-1..1')).toBeNull();
  });

  it('writes the §14 sentences', () => {
    const sentences = missTendencies(
      [
        { clubId: '7i', params: pattern(5, 8, 8) },
        { clubId: 'dr', params: pattern(-1, 20, 12) },
        { clubId: '9i', params: pattern(5, 8, 8, 3) },
      ],
      [
        {
          clubId: '7i',
          bucketKey: 'fairway|h:-1..1|c:+1..4',
          params: { ...pattern(9, 10, 10), distance: { ...pattern(0, 1, 1).distance, mean: 150 } },
          nEffective: 18,
          fittedAt: '',
          engineVersion: 1,
        },
        {
          clubId: '7i',
          bucketKey: 'fairway|h:+4..|c:-1..1',
          params: { ...pattern(0, 8, 8), distance: { ...pattern(0, 1, 1).distance, mean: 135 } },
          nEffective: 16,
          fittedAt: '',
          engineVersion: 1,
        },
      ],
      { labels: { '7i': '7i', dr: 'Driver' } },
    );
    expect(sentences).toEqual([
      `7i finishes right of the line ${String(Math.round(normalCdf(5 / 8) * 100))} % of the time (avg 5 yds right).`,
      `7i misses right ${String(Math.round(normalCdf(9 / 10) * 100))} % in a left-to-right wind.`,
      '7i goes 16 yds shorter in a strong headwind.',
      "Driver's big miss is left (spread 1.7× the right side).",
    ]);
  });

  it('reports approaches finishing short of the target', () => {
    const shots = Array.from({ length: 10 }, (_, i) =>
      shot({
        seq: 2,
        start: { lat: 53, lng: -6.5 },
        target: { lat: 53.0012, lng: -6.5 }, // ≈ 133 m north
        observedDistanceM: i < 7 ? 125 : 138,
      }),
    );
    const out = missTendencies([], [], { shots });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Approaches finish short 70 % of the time \(avg \d+ yds short of/);
  });
});

describe('whsLedger', () => {
  it('lists the last 20 differentials, marks the ones that count and computes the index', async () => {
    const db = new FakeDb({ profiles: [{ user_id: USER, handicap_index_official: 14.8 }] });
    const diffs = [18.2, 15.1, 16.4, 14.0, 20.3, 17.7];
    diffs.forEach((d, i) => {
      seedRound(
        db,
        { started_at: `2026-0${String(i + 1)}-10T09:00:00Z`, differential: d },
        `r${String(i)}`,
      );
    });
    seedRound(db, { started_at: '2026-08-01T09:00:00Z', differential: null }, 'no-diff');
    const ledger = await whsLedger(db.asDb());
    expect(ledger.official).toBe(14.8);
    expect(ledger.entries.map((e) => e.differential)).toEqual([...diffs].reverse());
    // 6 scores: best 2, adjustment −1 → (14.0 + 15.1)/2 − 1 = 13.55 → 13.6.
    expect(ledger.entries.filter((e) => e.counts).map((e) => e.differential)).toEqual([14.0, 15.1]);
    expect(ledger.index?.index).toBe(13.6);
    expect(ledger.history.map((h) => h.index)).toHaveLength(4);
    expect(ledger.lowIndex365).toBe(Math.min(...ledger.history.slice(0, -1).map((h) => h.index)));
  });

  it('is empty without scores', async () => {
    const ledger = await whsLedger(new FakeDb().asDb());
    expect(ledger).toEqual({
      entries: [],
      index: null,
      lowIndex365: null,
      official: null,
      history: [],
    });
  });
});
