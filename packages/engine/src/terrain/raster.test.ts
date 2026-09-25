import { describe, expect, it } from 'vitest';
import {
  decodeGridRaster,
  encodeGridRaster,
  GRID_RASTER_HEADER_BYTES,
  type ElevationGrid,
} from './index.js';

const grid: ElevationGrid = {
  bbox: { minLat: 53.42, minLng: -6.92, maxLat: 53.43, maxLng: -6.91 },
  resolutionM: 2,
  width: 3,
  height: 2,
  data: Float32Array.from([1.5, 2.25, -3, 100.125, 0, 7]),
};

describe('grid raster codec', () => {
  it('round-trips, including from a sub-view of a larger buffer', () => {
    const bytes = encodeGridRaster(grid);
    expect(bytes.length).toBe(GRID_RASTER_HEADER_BYTES + 6 * 4);
    expect(decodeGridRaster(bytes)).toEqual(grid);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 3);
    expect(decodeGridRaster(padded.subarray(3, 3 + bytes.length))).toEqual(grid);
  });

  it('rejects corrupt input', () => {
    const bytes = encodeGridRaster(grid);
    expect(() => decodeGridRaster(bytes.subarray(0, 10))).toThrow(/short/);
    const badMagic = bytes.slice();
    badMagic[0] = 0x58;
    expect(() => decodeGridRaster(badMagic)).toThrow(/not a CaddyMate/);
    const badVersion = bytes.slice();
    new DataView(badVersion.buffer).setUint32(4, 9, true);
    expect(() => decodeGridRaster(badVersion)).toThrow(/version 9/);
    expect(() => decodeGridRaster(bytes.subarray(0, bytes.length - 4))).toThrow(/length/);
    const tiny = encodeGridRaster({ ...grid, width: 2, height: 2, data: new Float32Array(4) });
    new DataView(tiny.buffer).setUint32(8, 1, true); // width 1 …
    const truncated = tiny.subarray(0, GRID_RASTER_HEADER_BYTES + 2 * 4); // … × height 2
    expect(() => decodeGridRaster(truncated)).toThrow(/2×2/);
    expect(() => encodeGridRaster({ ...grid, width: 4 })).toThrow(/values/);
  });
});
