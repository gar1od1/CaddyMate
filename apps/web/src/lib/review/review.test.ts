import { describe, expect, it } from 'vitest';
import { newShot, type PatternShotRow } from '@caddymate/api';
import {
  fitPattern,
  priorFor,
  toClubFrame,
  initialBearingDeg,
  type LatLng,
  type RecommendationSnapshot,
  type SnapshotOption,
} from '@caddymate/engine';
import { bucketLabel, patternContours, scatterExtent, scatterPoints } from './dispersion';
import { collectionBounds, holeReplayCollection, shotAim, shotEllipse } from './replay';
import { decisionSummary, explainDecision, gradedShots, roundSg, scorecardTable } from './round';
import { isRoundGraded, type ReviewShot } from './shots';
import {
  holeScoringAverages,
  rollingSgSeries,
  roundSgSeries,
  teeStrategy,
  teeStrategyByHole,
  whsLedger,
  type LedgerInput,
} from './trends';

const TEE: LatLng = { lat: 53.4, lng: -6.9 };
const PIN: LatLng = { lat: 53.4015, lng: -6.9 }; // ~167 m north

function shot(p: Partial<ReviewShot> & { seq: number; holeNumber?: number }): ReviewShot {
  return {
    ...newShot({
      id: `s${String(p.holeNumber ?? 1)}-${String(p.seq)}`,
      userId: 'u',
      roundId: 'r',
      holeNumber: 1,
      seq: p.seq,
    }),
    sg: null,
    sgCategory: null,
    strategyLoss: null,
    executionLoss: null,
    decisionGrade: null,
    executionGrade: null,
    ...p,
  };
}

function option(clubId: string, e: number, extra: Partial<SnapshotOption> = {}): SnapshotOption {
  return {
    clubId,
    clubLabel: clubId,
    kind: 'approach',
    aim: PIN,
    aimOffsetM: { alongM: 0, lateralM: 0 },
    lineOffsetM: 0,
    expectedStrokes: e,
    pFairway: 0,
    pGreen: 0.55,
    pHazardByKind: { water: 0.31 },
    pOb: 0,
    pPenalty: 0.31,
    expectedRemainingM: 10,
    meanLanding: PIN,
    ...extra,
  };
}

function snapshot(chosen: SnapshotOption, best: SnapshotOption): RecommendationSnapshot {
  return {
    engineVersions: { strategy: 1, conditionModel: 1, dispersion: 1 },
    inputsHash: 'abcd1234',
    options: [best, chosen],
    baseline: chosen,
    chosen,
    savedVsBaseline: chosen.expectedStrokes - best.expectedStrokes,
  };
}

const pattern = fitPattern([], {
  prior: priorFor({ kind: 'iron', loftDeg: 30, stockTotalM: 150 }),
});

