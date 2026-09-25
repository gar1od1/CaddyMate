/**
 * Server-side copy of the terrain maths in packages/engine/src/terrain/{grid,
 * tiles,raster}.ts (stance-slope code omitted). Edge Functions are bundled
 * from supabase/functions only, so this is a verbatim mirror rather than an
 * import; `parity_test.ts` checks the two agree. Change the engine first.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** WGS-84 mean earth radius, metres (engine geo/EARTH_RADIUS_M). */
export const EARTH_RADIUS_M = 6371008.8;
const degToRad = (deg: number): number => (deg * Math.PI) / 180;
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

// --- grid.ts ----------------------------------------------------------------

export interface ElevationGrid {
  bbox: Bbox;
  /** Nominal node spacing in metres (informational; geometry comes from bbox + size). */
  resolutionM: number;
  width: number;
  height: number;
  /** Heights in metres, row-major, north-up: index = row * width + col. */
  data: Float32Array;
}

/** Throws unless `grid` is well-formed (≥ 2×2 nodes, non-empty bbox, matching data length). */
export function assertElevationGrid(grid: ElevationGrid): void {
  const { bbox, width, height, data } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new RangeError(
      `grid must be at least 2×2 nodes (got ${String(width)}×${String(height)})`,
    );
  }
  if (!(bbox.maxLat > bbox.minLat) || !(bbox.maxLng > bbox.minLng)) {
    throw new RangeError('grid bbox must have positive extent');
  }
  if (data.length !== width * height) {
    throw new RangeError(
      `grid data has ${String(data.length)} values, expected ${String(width * height)}`,
    );
  }
}

/** Width and height of `bbox` in metres (measured through its centre). */
export function bboxSizeM(bbox: Bbox): { widthM: number; heightM: number } {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  return {
    widthM: degToRad(bbox.maxLng - bbox.minLng) * Math.cos(degToRad(midLat)) * EARTH_RADIUS_M,
    heightM: degToRad(bbox.maxLat - bbox.minLat) * EARTH_RADIUS_M,
  };
}

/** `bbox` grown by at least `metres` on every side (longitude padding sized at its poleward edge). */
export function expandBbox(bbox: Bbox, metres: number): Bbox {
  const dLat = radToDeg(metres / EARTH_RADIUS_M);
  const polewardLat = Math.max(Math.abs(bbox.minLat), Math.abs(bbox.maxLat));
  const dLng = radToDeg(metres / (EARTH_RADIUS_M * Math.cos(degToRad(polewardLat))));
  return {
    minLat: bbox.minLat - dLat,
    minLng: bbox.minLng - dLng,
    maxLat: bbox.maxLat + dLat,
    maxLng: bbox.maxLng + dLng,
  };
}

/** Node counts for a grid over `bbox` with roughly `resolutionM` spacing (at least 2×2). */
export function gridDimensions(bbox: Bbox, resolutionM: number): { width: number; height: number } {
  if (!(resolutionM > 0)) throw new RangeError('resolutionM must be positive');
  const { widthM, heightM } = bboxSizeM(bbox);
  return {
    width: Math.max(2, Math.round(widthM / resolutionM) + 1),
    height: Math.max(2, Math.round(heightM / resolutionM) + 1),
  };
}

/** Position of node (row, col). */
export function gridNodeLatLng(grid: ElevationGrid, row: number, col: number): LatLng {
  const { bbox, width, height } = grid;
  return {
    lat: bbox.maxLat - (row / (height - 1)) * (bbox.maxLat - bbox.minLat),
    lng: bbox.minLng + (col / (width - 1)) * (bbox.maxLng - bbox.minLng),
  };
}

/** Build a grid over `bbox` by evaluating `heightAt` at every node. */
export function createElevationGrid(
  bbox: Bbox,
  resolutionM: number,
  heightAt: (p: LatLng) => number,
): ElevationGrid {
  const { width, height } = gridDimensions(bbox, resolutionM);
  const grid: ElevationGrid = {
    bbox,
    resolutionM,
    width,
    height,
    data: new Float32Array(width * height),
  };
  assertElevationGrid(grid);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      grid.data[r * width + c] = heightAt(gridNodeLatLng(grid, r, c));
    }
  }
  return grid;
}

