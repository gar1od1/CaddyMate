/**
 * Web-Mercator (slippy-map) tile maths and Mapbox Terrain-RGB decoding. Tile
 * coordinates follow the XYZ scheme: x grows east, y grows south, zoom z has
 * 2^z × 2^z tiles. "Fractional" tile coordinates locate a point inside a tile.
 */
import type { Bbox, LatLng } from '../geo/index.js';
import { degToRad, radToDeg } from '../units/index.js';
import { createElevationGrid, type ElevationGrid } from './grid.js';

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
