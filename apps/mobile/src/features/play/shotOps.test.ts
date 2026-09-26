import { newShot, type Shot } from '@caddymate/api';
import { FLAT_STANCE, haversineDistanceM, type RecommendationSnapshot } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { at, PIN, TEE } from '@/test/fixtures';
import {
  ballHere,
  ballPosition,
  buildConditions,
  deleteShot,
  hit,
  holed,
  insertShot,
  isHoled,
  lastShotStart,
  moveEnd,
  moveStart,
  ordered,
  pendingShot,
  penalty,
  putt,
  reliefOptions,
  updateShot,
  type CardFields,
} from './shotOps';

const base = { userId: 'u', roundId: 'r', holeNumber: 1 };
const weather = {
  windSpeedMps: 4,
  windFromDeg: 270,
  gustMps: 7,
  tempC: 14,
  pressureHpa: 1005,
  fetchedAt: '2026-09-25T10:00:00Z',
  source: 'edge:current',
};
const card = (over: Partial<CardFields> = {}): CardFields => ({
  clubId: '7i',
  lie: 'tee',
  slope: FLAT_STANCE,
  target: at(150),
  targetBearingDeg: 0,
  targetRef: null,
  intendedShape: null,
  conditions: buildConditions(weather, null, 0, 101.234, null),
  slopeSuggested: { ...FLAT_STANCE, uphill: 'mild' },
  ...over,
});
const fix = (p = TEE, altitudeM: number | null = 120) => ({
  point: p,
  accuracyM: 3,
  altitudeM,
  at: 0,
});

describe('shotOps', () => {
  it('snapshots conditions with head/cross along the line and rounded elevations', () => {
    const c = buildConditions(weather, null, 0, 101.234, 99.999)!;
    expect(c).toMatchObject({
      wind_speed_ms: 4,
      wind_head_ms: 0,
      wind_cross_ms: 4,
      elevation_start_m: 101.23,
      elevation_end_m: 100,
      override: false,
    });
    expect(buildConditions(null, null, 0, null)).toBeNull();
  });

  it('stores the recommendation snapshot and slope suggestion at Hit', () => {
    const snap = { inputsHash: 'abcd1234' } as RecommendationSnapshot;
    const [s] = hit([], base, card(), fix(), snap);
    expect(s!.recommendation).toBe(snap);
    expect(s!.slopeSuggested?.uphill).toBe('mild');
    expect(hit([], base, card(), fix())[0]!.recommendation).toBeNull();
  });

  it('records the end elevation at Ball here', () => {
    const shots = hit([], base, card(), fix());
    const { shots: after } = ballHere(shots, base, card(), fix(at(148), 118), null, 118.456);
    expect(after[0]!.end).toEqual(at(148));
    expect(after[0]!.conditions?.elevation_start_m).toBe(101.23);
    expect(after[0]!.conditions?.elevation_end_m).toBe(118.46);
  });
});

describe('buildConditions', () => {
  it('prefers the manual override and flags it', () => {
    const c = buildConditions(weather, { speedMps: 6, fromDeg: 180 }, 0, null)!;
    // Wind from the south on a line due north: all tail (negative head), no cross.
    expect(c.wind_speed_ms).toBe(6);
    expect(c.wind_dir_deg).toBe(180);
    expect(c.wind_head_ms).toBeCloseTo(-6, 6);
    expect(Math.abs(c.wind_cross_ms!)).toBeLessThan(1e-9);
    expect(c.override).toBe(true);
    expect(c.gust_ms).toBe(7);
    expect(c.elevation_start_m).toBeNull();
  });

  it('works from an override alone with standard-atmosphere defaults', () => {
    const c = buildConditions(null, { speedMps: 3, fromDeg: 0 }, 0, 50)!;
    expect(c).toMatchObject({
      temp_c: 20,
      pressure_hpa: 1013.25,
      gust_ms: null,
      wind_head_ms: 3,
      elevation_start_m: 50,
    });
  });

  it('leaves head/cross null without a line', () => {
    const c = buildConditions(weather, null, null, null)!;
    expect(c.wind_head_ms).toBeNull();
    expect(c.wind_cross_ms).toBeNull();
    expect(c.temp_c).toBe(14);
    expect(c.pressure_hpa).toBe(1005);
  });
});

