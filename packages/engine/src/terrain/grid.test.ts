import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toLocalXY, type Bbox, type LatLng } from '../geo/index.js';
import {
  assertElevationGrid,
  bboxSizeM,
  expandBbox,
  createElevationGrid,
  elevationDeltaM,
  gridDimensions,
  gridMinMax,
  gridNodeLatLng,
  planeFit,
  sampleElevation,
  slopeStrength,
  stanceGrades,
  stanceSlopeSuggestion,
  type ElevationGrid,
} from './index.js';

/** ~560 m × 440 m box around Moyvalley GC. */
const BBOX: Bbox = { minLat: 53.422, minLng: -6.92, maxLat: 53.426, maxLng: -6.9117 };
const ORIGIN: LatLng = { lat: BBOX.minLat, lng: BBOX.minLng };
const BASE_M = 80;

/** A grid whose surface is the plane `BASE + gE·x + gN·y` (x/y metres from the SW corner). */
function planarGrid(gE: number, gN: number, res = 5): ElevationGrid {
  return createElevationGrid(BBOX, res, (p) => {
    const { x, y } = toLocalXY(ORIGIN, p);
    return BASE_M + gE * x + gN * y;
  });
}

const inside = fc.record({
  lat: fc.double({ min: BBOX.minLat, max: BBOX.maxLat, noNaN: true }),
  lng: fc.double({ min: BBOX.minLng, max: BBOX.maxLng, noNaN: true }),
});
const grade = fc.double({ min: -0.3, max: 0.3, noNaN: true });

describe('grid construction', () => {
  it('sizes the grid from bbox and resolution, with nodes on the bbox corners', () => {
    const g = planarGrid(0, 0, 10);
    const { widthM, heightM } = bboxSizeM(BBOX);
    expect(widthM).toBeCloseTo(550, 0);
    expect(heightM).toBeCloseTo(444.8, 1);
    expect(g.width).toBe(Math.round(widthM / 10) + 1);
    expect(g.height).toBe(Math.round(heightM / 10) + 1);
    expect(gridNodeLatLng(g, 0, 0)).toEqual({ lat: BBOX.maxLat, lng: BBOX.minLng });
    expect(gridNodeLatLng(g, g.height - 1, g.width - 1)).toEqual({
      lat: BBOX.minLat,
      lng: BBOX.maxLng,
    });
    expect(gridDimensions(BBOX, 1e6)).toEqual({ width: 2, height: 2 });
    expect(() => gridDimensions(BBOX, 0)).toThrow(RangeError);
  });

  it('expands a bbox by at least the buffer on every side', () => {
    const e = expandBbox(BBOX, 100);
    const { widthM, heightM } = bboxSizeM(BBOX);
    const grown = bboxSizeM(e);
    expect(grown.heightM - heightM).toBeCloseTo(200, 6);
    expect(grown.widthM - widthM).toBeGreaterThanOrEqual(200);
    expect(grown.widthM - widthM).toBeLessThan(201);
    // 100 m of longitude at the (poleward) northern edge.
    expect(
      toLocalXY({ lat: BBOX.maxLat, lng: e.minLng }, { lat: BBOX.maxLat, lng: BBOX.minLng }).x,
    ).toBeCloseTo(100, 6);
  });

  it('rejects malformed grids', () => {
    const ok = planarGrid(0, 0, 50);
    expect(() => {
      assertElevationGrid(ok);
    }).not.toThrow();
    expect(() => {
      assertElevationGrid({ ...ok, width: 1 });
    }).toThrow(/2×2/);
    expect(() => {
      assertElevationGrid({ ...ok, height: 2.5 });
    }).toThrow(/2×2/);
    expect(() => {
      assertElevationGrid({ ...ok, width: 1.5 });
    }).toThrow(/2×2/);
    expect(() => {
      assertElevationGrid({ ...ok, bbox: { ...BBOX, maxLat: BBOX.minLat } });
    }).toThrow(/extent/);
    expect(() => {
      assertElevationGrid({ ...ok, bbox: { ...BBOX, maxLng: BBOX.minLng } });
    }).toThrow(/extent/);
    expect(() => {
      assertElevationGrid({ ...ok, data: new Float32Array(3) });
    }).toThrow(/values/);
  });

  it('reports min/max', () => {
    const g = planarGrid(0.1, -0.05, 20);
    const { min, max } = gridMinMax(g);
    // Rises east and falls north: lowest at the NW corner, highest at the SE.
    const east = toLocalXY(ORIGIN, { lat: BBOX.minLat, lng: BBOX.maxLng }).x;
    expect(min).toBeCloseTo(BASE_M - 0.05 * bboxSizeM(BBOX).heightM, 3);
    expect(max).toBeCloseTo(BASE_M + 0.1 * east, 3);
  });
});

