import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bboxContains, type LatLng } from '../geo/index.js';
import {
  decodeTerrainRgb,
  gridFromTiles,
  latToTileY,
  lngToTileX,
  MAX_MERCATOR_LAT,
  sampleElevation,
  sampleHeightTile,
  tileBbox,
  tileForPoint,
  tilePixelSizeM,
  tilesForBbox,
  tileXToLng,
  tileYToLat,
  type HeightTile,
} from './index.js';

const MOYVALLEY: LatLng = { lat: 53.4245, lng: -6.9165 };
const world = fc.record({
  lat: fc.double({ min: -85, max: 85, noNaN: true }),
  lng: fc.double({ min: -180, max: 179.999, noNaN: true }),
});

describe('Web-Mercator tile maths', () => {
  it('matches known tile indices', () => {
    expect(tileForPoint({ lat: 0, lng: 0 }, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(tileForPoint({ lat: 10, lng: -10 }, 1)).toEqual({ z: 1, x: 0, y: 0 });
    // Moyvalley at z15 (checked against the OSM slippy-map formula).
    expect(tileForPoint(MOYVALLEY, 15)).toEqual({ z: 15, x: 15754, y: 10609 });
    // Edges clamp into the world.
    expect(tileForPoint({ lat: -90, lng: 180 }, 3)).toEqual({ z: 3, x: 7, y: 7 });
    expect(latToTileY(90, 4)).toBeCloseTo(0, 9);
    expect(latToTileY(MAX_MERCATOR_LAT, 0)).toBeCloseTo(0, 9);
    expect(lngToTileX(-180, 5)).toBe(0);
    expect(tileXToLng(0, 0)).toBe(-180);
    expect(tileYToLat(0, 0)).toBeCloseTo(MAX_MERCATOR_LAT, 9);
  });

  it('round-trips lng/lat through tile coordinates (property)', () => {
    fc.assert(
      fc.property(world, fc.integer({ min: 0, max: 20 }), (p, z) => {
        expect(tileXToLng(lngToTileX(p.lng, z), z)).toBeCloseTo(p.lng, 8);
        expect(tileYToLat(latToTileY(p.lat, z), z)).toBeCloseTo(p.lat, 8);
      }),
    );
  });

  it('a point lies inside the bbox of its tile (property)', () => {
    const eps = 1e-9; // floating-point slack on tile boundaries
    fc.assert(
      fc.property(world, fc.integer({ min: 0, max: 18 }), (p, z) => {
        const b = tileBbox(tileForPoint(p, z));
        const grown = {
          minLat: b.minLat - eps,
          minLng: b.minLng - eps,
          maxLat: b.maxLat + eps,
          maxLng: b.maxLng + eps,
        };
        expect(bboxContains(grown, p)).toBe(true);
      }),
    );
  });

  it('lists the tiles covering a bbox', () => {
    const t = tileForPoint(MOYVALLEY, 15);
    const b = tileBbox(t);
    // A bbox straddling the tile's SE corner touches 4 tiles.
    const straddle = {
      minLat: b.minLat - 1e-4,
      minLng: b.maxLng - 1e-4,
      maxLat: b.minLat + 1e-4,
      maxLng: b.maxLng + 1e-4,
    };
    expect(tilesForBbox(straddle, 15)).toEqual([
      { z: 15, x: t.x, y: t.y },
      { z: 15, x: t.x + 1, y: t.y },
      { z: 15, x: t.x, y: t.y + 1 },
      { z: 15, x: t.x + 1, y: t.y + 1 },
    ]);
  });

  it('gives the pixel ground size', () => {
    expect(tilePixelSizeM(0, 0)).toBeCloseTo(156_543.0, 0);
    expect(tilePixelSizeM(53.4245, 15, 512)).toBeCloseTo(1.4, 1);
  });
});

describe('decodeTerrainRgb', () => {
  it('decodes RGBA and RGB pixels', () => {
    // (1, 134, 160) → 0 m; (1, 135, 58) → 15.4 m.
    const rgba = Uint8ClampedArray.from([1, 134, 160, 255, 1, 135, 58, 255]);
    const h = decodeTerrainRgb(rgba, 2, 1);
    expect(h[0]).toBeCloseTo(0, 4);
    expect(h[1]).toBeCloseTo(15.4, 4);
    expect(decodeTerrainRgb(Uint8Array.from([0, 0, 0]), 1, 1)[0]).toBe(-10000);
  });

  it('rejects mismatched buffers', () => {
    expect(() => decodeTerrainRgb(new Uint8Array(8), 2, 2)).toThrow(RangeError);
    expect(() => decodeTerrainRgb(new Uint8Array(0), 0, 0)).toThrow(RangeError);
  });
});

describe('gridFromTiles', () => {
  const z = 15;
  const size = 4;
  const home = tileForPoint(MOYVALLEY, z);
  /** Height as a linear function of global (fractional) pixel coordinates. */
  const heightAtPixel = (gx: number, gy: number): number => 50 + 0.25 * gx - 0.5 * gy;
  const globalPx = (p: LatLng): [number, number] => [
    lngToTileX(p.lng, z) * size - 0.5,
    latToTileY(p.lat, z) * size - 0.5,
  ];
  function tile(x: number, y: number): HeightTile {
    const heights = new Float32Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Pixel (r, c) centre in global pixel-index units is (x·size + c, y·size + r).
        heights[r * size + c] = heightAtPixel(x * size + c - x0 * size, y * size + r - y0 * size);
      }
    }
    return { z, x, y, size, heights };
  }
  const x0 = home.x;
  const y0 = home.y;
  const tiles = [tile(x0, y0), tile(x0 + 1, y0), tile(x0, y0 + 1), tile(x0 + 1, y0 + 1)];
  const expected = (p: LatLng): number => {
    const [gx, gy] = globalPx(p);
    return heightAtPixel(gx - x0 * size, gy - y0 * size);
  };

  it('stitches a 2×2 mosaic over the pixel-centre extent at native resolution', () => {
    const g = gridFromTiles(tiles);
    expect(g.resolutionM).toBeCloseTo(tilePixelSizeM(MOYVALLEY.lat, z, size), 0);
    expect(g.width).toBeGreaterThanOrEqual(2 * size - 1);
    expect(g.height).toBeGreaterThanOrEqual(2 * size - 1);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (fx, fy) => {
          const p = {
            lat: g.bbox.minLat + fy * (g.bbox.maxLat - g.bbox.minLat),
            lng: g.bbox.minLng + fx * (g.bbox.maxLng - g.bbox.minLng),
          };
          // Grid rows are linear in latitude, Mercator rows are not: allow for that curvature.
          expect(sampleElevation(g, p)!).toBeCloseTo(expected(p), 1);
        },
      ),
    );
    // Nodes themselves are exact (bilinear of a linear field).
    expect(g.data[0]!).toBeCloseTo(expected({ lat: g.bbox.maxLat, lng: g.bbox.minLng }), 3);
  });

  it('resamples a requested bbox and resolution, clamping beyond pixel centres', () => {
    const b = tileBbox({ z, x: x0, y: y0 });
    const outer = { ...b, maxLng: tileBbox({ z, x: x0 + 1, y: y0 }).maxLng };
    const g = gridFromTiles(tiles, outer, 2);
    expect(g.resolutionM).toBe(2);
    // The NW corner is half a pixel outside the first pixel centre: clamped to it.
    expect(g.data[0]!).toBeCloseTo(heightAtPixel(0, 0), 4);
    // The NE corner clamps to the last column.
    expect(g.data[g.width - 1]!).toBeCloseTo(heightAtPixel(2 * size - 1, 0), 4);
  });

  it('samples a single tile between pixel centres, clamping at its rim', () => {
    const t = tiles[0]!;
    fc.assert(
      fc.property(
        fc.double({ min: 0.5 / size, max: 1 - 0.5 / size, noNaN: true }),
        fc.double({ min: 0.5 / size, max: 1 - 0.5 / size, noNaN: true }),
        (fx, fy) => {
          const p = { lat: tileYToLat(y0 + fy, z), lng: tileXToLng(x0 + fx, z) };
          expect(sampleHeightTile(t, p)).toBeCloseTo(expected(p), 4);
        },
      ),
    );
    const b = tileBbox(t);
    expect(sampleHeightTile(t, { lat: b.maxLat, lng: b.minLng })).toBeCloseTo(
      heightAtPixel(0, 0),
      4,
    );
    expect(sampleHeightTile(t, { lat: b.minLat, lng: b.maxLng })).toBeCloseTo(
      heightAtPixel(size - 1, size - 1),
      4,
    );
  });

  it('rejects inconsistent tile sets', () => {
    expect(() => gridFromTiles([])).toThrow(/at least one/);
    expect(() => gridFromTiles([tiles[0]!, { ...tiles[1]!, z: 14 }])).toThrow(/zoom and size/);
    expect(() => gridFromTiles([tiles[0]!, { ...tiles[1]!, size: 8 }])).toThrow(/zoom and size/);
    expect(() => gridFromTiles([{ z, x: 0, y: 0, size: 1, heights: new Float32Array(1) }])).toThrow(
      /zoom and size/,
    );
    expect(() =>
      gridFromTiles([tiles[0]!, { ...tiles[1]!, heights: new Float32Array(3) }]),
    ).toThrow(/zoom and size/);
    expect(() => gridFromTiles([tiles[0]!, tiles[3]!])).toThrow(/rectangle/);
    expect(() => gridFromTiles([tiles[0]!, tiles[1]!, tiles[1]!])).toThrow(/rectangle/);
  });
});