describe('penalty relief (§5.4)', () => {
  it('offers only stroke-and-distance for OB', () => {
    expect(reliefOptions('ob')).toEqual([{ label: 'Stroke & distance', drop: 'stroke-distance' }]);
  });

  it('offers a GPS drop and a map tap for penalty areas and unplayable', () => {
    for (const kind of ['lateral', 'yellow', 'unplayable'] as const) {
      const drops = reliefOptions(kind).map((o) => o.drop);
      expect(drops).toEqual(['stroke-distance', 'gps', null]);
    }
    expect(reliefOptions('yellow')[1]!.label).toMatch(/^Back-on-line/);
    expect(reliefOptions('lateral')[1]!.label).toMatch(/^Lateral/);
  });

  it('records a one-stroke penalty record ending at the drop', () => {
    const shots = hit([], base, card(), fix());
    const { shots: s1 } = ballHere(shots, base, card(), fix(at(260, 40)), null);
    const drop = at(255, 20);
    const next = penalty(s1, base, 'lateral', drop);
    const p = next.at(-1)!;
    expect(next).toHaveLength(2);
    expect(p).toMatchObject({
      clubId: null,
      penalty: 'lateral',
      strokeCount: 1,
      end: drop,
      lie: null,
      seq: 2,
    });
    // The ball is now at the drop.
    expect(ballPosition(next, TEE)).toEqual(drop);
  });

  it('finds the stroke-and-distance spot past penalty records', () => {
    expect(lastShotStart([])).toBeNull();
    let shots = hit([], base, card(), fix());
    shots = ballHere(shots, base, card(), fix(at(240)), null).shots;
    shots = hit(shots, base, card({ lie: 'fairway' }), fix(at(240)));
    shots = ballHere(shots, base, card(), fix(at(380, 30)), null).shots;
    shots = penalty(shots, base, 'ob', at(240));
    expect(lastShotStart(shots)).toEqual(at(240));
  });
});

describe('reconstruction (§5.6)', () => {
  it('Ball here without Hit starts the first shot at the tee, flagged', () => {
    const { shots, shotId } = ballHere([], base, card(), fix(at(230)), TEE);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      id: shotId,
      seq: 1,
      start: TEE,
      end: at(230),
      reconstructed: true,
      clubId: '7i',
    });
  });

  it('a later reconstructed shot leaves start to the chain (null)', () => {
    const first = ballHere([], base, card(), fix(at(230)), TEE).shots;
    const { shots } = ballHere(first, base, card({ lie: 'fairway' }), fix(at(360)), TEE);
    expect(shots[1]).toMatchObject({ seq: 2, start: null, end: at(360), reconstructed: true });
    expect(pendingShot(shots)).toBeNull();
  });

  it('Holed ends the pending shot, or reconstructs a holed shot', () => {
    const pending = hit([], base, card(), fix());
    expect(pendingShot(pending)?.id).toBe(pending[0]!.id);
    const done = holed(pending, base, card(), TEE);
    expect(done).toHaveLength(1);
    expect(done[0]!.holed).toBe(true);
    expect(isHoled(done)).toBe(true);
    expect(pendingShot(done)).toBeNull();

    // Hit → Ball here → Holed = 2 strokes (the Maestro smoke flow).
    let flow = hit([], base, card(), fix());
    flow = ballHere(flow, base, card(), fix(at(10)), TEE).shots;
    flow = holed(flow, base, card(), TEE);
    expect(flow).toHaveLength(2);
    expect(flow[1]).toMatchObject({ seq: 2, holed: true, reconstructed: true, start: null });

    const ace = holed([], base, card(), TEE);
    expect(ace[0]).toMatchObject({ start: TEE, holed: true, reconstructed: true });
  });

  it('ballPosition falls back through end, start and the tee', () => {
    expect(ballPosition([], TEE)).toEqual(TEE);
    expect(ballPosition([], null)).toBeNull();
    const pending = hit([], base, card(), fix(at(5)));
    expect(ballPosition(pending, TEE)).toEqual(at(5));
    const blank = [newShot({ id: 'x', ...base, seq: 1 })];
    expect(ballPosition(blank, TEE)).toEqual(TEE);
  });

  it('Ball here keeps conditions untouched without an end elevation', () => {
    const shots = hit([], base, card({ conditions: null }), fix());
    const { shots: after } = ballHere(shots, base, card(), fix(at(150)), null, 110);
    expect(after[0]!.conditions).toBeNull();
  });
});

