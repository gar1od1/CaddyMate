import { DISPERSION_ENGINE_VERSION, destinationPoint, type LatLng } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import {
  bucketKeyForRow,
  effectivePattern,
  fitAndStoreClubPattern,
  getClubPatterns,
  listClubConditionPatterns,
  loadPatternShots,
  normaliseAndStoreShot,
  patternShotFromRow,
  type PatternShotRow,
} from './patterns.js';
import { newShot } from './shots.js';
import { FakeDb, type Rec } from './testing/fakeDb.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const USER = 'user-1';
const CLUB = 'club-7i';

let n = 0;
function row(p: Partial<PatternShotRow>): PatternShotRow {
  return {
    shot_id: `s${String(++n)}`,
    club_id: CLUB,
    source: 'course',
    lie: 'fairway',
    penalty: 'none',
    strike: 'good',
    reconstructed: false,
    end_accuracy_m: 4,
    played_at: new Date(NOW).toISOString(),
    conditions: null,
    target_bearing_deg: 0,
    neutral_distance_m: 145,
    neutral_lateral_m: 2,
    observed_distance_m: 140,
    observed_lateral_m: 5,
    sim_total_m: null,
    sim_offline_m: null,
    ...p,
  };
}

const conditions = (head: number | null, cross: number | null, speed = 0, dir = 0) => ({
  wind_speed_ms: speed,
  wind_dir_deg: dir,
  gust_ms: null,
  temp_c: 15,
  pressure_hpa: 1010,
  elevation_start_m: null,
  elevation_end_m: null,
  wind_head_ms: head,
  wind_cross_ms: cross,
  override: false,
});

describe('patternShotFromRow', () => {
  it('maps a course shot to its neutral (or observed) club-frame result', () => {
    const r = row({ conditions: conditions(2.5, -3) });
    expect(patternShotFromRow(r)).toEqual({
      alongM: 145,
      lateralM: 2,
      playedAt: NOW,
      source: 'course',
      strike: 'good',
      penalty: 'none',
      isPutt: false,
      reconstructed: false,
      endAccuracyM: 4,
      bucketKey: 'fairway|h:+1..4|c:-4..-1',
    });
    expect(patternShotFromRow(r, 'observed')).toMatchObject({ alongM: 140, lateralM: 5 });
  });

  it('maps a sim shot from total / offline into the calm fairway bucket', () => {
    const r = row({
      source: 'sim',
      lie: null,
      neutral_distance_m: null,
      observed_distance_m: null,
      sim_total_m: 151.2,
      sim_offline_m: -4.1,
      end_accuracy_m: null,
    });
    const s = patternShotFromRow(r)!;
    expect(s).toMatchObject({ alongM: 151.2, lateralM: -4.1, source: 'sim' });
    expect(s.bucketKey).toBe('fairway|h:-1..1|c:-1..1');
    expect('endAccuracyM' in s).toBe(false);
    expect(patternShotFromRow(r, 'observed')).toMatchObject({ alongM: 151.2 });
  });

  it('carries the exclusion flags and skips rows without a result', () => {
    expect(patternShotFromRow(row({ lie: 'green' }))?.isPutt).toBe(true);
    expect(patternShotFromRow(row({ penalty: 'ob', strike: 'shank' }))).toMatchObject({
      penalty: 'ob',
      strike: 'shank',
    });
    expect(patternShotFromRow(row({ neutral_distance_m: null }))).toBeNull();
    expect(patternShotFromRow(row({ played_at: 'nope' }))).toBeNull();
  });

  it('derives the bucket from speed/direction when head/cross were not stored', () => {
    // Playing north (bearing 0) into a 5 m/s northerly → head +5, cross 0.
    expect(bucketKeyForRow(row({ lie: 'rough', conditions: conditions(null, null, 5, 0) }))).toBe(
      'rough|h:+4..|c:-1..1',
    );
    expect(bucketKeyForRow(row({ conditions: null }))).toBe('fairway|h:-1..1|c:-1..1');
  });
});

/** 20 course shots into a light headwind + `sims` calm sim shots, all played "now". */
function seed(courseShots = 20, sims = 20): FakeDb {
  const shots: Rec[] = [];
  for (let i = 0; i < courseShots; i++) {
    shots.push({
      ...row({
        neutral_distance_m: 140 + (i % 5) * 2,
        neutral_lateral_m: (i % 7) - 3,
        observed_distance_m: 136 + (i % 5) * 2,
        observed_lateral_m: (i % 7) - 1,
        conditions: conditions(2, 0),
      }),
      user_id: USER,
    });
  }
  for (let i = 0; i < sims; i++) {
    shots.push({
      ...row({
        source: 'sim',
        lie: null,
        neutral_distance_m: null,
        observed_distance_m: null,
        sim_total_m: 145 + (i % 3),
        sim_offline_m: (i % 5) - 2,
      }),
      user_id: USER,
    });
  }
  // One mishit and one putt that must not count in the main pattern.
  shots.push({ ...row({ strike: 'fat', neutral_distance_m: 90 }), user_id: USER });
  shots.push({ ...row({ lie: 'green', neutral_distance_m: 3 }), user_id: USER });
  // Another club's shot.
  shots.push({ ...row({ club_id: 'other', neutral_distance_m: 230 }), user_id: USER });
  return new FakeDb({
    shots,
    clubs: [
      {
        club_id: CLUB,
        user_id: USER,
        kind: 'iron',
        loft_deg: 30.5,
        stock_total_m: 146.3,
        name: '7i',
      },
    ],
  });
}

