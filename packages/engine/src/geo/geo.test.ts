import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  bboxContains,
  bboxOf,
  destinationPoint,
  distanceToRingM,
  distanceToSegmentM,
  fromClubFrame,
  fromLocalXY,
  haversineDistanceM,
  initialBearingDeg,
  pointInPolygon,
  pointInRing,
  ringCentroid,
  toClubFrame,
  toLocalXY,
  type LatLng,
} from './index.js';

/** Moyvalley GC, Co. Kildare — roughly the clubhouse. */
const MOYVALLEY: LatLng = { lat: 53.4245, lng: -6.9165 };

/** Arbitrary point within ~2 km of Moyvalley. */
const nearby = fc.record({
  lat: fc.double({ min: MOYVALLEY.lat - 0.02, max: MOYVALLEY.lat + 0.02, noNaN: true }),
  lng: fc.double({ min: MOYVALLEY.lng - 0.03, max: MOYVALLEY.lng + 0.03, noNaN: true }),
});

const bearing = fc.double({ min: 0, max: 360, noNaN: true });
const shotDistance = fc.double({ min: 0, max: 350, noNaN: true });

describe('haversine / bearing / destination', () => {
  it('matches a known pair (Dublin → Galway ≈ 187 km)', () => {
    const dublin = { lat: 53.3498, lng: -6.2603 };
    const galway = { lat: 53.2707, lng: -9.0568 };
    expect(haversineDistanceM(dublin, galway)).toBeCloseTo(186_400, -3);
    expect(initialBearingDeg(dublin, galway)).toBeCloseTo(268.9, 0);
  });

  it('distance to self is zero and antipode is half the circumference', () => {
    expect(haversineDistanceM(MOYVALLEY, MOYVALLEY)).toBe(0);
    const anti = { lat: -MOYVALLEY.lat, lng: MOYVALLEY.lng + 180 };
    expect(haversineDistanceM(MOYVALLEY, anti)).toBeCloseTo(Math.PI * 6371008.8, 0);
  });

  it('destinationPoint then haversine/bearing round-trips (property)', () => {
    fc.assert(
      fc.property(nearby, bearing, shotDistance, (origin, brg, d) => {
        const dest = destinationPoint(origin, brg, d);
        expect(haversineDistanceM(origin, dest)).toBeCloseTo(d, 4);
        if (d > 1) {
          const back = initialBearingDeg(origin, dest);
          const diff = Math.abs(((back - brg + 540) % 360) - 180);
          expect(diff).toBeLessThan(1e-3);
        }
      }),
    );
  });

  it('cardinal bearings move the expected axis', () => {
    const n = destinationPoint(MOYVALLEY, 0, 100);
    expect(n.lat).toBeGreaterThan(MOYVALLEY.lat);
    expect(n.lng).toBeCloseTo(MOYVALLEY.lng, 9);
    const e = destinationPoint(MOYVALLEY, 90, 100);
    expect(e.lng).toBeGreaterThan(MOYVALLEY.lng);
    expect(e.lat).toBeCloseTo(MOYVALLEY.lat, 6);
  });
});

describe('local projection', () => {
  it('agrees with haversine at course scale', () => {
    fc.assert(
      fc.property(nearby, nearby, (a, b) => {
        const xy = toLocalXY(a, b);
        const planar = Math.hypot(xy.x, xy.y);
        const great = haversineDistanceM(a, b);
        // Within 2 km the two differ by well under 0.1 %.
        expect(Math.abs(planar - great)).toBeLessThan(0.001 * great + 0.01);
      }),
    );
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(nearby, nearby, (origin, p) => {
        const back = fromLocalXY(origin, toLocalXY(origin, p));
        expect(back.lat).toBeCloseTo(p.lat, 9);
        expect(back.lng).toBeCloseTo(p.lng, 9);
      }),
    );
  });
});

describe('club frame', () => {
  it('a shot straight down the line has zero lateral', () => {
    const start = MOYVALLEY;
    const end = destinationPoint(start, 45, 150);
    const r = toClubFrame(start, 45, end);
    expect(r.alongM).toBeCloseTo(150, 2);
    expect(r.lateralM).toBeCloseTo(0, 2);
  });

  it('a shot to the right of the line has positive lateral, whatever the line bearing', () => {
    fc.assert(
      fc.property(bearing, (brg) => {
        const start = MOYVALLEY;
        // 150 m along the line then 20 m to the right (bearing + 90).
        const mid = destinationPoint(start, brg, 150);
        const end = destinationPoint(mid, brg + 90, 20);
        const r = toClubFrame(start, brg, end);
        expect(r.alongM).toBeCloseTo(150, 1);
        expect(r.lateralM).toBeCloseTo(20, 1);
      }),
    );
  });

  it('fromClubFrame inverts toClubFrame (property)', () => {
    fc.assert(
      fc.property(nearby, bearing, nearby, (start, brg, end) => {
        const r = toClubFrame(start, brg, end);
        const back = fromClubFrame(start, brg, r);
        expect(back.lat).toBeCloseTo(end.lat, 9);
        expect(back.lng).toBeCloseTo(end.lng, 9);
      }),
    );
  });
});

