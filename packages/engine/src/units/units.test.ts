import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  bearingDelta,
  degToRad,
  feetToMetres,
  knotsToMps,
  metresToFeet,
  metresToYards,
  mphToMps,
  mpsToMph,
  normaliseBearing,
  radToDeg,
  yardsToMetres,
} from './index.js';

describe('units', () => {
  it('converts known values', () => {
    expect(yardsToMetres(100)).toBeCloseTo(91.44, 6);
    expect(metresToYards(91.44)).toBeCloseTo(100, 6);
    expect(feetToMetres(10)).toBeCloseTo(3.048, 6);
    expect(metresToFeet(3.048)).toBeCloseTo(10, 6);
    expect(mphToMps(10)).toBeCloseTo(4.4704, 6);
    expect(mpsToMph(4.4704)).toBeCloseTo(10, 6);
    expect(knotsToMps(10)).toBeCloseTo(5.14444, 4);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
  });

  it('round-trips (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (v) => {
        expect(metresToYards(yardsToMetres(v))).toBeCloseTo(v, 6);
        expect(mpsToMph(mphToMps(v))).toBeCloseTo(v, 6);
        expect(radToDeg(degToRad(v))).toBeCloseTo(v, 6);
      }),
    );
  });

  it('normalises bearings into [0, 360)', () => {
    expect(normaliseBearing(0)).toBe(0);
    expect(normaliseBearing(360)).toBe(0);
    expect(normaliseBearing(-90)).toBe(270);
    expect(normaliseBearing(725)).toBe(5);
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (d) => {
        const n = normaliseBearing(d);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(360);
      }),
    );
  });

  it('bearingDelta is the signed smallest difference', () => {
    expect(bearingDelta(10, 20)).toBe(10);
    expect(bearingDelta(20, 10)).toBe(-10);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(-20);
    expect(bearingDelta(0, 180)).toBe(180);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (a, b) => {
          const d = bearingDelta(a, b);
          expect(d).toBeGreaterThan(-180);
          expect(d).toBeLessThanOrEqual(180);
        },
      ),
    );
  });
});