describe('fitAndStoreClubPattern', () => {
  it('loads only the club’s shots', async () => {
    const db = seed();
    const shots = await loadPatternShots(db.asDb(), CLUB);
    expect(shots).toHaveLength(42);
    expect(shots.every((s) => s.alongM < 200)).toBe(true);
  });

  it('fits with prior + recency, stores and reads back the pattern and buckets', async () => {
    const db = seed();
    const fitted = await fitAndStoreClubPattern(db.asDb(), USER, CLUB, { now: NOW });
    expect(fitted).not.toBeNull();
    const p = fitted!.pattern;
    expect(p.nRaw).toBe(40);
    expect(p.nEffective).toBeCloseTo(40, 5);
    expect(p.confidence).toBe('established');
    expect(p.params.n_sim).toBe(20);
    expect(p.params.n_course).toBe(20);
    expect(p.params.miss.p_miss).toBeGreaterThan(0);
    // Posterior mean between the prior (146.3) and the data (~144–146).
    expect(p.params.distance.mean).toBeGreaterThan(143);
    expect(p.params.distance.mean).toBeLessThan(147);

    const stored = db.table('club_patterns');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      user_id: USER,
      club_id: CLUB,
      confidence: 'established',
      n_raw: 40,
      engine_version: DISPERSION_ENGINE_VERSION,
    });

    // Both buckets have 20 ≥ 15 shots: calm fairway (sim) and light headwind (course).
    const buckets = fitted!.conditionPatterns.map((b) => b.bucketKey).sort();
    expect(buckets).toEqual(['fairway|h:+1..4|c:-1..1', 'fairway|h:-1..1|c:-1..1']);
    const course = fitted!.conditionPatterns.find((b) => b.bucketKey.includes('+1..4'))!;
    // Empirical OBSERVED dispersion, no prior: mean of 136..144.
    expect(course.params.distance.mean).toBeCloseTo(140, 5);
    expect(course.params.confidence).toBe('forming');

    const map = await getClubPatterns(db.asDb());
    expect([...map.keys()]).toEqual([CLUB]);
    expect(map.get(CLUB)!.distance.mean).toBeCloseTo(p.params.distance.mean, 9);
    expect(await listClubConditionPatterns(db.asDb(), CLUB)).toHaveLength(2);
  });

  it('upserts in place and removes buckets that fall below the threshold', async () => {
    const db = seed();
    await fitAndStoreClubPattern(db.asDb(), USER, CLUB, { now: NOW });
    // Drop most course shots; refit.
    db.tables.shots = db.table('shots').filter((s, i) => s.source === 'sim' || i < 5);
    const again = await fitAndStoreClubPattern(db.asDb(), USER, CLUB, { now: NOW });
    expect(db.table('club_patterns')).toHaveLength(1);
    expect(again!.conditionPatterns.map((b) => b.bucketKey)).toEqual(['fairway|h:-1..1|c:-1..1']);
    expect(db.table('club_condition_patterns').map((r) => r.bucket_key)).toEqual([
      'fairway|h:-1..1|c:-1..1',
    ]);
  });

  it('seeds from the prior when there are no shots, and skips putters', async () => {
    const db = new FakeDb({ shots: [] });
    const fitted = await fitAndStoreClubPattern(db.asDb(), USER, CLUB, {
      club: { kind: 'iron', loftDeg: 30.5, stockTotalM: 146.3 },
      handicapIndex: 13,
    });
    expect(fitted!.pattern.confidence).toBe('seeded');
    expect(fitted!.pattern.params.distance.mean).toBeCloseTo(146.3, 9);
    expect(fitted!.conditionPatterns).toEqual([]);
    expect(
      await fitAndStoreClubPattern(db.asDb(), USER, 'putter', { club: { kind: 'putter' } }),
    ).toBeNull();
  });

  it('effectivePattern prefers the stored pattern, else the seeded prior', () => {
    const prior = effectivePattern({ kind: 'iron', stockTotalM: 150 }, null);
    expect(prior.confidence).toBe('seeded');
    expect(prior.distance.mean).toBe(150);
    expect(prior.distance.sd).toBeCloseTo(150 * 0.055, 9);
    expect(effectivePattern({ kind: 'iron', stockTotalM: 150 }, prior)).toBe(prior);
  });
});

describe('normaliseAndStoreShot', () => {
  const TEE: LatLng = { lat: 53.4245, lng: -6.9165 };

  it('writes the neutral result and model version for the shot', async () => {
    const shot = newShot({
      id: 'shot-1',
      userId: USER,
      roundId: 'r',
      holeNumber: 1,
      seq: 1,
      clubId: CLUB,
      start: TEE,
      end: destinationPoint(TEE, 0, 140),
      targetBearingDeg: 0,
      lie: 'rough',
    });
    const db = new FakeDb({ shots: [{ shot_id: 'shot-1', neutral_distance_m: null }] });
    const out = await normaliseAndStoreShot(db.asDb(), shot, {
      club: { kind: 'iron', loftDeg: 30 },
      handedness: 'R',
    });
    // Calm standard air: only the rough's 0.93 distance factor is divided out.
    expect(out.observedDistanceM).toBeCloseTo(140, 1);
    expect(out.neutralDistanceM).toBeCloseTo(140 / 0.93, 1);
    expect(out.conditionModelVersion).toBe(1);
    expect(db.table('shots')[0]).toMatchObject({
      neutral_distance_m: out.neutralDistanceM,
      neutral_lateral_m: out.neutralLateralM,
      condition_model_version: 1,
    });

    await expect(
      normaliseAndStoreShot(new FakeDb().asDb(), shot, {
        club: { kind: 'iron' },
        handedness: 'R',
      }),
    ).rejects.toThrow('not found');
  });
});