describe('sampleElevation', () => {
  it('interpolates bilinearly and clamps on the edges', () => {
    const g: ElevationGrid = {
      bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 },
      resolutionM: 1,
      width: 2,
      height: 2,
      // NW, NE / SW, SE
      data: Float32Array.from([10, 20, 30, 40]),
    };
    expect(sampleElevation(g, { lat: 1, lng: 0 })).toBe(10);
    expect(sampleElevation(g, { lat: 1, lng: 1 })).toBe(20);
    expect(sampleElevation(g, { lat: 0, lng: 0 })).toBe(30);
    expect(sampleElevation(g, { lat: 0, lng: 1 })).toBe(40);
    expect(sampleElevation(g, { lat: 0.5, lng: 0.5 })).toBe(25);
    expect(sampleElevation(g, { lat: 0.5, lng: 0.25 })).toBe(22.5);
  });

  it('returns null outside the bbox on every side', () => {
    const g = planarGrid(0, 0, 50);
    expect(sampleElevation(g, { lat: BBOX.minLat - 1e-6, lng: -6.915 })).toBeNull();
    expect(sampleElevation(g, { lat: BBOX.maxLat + 1e-6, lng: -6.915 })).toBeNull();
    expect(sampleElevation(g, { lat: 53.424, lng: BBOX.minLng - 1e-6 })).toBeNull();
    expect(sampleElevation(g, { lat: 53.424, lng: BBOX.maxLng + 1e-6 })).toBeNull();
  });

  it('is never null inside the bbox and stays within the grid range (property)', () => {
    const g = createElevationGrid(BBOX, 25, (p) => 50 + 10 * Math.sin(p.lat * 5e3 + p.lng * 3e3));
    const { min, max } = gridMinMax(g);
    fc.assert(
      fc.property(inside, (p) => {
        const z = sampleElevation(g, p);
        expect(z).not.toBeNull();
        expect(z!).toBeGreaterThanOrEqual(min - 1e-4);
        expect(z!).toBeLessThanOrEqual(max + 1e-4);
      }),
    );
  });

  it('reproduces a plane exactly and gives elevation deltas', () => {
    const g = planarGrid(0.05, 0.02);
    const a = { lat: 53.423, lng: -6.918 };
    const b = { lat: 53.425, lng: -6.914 };
    const { x: ax, y: ay } = toLocalXY(ORIGIN, a);
    const { x: bx, y: by } = toLocalXY(ORIGIN, b);
    expect(sampleElevation(g, a)).toBeCloseTo(BASE_M + 0.05 * ax + 0.02 * ay, 3);
    expect(elevationDeltaM(g, a, b)).toBeCloseTo(0.05 * (bx - ax) + 0.02 * (by - ay), 3);
    expect(elevationDeltaM(g, a, { lat: 0, lng: 0 })).toBeNull();
    expect(elevationDeltaM(g, { lat: 0, lng: 0 }, b)).toBeNull();
  });
});