describe('putt', () => {
  const onGreen = () => {
    const s = hit([], base, card(), fix());
    return ballHere(s, base, card(), fix(at(360)), null).shots;
  };
  const args = {
    clubId: 'pt',
    distanceM: 10,
    remainingM: 1,
    pin: PIN,
    fix: null,
    slope: FLAT_STANCE,
  };

  it('holes out with no end point and zero remaining', () => {
    const next = putt(onGreen(), base, { ...args, result: 'holed' });
    expect(next.at(-1)).toMatchObject({
      lie: 'green',
      holed: true,
      end: null,
      puttRemainingM: 0,
      puttDistanceM: 10,
      target: PIN,
    });
  });

  it('places a miss on the start–pin line, short or past', () => {
    const from = at(360);
    const short = putt(onGreen(), base, { ...args, result: 'short' }).at(-1)!;
    const past = putt(onGreen(), base, { ...args, result: 'past' }).at(-1)!;
    expect(haversineDistanceM(short.end!, PIN)).toBeCloseTo(1, 3);
    expect(haversineDistanceM(past.end!, PIN)).toBeCloseTo(1, 3);
    // Short is between the ball and the pin; past is beyond it.
    expect(haversineDistanceM(from, short.end!)).toBeCloseTo(9, 1);
    expect(haversineDistanceM(from, past.end!)).toBeCloseTo(11, 1);
    expect(short.puttRemainingM).toBe(1);
  });

  it('ends a pending approach where the player stands', () => {
    const pending = hit([], base, card(), fix());
    const next = putt(pending, base, {
      ...args,
      result: 'holed',
      fix: { point: at(365), accuracyM: 2, altitudeM: null, at: 0 },
    });
    expect(next[0]!.end).toEqual(at(365));
    expect(next[0]!.endAccuracyM).toBe(2);
    expect(next).toHaveLength(2);
  });

  it('cannot place a miss without a pin', () => {
    const next = putt(onGreen(), base, { ...args, result: 'short', pin: null });
    expect(next.at(-1)!.end).toBeNull();
  });
});

describe('editing', () => {
  const three = (): Shot[] => {
    let s = hit([], base, card(), fix());
    s = ballHere(s, base, card(), fix(at(230)), null).shots;
    s = hit(s, base, card({ lie: 'fairway' }), fix(at(230)));
    s = ballHere(s, base, card(), fix(at(350)), null).shots;
    return holed(s, base, card({ lie: 'green' }), TEE);
  };

  it('moving a start moves the previous end with it (shared chain)', () => {
    const s = three();
    const id = ordered(s)[1]!.id;
    const p = at(225, 5);
    const next = ordered(moveStart(s, id, p));
    expect(next[1]!.start).toEqual(p);
    expect(next[0]!.end).toEqual(p);
    expect(moveStart(s, 'nope', p)).toEqual(s);
  });

  it('moving an end un-holes the shot and moves the next start', () => {
    const s = three();
    const [a, b] = ordered(s);
    const p = at(235, -4);
    const next = ordered(moveEnd(s, a!.id, p));
    expect(next[0]!.end).toEqual(p);
    expect(next[1]!.start).toEqual(p);
    expect(next[1]!.id).toBe(b!.id);
    const last = ordered(s).at(-1)!;
    expect(ordered(moveEnd(s, last.id, PIN)).at(-1)!.holed).toBe(false);
    expect(moveEnd(s, 'nope', p)).toEqual(s);
  });

  it('inserts a blank reconstructed shot either side, ordered by time', () => {
    const s = three().map((x, i) => ({ ...x, playedAt: `2026-09-26T10:0${String(i)}:00.000Z` }));
    const ref = s[1]!;
    const before = insertShot(s, base, ref.id, 'before', '9i');
    const after = insertShot(s, base, ref.id, 'after', null);
    const ob = ordered(before.shots).map((x) => x.id);
    const oa = ordered(after.shots).map((x) => x.id);
    expect(ob.indexOf(before.shotId)).toBe(ob.indexOf(ref.id) - 1);
    expect(oa.indexOf(after.shotId)).toBe(oa.indexOf(ref.id) + 1);
    expect(before.shots.find((x) => x.id === before.shotId)).toMatchObject({
      seq: ref.seq,
      clubId: '9i',
      reconstructed: true,
    });
    expect(insertShot(s, base, 'nope', 'after', null)).toEqual({ shots: s, shotId: '' });
  });

  it('updates and deletes by id', () => {
    const s = three();
    const id = s[0]!.id;
    expect(updateShot(s, { ...s[0]!, strike: 'fat' })[0]!.strike).toBe('fat');
    expect(deleteShot(s, id).map((x) => x.id)).not.toContain(id);
    expect(deleteShot(s, id)).toHaveLength(2);
  });
});
