import { FLAT_STANCE, type RecommendationSnapshot } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { at, TEE } from '@/test/fixtures';
import { ballHere, buildConditions, hit, type CardFields } from './shotOps';

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
