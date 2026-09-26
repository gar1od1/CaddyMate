import { DEFAULT_CONDITION_MODEL, FLAT_STANCE, resolveConditionModel } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { currentConditions, playsLike } from './conditions';

const weather = {
  windSpeedMps: 5,
  windFromDeg: 0,
  gustMps: null,
  tempC: 20,
  pressureHpa: 1013.25,
  fetchedAt: '2026-09-25T10:00:00Z',
  source: 'edge:current',
};

describe('current conditions and plays like', () => {
  it('prefers the manual wind and goes flat without both grid heights', () => {
    const c = currentConditions(weather, { speedMps: 2, fromDeg: 90 }, 50, null);
    expect(c).toMatchObject({ windSpeedMps: 2, windFromDeg: 90, override: true });
    expect([c.elevationStartM, c.elevationEndM]).toEqual([0, 0]);
    expect(currentConditions(null, null, 50, 60)).toMatchObject({
      windSpeedMps: 0,
      tempC: 20,
      elevationStartM: 50,
      elevationEndM: 60,
    });
  });

  it('plays longer into the wind and uphill, equal in calm flat air', () => {
    const base = {
      bearingDeg: 0,
      club: { kind: 'iron' as const, loftDeg: 30 },
      lie: 'fairway' as const,
      slope: FLAT_STANCE,
      handedness: 'R' as const,
    };
    const calm = currentConditions(null, null, null, null);
    expect(playsLike(150, { ...base, conditions: calm })).toBeCloseTo(150, 9);
    expect(
      playsLike(150, { ...base, conditions: currentConditions(weather, null, null, null) })!,
    ).toBeGreaterThan(160);
    expect(
      playsLike(150, { ...base, conditions: currentConditions(null, null, 10, 20) })!,
    ).toBeCloseTo(159, 0);
    expect(playsLike(null, { ...base, conditions: calm })).toBeNull();
    expect(playsLike(150, { ...base, club: { kind: 'putter' }, conditions: calm })).toBeNull();
  });

  it('uses the player condition model when given (decision 007)', () => {
    const base = {
      bearingDeg: 0,
      club: { kind: 'iron' as const, loftDeg: 30 },
      lie: 'fairway' as const,
      slope: FLAT_STANCE,
      handedness: 'R' as const,
      conditions: currentConditions(weather, null, null, null),
    };
    const dflt = playsLike(150, base)!;
    expect(playsLike(150, { ...base, model: DEFAULT_CONDITION_MODEL })).toBe(dflt);
    const learned = resolveConditionModel({ wind: { headPerMps: 0.042 } });
    // 5 m/s into: air multiplier 1 − 0.042·5.
    expect(playsLike(150, { ...base, model: learned })).toBeCloseTo(150 / (1 - 0.21), 6);
    expect(playsLike(150, { ...base, model: learned })!).toBeGreaterThan(dflt);
  });
});
