/**
 * Binary layout of a stored elevation grid (Supabase Storage bucket `elevation`,
 * referenced by `elevation_grids.storage_path`). Little-endian throughout:
 *
 *   0  'CMEG' magic          4 B
 *   4  format version (1)    u32
 *   8  width, height         u32 × 2
 *  16  minLat, minLng,
 *      maxLat, maxLng        f64 × 4
 *  48  resolutionM           f32
 *  52  heights               f32 × width·height (row-major, north-up)
 */
import { assertElevationGrid, type ElevationGrid } from './grid.js';

export const GRID_RASTER_MAGIC = 'CMEG';
export const GRID_RASTER_VERSION = 1;
export const GRID_RASTER_HEADER_BYTES = 52;

export function encodeGridRaster(grid: ElevationGrid): Uint8Array {
  assertElevationGrid(grid);
  const bytes = new Uint8Array(GRID_RASTER_HEADER_BYTES + grid.data.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, GRID_RASTER_MAGIC.charCodeAt(i));
  view.setUint32(4, GRID_RASTER_VERSION, true);
  view.setUint32(8, grid.width, true);
  view.setUint32(12, grid.height, true);
  view.setFloat64(16, grid.bbox.minLat, true);
  view.setFloat64(24, grid.bbox.minLng, true);
  view.setFloat64(32, grid.bbox.maxLat, true);
  view.setFloat64(40, grid.bbox.maxLng, true);
  view.setFloat32(48, grid.resolutionM, true);
  let o = GRID_RASTER_HEADER_BYTES;
  for (const v of grid.data) {
    view.setFloat32(o, v, true);
    o += 4;
  }
  return bytes;
}

export function decodeGridRaster(bytes: Uint8Array): ElevationGrid {
  if (bytes.length < GRID_RASTER_HEADER_BYTES) throw new RangeError('raster too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== GRID_RASTER_MAGIC) throw new RangeError('not a CaddyMate elevation raster');
  const version = view.getUint32(4, true);
  if (version !== GRID_RASTER_VERSION)
    throw new RangeError(`unsupported raster version ${String(version)}`);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (bytes.length !== GRID_RASTER_HEADER_BYTES + width * height * 4) {
    throw new RangeError('raster length does not match its header');
  }
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getFloat32(GRID_RASTER_HEADER_BYTES + i * 4, true);
  }
  const grid: ElevationGrid = {
    bbox: {
      minLat: view.getFloat64(16, true),
      minLng: view.getFloat64(24, true),
      maxLat: view.getFloat64(32, true),
      maxLng: view.getFloat64(40, true),
    },
    resolutionM: view.getFloat32(48, true),
    width,
    height,
    data,
  };
  assertElevationGrid(grid);
  return grid;
}