describe('planeFit', () => {
  it('recovers the gradient of a synthetic plane anywhere in the grid (property)', () => {
    fc.assert(
      fc.property(grade, grade, inside, (gE, gN, p) => {
        const fit = planeFit(planarGrid(gE, gN), p)!;
        // Only float32 storage and the cos(lat) scale change across the box perturb it.
        expect(Math.abs(fit.dzdEast - gE)).toBeLessThan(1e-4 + 1e-3 * Math.abs(gE));
        expect(Math.abs(fit.dzdNorth - gN)).toBeLessThan(1e-4 + 1e-3 * Math.abs(gN));
      }),
      { numRuns: 60 },
    );
  });

  it('works on corners (half the stencil off-grid) and rejects bad input', () => {
    const g = planarGrid(0.04, -0.03);
    for (const corner of [
      { lat: BBOX.maxLat, lng: BBOX.minLng },
      { lat: BBOX.minLat, lng: BBOX.maxLng },
    ]) {
      const fit = planeFit(g, corner, 3)!;
      expect(fit.dzdEast).toBeCloseTo(0.04, 3);
      expect(fit.dzdNorth).toBeCloseTo(-0.03, 3);
    }
    expect(planeFit(g, { lat: 0, lng: 0 })).toBeNull();
    expect(() => planeFit(g, { lat: 53.424, lng: -6.915 }, 0)).toThrow(RangeError);
  });
});

describe('stance slope', () => {
  it('applies the §7.5 thresholds', () => {
    expect(slopeStrength(0)).toBe('none');
    expect(slopeStrength(0.0199)).toBe('none');
    expect(slopeStrength(0.02)).toBe('mild');
    expect(slopeStrength(-0.06)).toBe('mild');
    expect(slopeStrength(0.0601)).toBe('severe');
  });

  const p = { lat: 53.424, lng: -6.916 };

  it('reads uphill/downhill along the line', () => {
    const risingNorth = planarGrid(0, 0.04);
    expect(stanceSlopeSuggestion(risingNorth, p, 0, 'R')).toEqual({
      uphill: 'mild',
      downhill: 'none',
      ballAboveFeet: 'none',
      ballBelowFeet: 'none',
    });
    expect(stanceSlopeSuggestion(risingNorth, p, 180, 'R')!.downhill).toBe('mild');
    expect(stanceSlopeSuggestion(planarGrid(0, -0.1), p, 0, 'L')!.downhill).toBe('severe');
    expect(stanceSlopeSuggestion(risingNorth, { lat: 0, lng: 0 }, 0, 'R')).toBeNull();
  });

  it('reads ball above/below feet across the line for each handedness', () => {
    // Playing east, the ground rises to the north = the LEFT of the line, where a
    // right-hander stands: ground falls away from them → ball below feet.
    const risingNorth = planarGrid(0, 0.08);
    expect(stanceSlopeSuggestion(risingNorth, p, 90, 'R')).toEqual({
      uphill: 'none',
      downhill: 'none',
      ballAboveFeet: 'none',
      ballBelowFeet: 'severe',
    });
    // A left-hander stands on the north side, below the ball.
    expect(stanceSlopeSuggestion(risingNorth, p, 90, 'L')).toEqual({
      uphill: 'none',
      downhill: 'none',
      ballAboveFeet: 'severe',
      ballBelowFeet: 'none',
    });
  });

  it('flips above/below for L vs R and keeps up/down (property)', () => {
    fc.assert(
      fc.property(grade, grade, fc.double({ min: 0, max: 360, noNaN: true }), (gE, gN, brg) => {
        const g = planarGrid(gE, gN, 20);
        const r = stanceSlopeSuggestion(g, p, brg, 'R')!;
        const l = stanceSlopeSuggestion(g, p, brg, 'L')!;
        expect(l.uphill).toBe(r.uphill);
        expect(l.downhill).toBe(r.downhill);
        expect(l.ballAboveFeet).toBe(r.ballBelowFeet);
        expect(l.ballBelowFeet).toBe(r.ballAboveFeet);
        // At most one of each opposing pair is set.
        expect(r.uphill === 'none' || r.downhill === 'none').toBe(true);
        expect(r.ballAboveFeet === 'none' || r.ballBelowFeet === 'none').toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('projects a gradient onto the line and its normal', () => {
    const g = { dzdEast: 0.03, dzdNorth: 0.04 };
    const n = stanceGrades(g, 0, 'R');
    expect(n.alongGrade).toBeCloseTo(0.04, 12);
    expect(n.towardBallGrade).toBeCloseTo(0.03, 12);
    const e = stanceGrades(g, 90, 'L');
    expect(e.alongGrade).toBeCloseTo(0.03, 12);
    expect(e.towardBallGrade).toBeCloseTo(0.04, 12);
  });
});