/** Minimum and maximum height in the grid. */
export function gridMinMax(grid: ElevationGrid): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Bilinear height at `p`, metres. Points on the bbox edge are sampled with the
 * cell indices clamped to the grid; points outside the bbox return `null`.
 */
export function sampleElevation(grid: ElevationGrid, p: LatLng): number | null {
  const { bbox, width, height, data } = grid;
  if (p.lat < bbox.minLat || p.lat > bbox.maxLat || p.lng < bbox.minLng || p.lng > bbox.maxLng) {
    return null;
  }
  const fx = ((p.lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (width - 1);
  const fy = ((bbox.maxLat - p.lat) / (bbox.maxLat - bbox.minLat)) * (height - 1);
  const c0 = Math.min(Math.floor(fx), width - 2);
  const r0 = Math.min(Math.floor(fy), height - 2);
  const tx = fx - c0;
  const ty = fy - r0;
  const i = r0 * width + c0;
  const z00 = data[i]!;
  const z01 = data[i + 1]!;
  const z10 = data[i + width]!;
  const z11 = data[i + width + 1]!;
  return (z00 * (1 - tx) + z01 * tx) * (1 - ty) + (z10 * (1 - tx) + z11 * tx) * ty;
}

/** Height change from `from` to `to` in metres (+ = `to` is higher); `null` if either is off-grid. */
export function elevationDeltaM(grid: ElevationGrid, from: LatLng, to: LatLng): number | null {
  const a = sampleElevation(grid, from);
  const b = sampleElevation(grid, to);
  return a === null || b === null ? null : b - a;
}

// --- tiles.ts ---------------------------------------------------------------

/** Web Mercator's sphere is the WGS-84 equatorial radius, not the mean radius. */
export const WEB_MERCATOR_RADIUS_M = 6378137;

/** Latitude limit of the square Web-Mercator world. */
export const MAX_MERCATOR_LAT = 85.0511287798066;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Fractional tile x of a longitude at zoom `z`. */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** Fractional tile y of a latitude at zoom `z` (clamped to the Mercator limit). */
export function latToTileY(lat: number, z: number): number {
  const φ = degToRad(Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)));
  return ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * 2 ** z;
}

/** Longitude of the west edge of (fractional) tile column `x`. */
export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude of the north edge of (fractional) tile row `y`. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return radToDeg(Math.atan(Math.sinh(n)));
}

/** The tile containing `p` at zoom `z`. */
export function tileForPoint(p: LatLng, z: number): TileId {
  const n = 2 ** z;
  return {
    z,
    x: Math.min(n - 1, Math.floor(lngToTileX(p.lng, z))),
    y: Math.min(n - 1, Math.floor(latToTileY(p.lat, z))),
  };
}

export function tileBbox(t: TileId): Bbox {
  return {
    minLat: tileYToLat(t.y + 1, t.z),
    minLng: tileXToLng(t.x, t.z),
    maxLat: tileYToLat(t.y, t.z),
    maxLng: tileXToLng(t.x + 1, t.z),
  };
}

/** All tiles at zoom `z` intersecting `bbox`, row by row from the north-west. */
export function tilesForBbox(bbox: Bbox, z: number): TileId[] {
  const nw = tileForPoint({ lat: bbox.maxLat, lng: bbox.minLng }, z);
  const se = tileForPoint({ lat: bbox.minLat, lng: bbox.maxLng }, z);
  const out: TileId[] = [];
  for (let y = nw.y; y <= se.y; y++) {
    for (let x = nw.x; x <= se.x; x++) out.push({ z, x, y });
  }
  return out;
}

/** Ground size of one pixel of a `tileSize`-pixel tile at zoom `z` and latitude `lat`, metres. */
export function tilePixelSizeM(lat: number, z: number, tileSize = 256): number {
  return (2 * Math.PI * WEB_MERCATOR_RADIUS_M * Math.cos(degToRad(lat))) / (tileSize * 2 ** z);
}

/**
 * Decode Mapbox Terrain-RGB pixels (RGB or RGBA, row-major) to heights in metres:
 * `h = −10000 + (R·65536 + G·256 + B) · 0.1`.
 */
export function decodeTerrainRgb(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  const channels = count > 0 ? pixels.length / count : 0;
  if (channels !== 3 && channels !== 4) {
    throw new RangeError(`expected RGB or RGBA pixels for ${String(width)}×${String(height)}`);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * channels;
    out[i] = -10000 + (pixels[o]! * 65536 + pixels[o + 1]! * 256 + pixels[o + 2]!) * 0.1;
  }
  return out;
}