describe('round review', () => {
  const graded = [
    shot({
      seq: 1,
      clubId: '7i',
      sg: -0.4,
      sgCategory: 'app',
      strategyLoss: 0.2,
      executionLoss: -0.3,
      decisionGrade: 'poor',
      executionGrade: 'poor',
      recommendation: snapshot(
        option('7i', 3.1),
        option('6i', 2.9, {
          aimOffsetM: { alongM: 0, lateralM: -11 },
          pHazardByKind: { water: 0.06 },
        }),
      ),
    }),
    shot({
      seq: 2,
      clubId: 'putter',
      lie: 'green',
      sg: 0.1,
      sgCategory: 'putt',
      strategyLoss: 0,
      executionLoss: 0.1,
      decisionGrade: 'good',
      executionGrade: 'good',
    }),
    shot({ seq: 3, holeNumber: 2, sg: null }),
  ];

  it('detects grading and summarises decisions', () => {
    expect(isRoundGraded(graded)).toBe(true);
    expect(isRoundGraded([shot({ seq: 1 })])).toBe(false);
    expect(gradedShots(graded)).toHaveLength(2);
    const d = decisionSummary(graded);
    expect(d.matrix).toEqual({
      goodDecisionGoodExecution: 1,
      goodDecisionPoorExecution: 0,
      poorDecisionGoodExecution: 0,
      poorDecisionPoorExecution: 1,
    });
    expect(d.totals.strategyLoss).toBeCloseTo(0.2);
    expect(d.mostExpensive[0]!.shot.shot.id).toBe('s1-1');
  });

  it('explains a decision from its snapshot', () => {
    const [g] = gradedShots(graded);
    const lines = explainDecision(g!, '7i');
    expect(lines[0]).toBe('Chose 7i — aim at the pin. 55 % green, 31 % water, same as at the pin.');
    expect(lines[1]).toMatch(/^Best: 6i — aim 12 yds left of pin\. 55 % green, 6 % water/);
    expect(lines[1]).toContain('(0.20 strokes better than the choice)');
    expect(lines[2]).toBe('Execution: 0.30 strokes worse than the pattern expected (bottom 20 %).');
    const bare = explainDecision(gradedShots(graded)[1]!, 'Putter');
    expect(bare).toEqual([
      'Putter — no recommendation snapshot.',
      'Execution: 0.10 strokes better than the pattern expected.',
    ]);
  });

  it('sums strokes gained by category and club', () => {
    const sg = roundSg(graded);
    expect(sg.total).toBeCloseTo(-0.3);
    expect(sg.byCategory.app).toBeCloseTo(-0.4);
    expect(sg.byClub['7i']).toEqual({ sg: -0.4, count: 1 });
  });

  it('builds the scorecard with out/in/total', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: 4,
      strokeIndex: i + 1,
      yardageM: 300,
    }));
    const scores = [
      {
        roundId: 'r',
        holeNumber: 1,
        strokesLogged: 5,
        strokesOverride: null,
        overrideReason: null,
        putts: 2,
        penalties: 0,
        points: 2,
        netStrokes: 4,
      },
      {
        roundId: 'r',
        holeNumber: 10,
        strokesLogged: 5,
        strokesOverride: 4,
        overrideReason: 'x',
        putts: 1,
        penalties: 1,
        points: 3,
        netStrokes: 3,
      },
    ];
    const t = scorecardTable(holes, scores, graded);
    expect(t.rows[0]).toMatchObject({ strokes: 5, putts: 2, sg: expect.closeTo(-0.3) });
    expect(t.rows[9]).toMatchObject({ strokes: 4, penalties: 1 });
    expect(t.rows[1]!.strokes).toBeNull();
    expect(t.totals.map((x) => x.label)).toEqual(['Out', 'In', 'Total']);
    expect(t.totals[2]).toMatchObject({
      par: 72,
      yardageM: 5400,
      strokes: null,
      putts: 3,
      points: 5,
    });
    expect(scorecardTable(holes.slice(0, 9), [], []).totals).toHaveLength(1);
  });
});

