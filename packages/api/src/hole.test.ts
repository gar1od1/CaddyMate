import { destinationPoint, haversineDistanceM, type LatLng } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { applyTally, holeStrokes, orderShots, recomputeHoleShots, tallyHole } from './hole.js';
import { newShot } from './shots.js';
import type { Shot } from './types.js';

const TEE: LatLng = { lat: 53.4245, lng: -6.9165 };
/** Hole plays due north, 380 m. */
const PIN = destinationPoint(TEE, 0, 380);
const at = (along: number, bearing = 0) => destinationPoint(TEE, bearing, along);

let n = 0;
const shot = (p: Partial<Shot>): Shot =>
  newShot({
    id: `s${String(++n)}`,
    userId: 'u',
    roundId: 'r',
    holeNumber: 1,
    seq: p.seq ?? n,
    clubId: 'club',
    playedAt: `2026-09-25T10:00:${String(n).padStart(2, '0')}Z`,
    ...p,
  });

describe('recomputeHoleShots', () => {
  it('renumbers seq and chains start = previous end', () => {
    const a = shot({ seq: 5, start: TEE, end: at(230), lie: 'tee' });
    const b = shot({ seq: 9, start: at(10), end: at(360) });
    const out = recomputeHoleShots([b, a], { pin: PIN });
    expect(out.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(out.map((s) => s.seq)).toEqual([1, 2]);
    expect(out[1]!.start).toEqual(a.end);
    // Inputs untouched.
    expect(b.start).toEqual(at(10));
  });

  it('back-fills a missing end from the next start (Ball here skipped)', () => {
    const a = shot({ seq: 1, start: TEE, end: null });
    const b = shot({ seq: 2, start: at(220), end: at(370) });
    const out = recomputeHoleShots([a, b], { pin: PIN });
    expect(out[0]!.end).toEqual(at(220));
    expect(out[0]!.observedDistanceM).toBeCloseTo(220, 0);
  });

  it('computes club-frame observed result against the intended line', () => {
    const target = at(250);
    // Finishes 230 m along, pushed 45° right of north: along ≈ 230·cos45, lateral ≈ +230·sin45.
    const s = shot({ start: TEE, end: at(230, 45), target, targetBearingDeg: null });
    const [out] = recomputeHoleShots([s], { pin: PIN });
    expect(out!.observedDistanceM).toBeCloseTo(230 * Math.SQRT1_2, 0);
    expect(out!.observedLateralM).toBeCloseTo(230 * Math.SQRT1_2, 0);
    expect(out!.distanceToPinBeforeM).toBeCloseTo(380, 0);
    expect(out!.distanceToPinAfterM).toBeCloseTo(haversineDistanceM(at(230, 45), PIN), 1);
  });

  it('uses the explicit bearing, else the pin, and skips shots without a line', () => {
    const left = shot({ start: TEE, end: at(100, 350), targetBearingDeg: 0 });
    const toPin = shot({ start: TEE, end: at(100, 10) });
    const [a] = recomputeHoleShots([left], { pin: null });
    expect(a!.observedLateralM).toBeLessThan(0);
    const [b] = recomputeHoleShots([toPin], { pin: PIN });
    expect(b!.observedLateralM).toBeGreaterThan(0);
    const [c] = recomputeHoleShots([shot({ start: TEE, end: at(50) })], { pin: null });
    expect(c!.observedDistanceM).toBeNull();
    expect(c!.distanceToPinBeforeM).toBeNull();
  });

  it('ends a holed shot at the pin and reports zero remaining', () => {
    const a = shot({ seq: 1, start: TEE, end: at(370) });
    const putt = shot({
      seq: 2,
      lie: 'green',
      holed: true,
      puttDistanceM: 3.2,
      puttRemainingM: null,
    });
    const out = recomputeHoleShots([a, putt], { pin: PIN, surfaceAt: () => 'rough' });
    expect(out[1]!.start).toEqual(at(370));
    expect(out[1]!.end).toEqual(PIN);
    expect(out[1]!.distanceToPinBeforeM).toBe(3.2);
    expect(out[1]!.distanceToPinAfterM).toBe(0);
    expect(out[1]!.resultSurface).toBe('green');
    expect(out[0]!.resultSurface).toBe('rough');
  });

  it('uses entered putt feet for missed putts', () => {
    const putt = shot({ lie: 'green', puttDistanceM: 6, puttRemainingM: 0.9 });
    const [out] = recomputeHoleShots([putt], { pin: PIN });
    expect(out!.distanceToPinBeforeM).toBe(6);
    expect(out!.distanceToPinAfterM).toBe(0.9);
  });

  it('keeps penalty records in the chain without an observed result', () => {
    const drive = shot({ seq: 1, start: TEE, end: at(200, 60) });
    const drop = at(190, 20);
    const pen = shot({ seq: 2, clubId: null, penalty: 'lateral', end: drop });
    const next = shot({ seq: 3, start: null, end: at(360) });
    const out = recomputeHoleShots([drive, pen, next], { pin: PIN });
    expect(out[1]!.start).toEqual(drive.end);
    expect(out[1]!.observedDistanceM).toBeNull();
    expect(out[2]!.start).toEqual(drop);
  });

  it('orders equal seqs by time then id (insert-before)', () => {
    const x = shot({ seq: 2, playedAt: '2026-09-25T10:00:05Z' });
    const y = shot({ seq: 2, playedAt: '2026-09-25T10:00:01Z' });
    expect(orderShots([x, y]).map((s) => s.id)).toEqual([y.id, x.id]);
  });
});

describe('tallyHole', () => {
  it('counts strokes, putts and penalty strokes', () => {
    const shots = [
      shot({ lie: 'tee' }),
      shot({ clubId: null, penalty: 'ob', strokeCount: 1 }),
      shot({ lie: 'fairway' }),
      shot({ lie: 'green' }),
      shot({ lie: 'green', holed: true }),
    ];
    expect(tallyHole(shots)).toEqual({ strokesLogged: 5, putts: 2, penalties: 1, holed: true });
    expect(tallyHole([])).toEqual({ strokesLogged: 0, putts: 0, penalties: 0, holed: false });
  });

  it('merges into a hole score keeping overrides', () => {
    const prev = {
      roundId: 'r',
      holeNumber: 3,
      strokesLogged: 4,
      strokesOverride: 6,
      overrideReason: 'lost a shot',
      putts: 1,
      penalties: 0,
      points: 1,
      netStrokes: 5,
    };
    const s = applyTally(prev, 'r', 3, { strokesLogged: 5, putts: 2, penalties: 1, holed: true });
    expect(s).toMatchObject({ strokesLogged: 5, strokesOverride: 6, putts: 2, penalties: 1 });
    expect(holeStrokes(s)).toBe(6);
    expect(holeStrokes(applyTally(null, 'r', 3, tallyHole([])))).toBe(0);
  });
});

describe('recomputeHoleShots — neutral results', () => {
  const iron = { kind: 'iron' as const, loftDeg: 30 };
  const calm = {
    wind_speed_ms: 0,
    wind_dir_deg: 0,
    gust_ms: null,
    temp_c: 20,
    pressure_hpa: 1013.25,
    elevation_start_m: null,
    elevation_end_m: null,
    wind_head_ms: 0,
    wind_cross_ms: 0,
    override: false,
  };

  it('leaves neutral fields alone without club context', () => {
    const s = shot({ start: TEE, end: at(150), neutralDistanceM: 1, conditions: calm });
    const [out] = recomputeHoleShots([s], { pin: PIN });
    expect(out!.neutralDistanceM).toBe(1);
  });

  it('equals observed in calm, flat, fairway conditions and is stamped', () => {
    const s = shot({ start: TEE, end: at(150), lie: 'fairway', conditions: calm });
    const [out] = recomputeHoleShots([s], { pin: PIN, clubFor: () => iron });
    expect(out!.neutralDistanceM).toBeCloseTo(out!.observedDistanceM!, 1);
    expect(out!.neutralLateralM).toBeCloseTo(out!.observedLateralM!, 1);
    expect(out!.conditionModelVersion).toBe(1);
  });

  it('adds distance back into a headwind and divides out the rough', () => {
    // Playing north into a 6 m/s northerly.
    const into = { ...calm, wind_speed_ms: 6, wind_dir_deg: 0 };
    const a = shot({ start: TEE, end: at(150), lie: 'fairway', conditions: into });
    const b = shot({ start: TEE, end: at(150), lie: 'rough', conditions: calm });
    const [na] = recomputeHoleShots([a], { pin: PIN, clubFor: () => iron });
    const [nb] = recomputeHoleShots([b], { pin: PIN, clubFor: () => iron });
    expect(na!.neutralDistanceM!).toBeGreaterThan(155);
    expect(nb!.neutralDistanceM!).toBeCloseTo(150 / 0.93, 0);
  });

  it('prefers grid elevations over GPS altitudes and writes them into conditions', () => {
    const gps = { ...calm, elevation_start_m: 100, elevation_end_m: 130 };
    const s = shot({ start: TEE, end: at(150), lie: 'fairway', conditions: gps });
    // GPS says +30 m uphill → neutral much longer than observed.
    const [viaGps] = recomputeHoleShots([s], { pin: PIN, clubFor: () => iron });
    expect(viaGps!.neutralDistanceM!).toBeGreaterThan(170);
    // A flat grid wins over the GPS altitudes.
    const [viaGrid] = recomputeHoleShots([s], {
      pin: PIN,
      clubFor: () => iron,
      elevationAt: () => 50,
    });
    expect(viaGrid!.neutralDistanceM).toBeCloseTo(viaGrid!.observedDistanceM!, 1);
    expect(viaGrid!.conditions?.elevation_start_m).toBe(50);
    expect(viaGrid!.conditions?.elevation_end_m).toBe(50);
  });

  it('gives putts, penalty records and putter shots no neutral result', () => {
    const putt = shot({ start: at(370), end: at(379), lie: 'green', conditions: calm });
    const pen = shot({ clubId: null, penalty: 'ob', start: at(379), end: at(379) });
    const out = recomputeHoleShots([putt, pen], {
      pin: PIN,
      clubFor: () => ({ kind: 'putter' }),
    });
    expect(out.map((s) => s.neutralDistanceM)).toEqual([null, null]);
    expect(out.map((s) => s.conditionModelVersion)).toEqual([null, null]);
  });
});
