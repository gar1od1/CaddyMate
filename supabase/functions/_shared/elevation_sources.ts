/**
 * Elevation providers for the `elevation` Edge Function. Mapbox Terrain-RGB
 * (§3.1) when `MAPBOX_TOKEN` is set; otherwise the keyless Open-Meteo Elevation
 * API (Copernicus 90 m DEM). The token never leaves the server (§16).
 */
import { decode } from 'npm:fast-png@6';
import {
  createElevationGrid,
  decodeTerrainRgb,
  gridDimensions,
  gridFromTiles,
  gridNodeLatLng,
  sampleElevation,
  sampleHeightTile,
  tileForPoint,
  tilesForBbox,
  type Bbox,
  type ElevationGrid,
  type HeightTile,
  type LatLng,
  type TileId,
} from './terrain.ts';
import {
  ensureOk,
  type FetchLike,
  fetchJson,
  fetchWithTimeout,
  HttpError,
  mapLimit,
} from './http.ts';

/** Highest zoom of `mapbox.terrain-rgb` (~3 m pixels at Irish latitudes). */
export const MAPBOX_ZOOM = 15;
/** Open-Meteo accepts up to 100 coordinates per request. */
export const OPEN_METEO_BATCH = 100;
/** Guards against runaway requests (a course is ≲ 2 km across). */
export const MAX_TILES = 64;
export const MAX_SAMPLE_POINTS = 5000;
export const MAX_GRID_CELLS = 4_000_000;
const CONCURRENCY = 4;

export type ElevationSource = 'mapbox' | 'open-meteo';

export function mapboxTileUrl(t: TileId, token: string): string {
  return (
    `https://api.mapbox.com/v4/mapbox.terrain-rgb/${t.z}/${t.x}/${t.y}.pngraw` +
    `?access_token=${encodeURIComponent(token)}`
  );
}

/** Decode a Terrain-RGB PNG (8-bit RGB/RGBA, square) into a height tile. */
export function decodeTerrainPng(bytes: Uint8Array, t: TileId): HeightTile {
  const img = decode(bytes);
  if (img.depth !== 8 || img.width !== img.height || img.palette !== undefined) {
    throw new HttpError(502, 'upstream_error', 'Unexpected Terrain-RGB tile format');
  }
  return { ...t, size: img.width, heights: decodeTerrainRgb(img.data, img.width, img.height) };
}

export async function fetchTerrainTile(
  t: TileId,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<HeightTile> {
  const url = mapboxTileUrl(t, token);
  const res = await ensureOk(await fetchWithTimeout(url, {}, undefined, fetchImpl), url);
  return decodeTerrainPng(new Uint8Array(await res.arrayBuffer()), t);
}

/** Heights at `points` from Terrain-RGB, fetching each z15 tile once. */
export async function mapboxHeights(
  points: readonly LatLng[],
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<number[]> {
  const ids = points.map((p) => tileForPoint(p, MAPBOX_ZOOM));
  const unique = [...new Map(ids.map((t) => [`${t.x}/${t.y}`, t])).values()];
  if (unique.length > MAX_TILES) {
    throw new HttpError(413, 'too_large', `Points span ${unique.length} tiles (max ${MAX_TILES})`);
  }
  const tiles = await mapLimit(unique, CONCURRENCY, (t) => fetchTerrainTile(t, token, fetchImpl));
  const byKey = new Map(tiles.map((t) => [`${t.x}/${t.y}`, t]));
  return points.map((p, i) => sampleHeightTile(byKey.get(`${ids[i]!.x}/${ids[i]!.y}`)!, p));
}

export function openMeteoElevationUrl(points: readonly LatLng[]): string {
  const lat = points.map((p) => p.lat.toFixed(6)).join(',');
  const lng = points.map((p) => p.lng.toFixed(6)).join(',');
  return `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
}

/** Heights at `points` from Open-Meteo, in batches of {@link OPEN_METEO_BATCH}. */
export async function openMeteoHeights(
  points: readonly LatLng[],
  fetchImpl: FetchLike = fetch,
): Promise<number[]> {
  const batches: LatLng[][] = [];
  for (let i = 0; i < points.length; i += OPEN_METEO_BATCH) {
    batches.push(points.slice(i, i + OPEN_METEO_BATCH));
  }
  const results = await mapLimit(batches, CONCURRENCY, async (batch) => {
    const body = await fetchJson(openMeteoElevationUrl(batch), fetchImpl);
    const elev = (body as { elevation?: unknown }).elevation;
    if (
      !Array.isArray(elev) ||
      elev.length !== batch.length ||
      !elev.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new HttpError(502, 'upstream_error', 'Open-Meteo elevation response is malformed');
    }
    return elev as number[];
  });
  return results.flat();
}

function assertGridSize(bbox: Bbox, resolutionM: number): void {
  const { width, height } = gridDimensions(bbox, resolutionM);
  if (width * height > MAX_GRID_CELLS) {
    throw new HttpError(
      413,
      'too_large',
      `Grid of ${width}×${height} exceeds ${MAX_GRID_CELLS} cells`,
    );
  }
}

/** Grid over `bbox` resampled to `resolutionM` from z15 Terrain-RGB tiles. */
export async function mapboxGrid(
  bbox: Bbox,
  token: string,
  fetchImpl: FetchLike = fetch,
  resolutionM = 2,
): Promise<ElevationGrid> {
  assertGridSize(bbox, resolutionM);
  const ids = tilesForBbox(bbox, MAPBOX_ZOOM);
  if (ids.length > MAX_TILES) {
    throw new HttpError(413, 'too_large', `Area spans ${ids.length} tiles (max ${MAX_TILES})`);
  }
  const tiles = await mapLimit(ids, CONCURRENCY, (t) => fetchTerrainTile(t, token, fetchImpl));
  return gridFromTiles(tiles, bbox, resolutionM);
}

/**
 * Grid over `bbox` at `resolutionM` from Open-Meteo. The source DEM is ~90 m, so
 * it is sampled every `sampleSpacingM` (well above its Nyquist rate) and then
 * bilinearly resampled, instead of spending one API coordinate per output node.
 */
export async function openMeteoGrid(
  bbox: Bbox,
  fetchImpl: FetchLike = fetch,
  resolutionM = 10,
  sampleSpacingM = 30,
): Promise<ElevationGrid> {
  assertGridSize(bbox, resolutionM);
  const { width, height } = gridDimensions(bbox, sampleSpacingM);
  if (width * height > MAX_SAMPLE_POINTS) {
    throw new HttpError(
      413,
      'too_large',
      `Area needs ${width * height} samples (max ${MAX_SAMPLE_POINTS})`,
    );
  }
  const coarse: ElevationGrid = {
    bbox,
    resolutionM: sampleSpacingM,
    width,
    height,
    data: new Float32Array(width * height),
  };
  const nodes: LatLng[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) nodes.push(gridNodeLatLng(coarse, r, c));
  }
  coarse.data.set(await openMeteoHeights(nodes, fetchImpl));
  return createElevationGrid(bbox, resolutionM, (p) => sampleElevation(coarse, p) ?? 0);
}