describe('replay', () => {
  const s = shot({
    seq: 1,
    clubId: '7i',
    start: TEE,
    end: { lat: 53.40135, lng: -6.8999 },
    target: PIN,
  });

  it('takes the aim from the snapshot, else the target', () => {
    expect(shotAim(s)).toEqual(PIN);
    const aim = { lat: 53.401, lng: -6.9001 };
    expect(
      shotAim({ ...s, recommendation: snapshot(option('7i', 3, { aim }), option('7i', 3)) }),
    ).toEqual(aim);
  });

  it('re-derives the 80 % ellipse around the pattern mean on the aim line', () => {
    const ring = shotEllipse(s, pattern)!;
    expect(ring.length).toBe(48 + 3);
    const bearing = initialBearingDeg(TEE, PIN);
    const frame = ring.map((p) => toClubFrame(TEE, bearing, p));
    const meanAlong = frame.reduce((t, p) => t + p.alongM, 0) / frame.length;
    expect(Math.abs(meanAlong - pattern.distance.mean)).toBeLessThan(3);
    expect(shotEllipse({ ...s, lie: 'green' }, pattern)).toBeNull();
    expect(shotEllipse(s, null)).toBeNull();
  });

  it('centres the ellipse on the snapshot mean landing', () => {
    const landing = { lat: 53.4012, lng: -6.9 };
    const withSnap = {
      ...s,
      recommendation: snapshot(option('7i', 3, { meanLanding: landing }), option('7i', 3)),
    };
    const ring = shotEllipse(withSnap, {
      ...pattern,
      lateral: { ...pattern.lateral, sd_left: 5, sd_right: 5 },
      rho: 0,
    })!;
    const bearing = initialBearingDeg(TEE, PIN);
    const frame = ring.map((p) => toClubFrame(TEE, bearing, p));
    const m = toClubFrame(TEE, bearing, landing);
    const along = frame.map((p) => p.alongM);
    expect((Math.max(...along) + Math.min(...along)) / 2).toBeCloseTo(m.alongM, 0);
  });

  it('builds the hole collection and its bounds', () => {
    const fc = holeReplayCollection([s], {
      patterns: new Map([['7i', pattern]]),
      clubName: (id) => id ?? '',
    });
    expect(fc.features.map((f) => f.properties?.layer)).toEqual([
      'ellipse',
      'aim-line',
      'aim',
      'shot',
      'start',
      'end',
    ]);
    const b = collectionBounds(fc)!;
    expect(b[0][1]).toBeLessThanOrEqual(TEE.lat);
    expect(collectionBounds({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});

describe('trends', () => {
  const rounds = [
    {
      roundId: 'b',
      date: '2026-05-02',
      shots: [{ sg: -1, sgCategory: 'ott' as const, clubId: 'd' }],
    },
    {
      roundId: 'a',
      date: '2026-05-01',
      shots: [{ sg: 1, sgCategory: 'app' as const, clubId: '7i' }],
    },
    { roundId: 'c', date: '2026-05-03', shots: [{ sg: null, sgCategory: null, clubId: null }] },
  ];

  it('orders rounds, skips ungraded ones and rolls the windows', () => {
    const series = roundSgSeries(rounds);
    expect(series.map((s) => s.roundId)).toEqual(['a', 'b']);
    const [w5] = rollingSgSeries(series, [5]);
    expect(w5!.points[1]).toMatchObject({ n: 2, total: 0, roundId: 'b' });
    expect(w5!.points[1]!.byCategory.ott).toBeCloseTo(-0.5);
  });

  it('averages scores per hole', () => {
    const avg = holeScoringAverages([
      { holeNumber: 2, par: 3, strokes: 4 },
      { holeNumber: 1, par: 4, strokes: 4 },
      { holeNumber: 1, par: 4, strokes: 6 },
      { holeNumber: 1, par: 4, strokes: 0 },
    ]);
    expect(avg).toEqual([
      { holeNumber: 1, par: 4, n: 2, average: 5, toPar: 1, parOrBetter: 0.5 },
      { holeNumber: 2, par: 3, n: 1, average: 4, toPar: 1, parOrBetter: 0 },
    ]);
  });

  it('compares tee clubs on par 4 and 5', () => {
    const rec = (chosen: string, first: string) =>
      snapshot(option(chosen, 4.1, { kind: 'layup' }), option(first, 4.0, { kind: 'layup' }));
    const tee = [
      {
        holeNumber: 1,
        par: 4,
        clubId: 'd',
        sg: -0.2,
        resultSurface: 'rough',
        penalty: 'none',
        observedDistanceM: 230,
        recommendation: rec('d', '5w'),
      },
      {
        holeNumber: 2,
        par: 4,
        clubId: 'd',
        sg: 0.4,
        resultSurface: 'fairway',
        penalty: 'none',
        observedDistanceM: 240,
        recommendation: rec('d', 'd'),
      },
      {
        holeNumber: 3,
        par: 5,
        clubId: '4h',
        sg: null,
        resultSurface: 'fairway',
        penalty: 'none',
        observedDistanceM: null,
        recommendation: null,
      },
      {
        holeNumber: 4,
        par: 3,
        clubId: '7i',
        sg: 0,
        resultSurface: 'green',
        penalty: 'none',
        observedDistanceM: 150,
        recommendation: null,
      },
    ];
    const groups = teeStrategy(tee);
    expect(groups.map((g) => g.par)).toEqual([4, 5]);
    const [d, w] = groups[0]!.clubs;
    expect(d).toMatchObject({
      clubId: 'd',
      n: 2,
      fairwayRate: 0.5,
      meanDistanceM: 235,
      engineFirst: 1,
      meanExpected: 4.1,
    });
    expect(d!.meanSg).toBeCloseTo(0.1);
    expect(w).toMatchObject({ clubId: '5w', n: 0, meanSg: null, engineFirst: 1 });
    expect(groups[1]!.clubs[0]).toMatchObject({ clubId: '4h', meanSg: null, meanDistanceM: null });
    const byHole = teeStrategyByHole(tee);
    expect(byHole.map((h) => [h.holeNumber, h.par, h.shots])).toEqual([
      [1, 4, 1],
      [2, 4, 1],
      [3, 5, 1],
    ]);
    expect(byHole[0]!.clubs.map((c) => [c.clubId, c.n, c.engineFirst])).toEqual([
      ['d', 1, 0],
      ['5w', 0, 1],
    ]);
  });

  it('builds the WHS ledger and flags the counting differentials', () => {
    const diffs = [12.1, 15.0, 9.8, 20.2, 11.0, 14.3];
    const input: LedgerInput[] = diffs.map((d, i) => ({
      roundId: `r${String(i)}`,
      date: `2026-04-${String(10 + i)}`,
      differential: d,
      courseName: 'Moyvalley',
      adjustedGross: 90,
    }));
    input.push({ ...input[0]!, roundId: 'nodiff', differential: null });
    const ledger = whsLedger(input);
    expect(ledger.entries.map((e) => e.roundId)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1', 'r0']);
    // 6 scores: lowest 2, adjustment −1.
    expect(
      ledger.entries
        .filter((e) => e.counts)
        .map((e) => e.differential)
        .sort(),
    ).toEqual([11.0, 9.8].sort());
    expect(ledger.index).toMatchObject({ index: 9.4, used: 2, adjustment: -1 });
    expect(whsLedger(input.slice(0, 2)).index).toBeNull();
    expect(whsLedger(input.slice(0, 2)).entries.every((e) => !e.counts)).toBe(true);
  });
});

describe('dispersion page', () => {
  const row = (p: Partial<PatternShotRow>): PatternShotRow => ({
    shot_id: 'x',
    club_id: '7i',
    source: 'sim',
    lie: null,
    penalty: 'none',
    strike: 'good',
    reconstructed: false,
    end_accuracy_m: null,
    played_at: '2026-01-01T00:00:00Z',
    conditions: null,
    target_bearing_deg: null,
    neutral_distance_m: null,
    neutral_lateral_m: null,
    observed_distance_m: null,
    observed_lateral_m: null,
    sim_total_m: 150,
    sim_offline_m: -4,
    ...p,
  });

  it('maps sim and course rows to neutral scatter points', () => {
    const pts = scatterPoints([
      row({}),
      row({
        shot_id: 'c',
        source: 'course',
        neutral_distance_m: 140,
        neutral_lateral_m: 3,
        strike: 'thin',
      }),
      row({
        shot_id: 'p',
        source: 'course',
        lie: 'green',
        neutral_distance_m: 5,
        neutral_lateral_m: 0,
      }),
      row({ shot_id: 'pen', penalty: 'ob' }),
      row({ shot_id: 'none', sim_total_m: null }),
    ]);
    expect(pts.map((p) => [p.id, p.source, p.alongM, p.lateralM, p.good])).toEqual([
      ['x', 'sim', 150, -4, true],
      ['c', 'course', 140, 3, false],
    ]);
  });

  it('draws nested contours and a fitting extent', () => {
    const c = patternContours(pattern, 32);
    expect(c.map((x) => x.level)).toEqual([1, 0.8, 0.95]);
    const width = (ring: { lateralM: number }[]) =>
      Math.max(...ring.map((p) => p.lateralM)) - Math.min(...ring.map((p) => p.lateralM));
    expect(width(c[2]!.ring)).toBeGreaterThan(width(c[0]!.ring));
    const ext = scatterExtent(
      [{ alongM: 150, lateralM: -30 }],
      c.map((x) => x.ring),
    );
    expect(ext.lateral[0]).toBeLessThanOrEqual(-33);
    expect(ext.along[1]).toBeGreaterThan(150);
    expect(scatterExtent([], [])).toEqual({ along: [0, 100], lateral: [-20, 20] });
  });

  it('labels condition buckets', () => {
    expect(bucketLabel('first_cut|h:+1..4|c:-4..-1')).toEqual({
      lie: 'first cut',
      head: 'head 1–4',
      cross: 'R→L 1–4',
    });
    expect(bucketLabel('odd')).toEqual({ lie: 'odd', head: '—', cross: '—' });
  });
});