describe('polygons', () => {
  // A ~100 m square around Moyvalley with a small hole in the middle.
  const square: LatLng[] = [
    destinationPoint(MOYVALLEY, 315, 70),
    destinationPoint(MOYVALLEY, 45, 70),
    destinationPoint(MOYVALLEY, 135, 70),
    destinationPoint(MOYVALLEY, 225, 70),
  ];
  const hole: LatLng[] = [
    destinationPoint(MOYVALLEY, 315, 7),
    destinationPoint(MOYVALLEY, 45, 7),
    destinationPoint(MOYVALLEY, 135, 7),
    destinationPoint(MOYVALLEY, 225, 7),
  ];

  it('bbox contains vertices and centre, excludes far points', () => {
    const b = bboxOf(square);
    for (const v of square) expect(bboxContains(b, v)).toBe(true);
    expect(bboxContains(b, MOYVALLEY)).toBe(true);
    expect(bboxContains(b, destinationPoint(MOYVALLEY, 0, 500))).toBe(false);
    expect(bboxOf([])).toEqual({
      minLat: Infinity,
      minLng: Infinity,
      maxLat: -Infinity,
      maxLng: -Infinity,
    });
  });

  it('pointInRing: inside, outside, and closed-ring tolerance', () => {
    expect(pointInRing(square, MOYVALLEY)).toBe(true);
    expect(pointInRing(square, destinationPoint(MOYVALLEY, 90, 200))).toBe(false);
    expect(pointInRing([...square, square[0]!], MOYVALLEY)).toBe(true);
  });

  it('pointInPolygon respects holes', () => {
    const poly = { outer: square, holes: [hole] };
    expect(pointInPolygon(poly, MOYVALLEY)).toBe(false); // in the hole
    expect(pointInPolygon(poly, destinationPoint(MOYVALLEY, 0, 30))).toBe(true);
    expect(pointInPolygon(poly, destinationPoint(MOYVALLEY, 0, 300))).toBe(false);
    expect(pointInPolygon({ outer: square }, MOYVALLEY)).toBe(true);
  });

  it('point-in-ring agrees with a geometric construction (property)', () => {
    // Points at radius r < 49 m from the centre of the 100 m square are inside
    // (half-side is ~49.5 m); points at r > 71 m are outside (half-diagonal ≈ 70 m).
    fc.assert(
      fc.property(bearing, fc.double({ min: 0, max: 48, noNaN: true }), (brg, r) => {
        expect(pointInRing(square, destinationPoint(MOYVALLEY, brg, r))).toBe(true);
      }),
    );
    fc.assert(
      fc.property(bearing, fc.double({ min: 72, max: 300, noNaN: true }), (brg, r) => {
        expect(pointInRing(square, destinationPoint(MOYVALLEY, brg, r))).toBe(false);
      }),
    );
  });

  it('distanceToSegmentM handles interior, endpoint and degenerate cases', () => {
    const a = destinationPoint(MOYVALLEY, 270, 50);
    const b = destinationPoint(MOYVALLEY, 90, 50);
    // Perpendicular foot lands mid-segment.
    expect(distanceToSegmentM(destinationPoint(MOYVALLEY, 0, 30), a, b)).toBeCloseTo(30, 1);
    // Beyond the end: distance to endpoint b.
    const beyond = destinationPoint(MOYVALLEY, 90, 80);
    expect(distanceToSegmentM(beyond, a, b)).toBeCloseTo(30, 1);
    // Degenerate segment.
    expect(distanceToSegmentM(beyond, a, a)).toBeCloseTo(130, 1);
  });

  it('distanceToRingM is ~0 on the boundary and ~half-side at the centre', () => {
    expect(distanceToRingM(square, square[0]!)).toBeCloseTo(0, 3);
    expect(distanceToRingM(square, MOYVALLEY)).toBeCloseTo(70 / Math.SQRT2, 0);
  });

  it('ringCentroid recovers the centre of the square and handles degenerate rings', () => {
    const c = ringCentroid(square);
    expect(haversineDistanceM(c, MOYVALLEY)).toBeLessThan(0.05);
    const line = [square[0]!, square[1]!];
    const m = ringCentroid(line);
    expect(haversineDistanceM(m, destinationPoint(MOYVALLEY, 0, 70 / Math.SQRT2))).toBeLessThan(
      0.1,
    );
  });
});