/** A decoded square tile: `size × size` heights, row-major, north-up. */
export interface HeightTile extends TileId {
  size: number;
  heights: Float32Array;
}

/**
 * Bilinear height at `p` from a single tile, between pixel centres; points in
 * the outer half-pixel rim (or outside the tile) clamp to the nearest centres.
 */
export function sampleHeightTile(tile: HeightTile, p: LatLng): number {
  const { z, size, heights } = tile;
  const u = Math.max(0, Math.min(size - 1, (lngToTileX(p.lng, z) - tile.x) * size - 0.5));
  const v = Math.max(0, Math.min(size - 1, (latToTileY(p.lat, z) - tile.y) * size - 0.5));
  const c = Math.min(Math.floor(u), size - 2);
  const r = Math.min(Math.floor(v), size - 2);
  const tx = u - c;
  const ty = v - r;
  const i = r * size + c;
  return (
    (heights[i]! * (1 - tx) + heights[i + 1]! * tx) * (1 - ty) +
    (heights[i + size]! * (1 - tx) + heights[i + size + 1]! * tx) * ty
  );
}

/**
 * Stitch decoded tiles (one zoom, one size, forming a complete rectangle) into
 * an {@link ElevationGrid} over `bbox` at `resolutionM`. Heights are bilinearly
 * resampled from pixel centres in Mercator space, so rows land at their true
 * latitudes. Defaults: the extent of the mosaic's pixel centres, and the native
 * pixel size at its centre.
 */
export function gridFromTiles(
  tiles: readonly HeightTile[],
  bbox?: Bbox,
  resolutionM?: number,
): ElevationGrid {
  const first = tiles[0];
  if (first === undefined) throw new RangeError('gridFromTiles needs at least one tile');
  const { z, size } = first;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tiles) {
    if (t.z !== z || t.size !== size || size < 2 || t.heights.length !== size * size) {
      throw new RangeError('tiles must share one zoom and size (≥ 2 px)');
    }
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x);
    y1 = Math.max(y1, t.y);
  }
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const byKey = new Map(tiles.map((t) => [`${String(t.x)}/${String(t.y)}`, t]));
  if (byKey.size !== cols * rows || tiles.length !== byKey.size) {
    throw new RangeError('tiles must form a complete rectangle without duplicates');
  }
  // Mosaic of heights, W × H pixels.
  const W = cols * size;
  const H = rows * size;
  const mosaic = new Float32Array(W * H);
  for (const t of tiles) {
    const ox = (t.x - x0) * size;
    const oy = (t.y - y0) * size;
    for (let r = 0; r < size; r++) {
      mosaic.set(t.heights.subarray(r * size, (r + 1) * size), (oy + r) * W + ox);
    }
  }
  const scale = 2 ** z * size;
  const pixelCentreExtent: Bbox = {
    minLat: tileYToLat(y1 + 1 - 0.5 / size, z),
    minLng: tileXToLng(x0 + 0.5 / size, z),
    maxLat: tileYToLat(y0 + 0.5 / size, z),
    maxLng: tileXToLng(x1 + 1 - 0.5 / size, z),
  };
  const box = bbox ?? pixelCentreExtent;
  const res = resolutionM ?? tilePixelSizeM((box.minLat + box.maxLat) / 2, z, size);
  const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));
  return createElevationGrid(box, res, (p) => {
    // Pixel-index coordinates: pixel i has its centre at i + 0.5 in mosaic units.
    const u = clamp(((p.lng + 180) / 360) * scale - x0 * size - 0.5, W - 1);
    const v = clamp((latToTileY(p.lat, z) - y0) * size - 0.5, H - 1);
    const c = Math.min(Math.floor(u), W - 2);
    const r = Math.min(Math.floor(v), H - 2);
    const tx = u - c;
    const ty = v - r;
    const i = r * W + c;
    return (
      (mosaic[i]! * (1 - tx) + mosaic[i + 1]! * tx) * (1 - ty) +
      (mosaic[i + W]! * (1 - tx) + mosaic[i + W + 1]! * tx) * ty
    );
  });
}

// --- raster.ts --------------------------------------------------------------

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
