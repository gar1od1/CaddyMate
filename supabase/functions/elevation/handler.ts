/**
 * `POST /elevation`
 *   { points: [{ lat, lng }, …] }            → { source, heightsM: number[] }
 *   { courseId, version?, force? }           → builds (or reuses) the course grid
 *
 * Heights come from Mapbox Terrain-RGB when a token is configured, else from
 * Open-Meteo Elevation. Course grids cover the course boundary (or all hole
 * geometry) buffered by 100 m, at 2 m (Mapbox) or 10 m (Open-Meteo), and are
 * stored as a CMEG Float32 raster in the `elevation` bucket plus an
 * `elevation_grids` row (docs/SPEC.md §6.2).
 */
import {
  mapboxGrid,
  mapboxHeights,
  openMeteoGrid,
  openMeteoHeights,
  type ElevationSource,
} from '../_shared/elevation_sources.ts';
import { type FetchLike, HttpError, json, parseCoord } from '../_shared/http.ts';
import {
  encodeGridRaster,
  expandBbox,
  gridMinMax,
  type Bbox,
  type ElevationGrid,
  type LatLng,
} from '../_shared/terrain.ts';

export const MAX_POINTS = 500;
export const COURSE_BUFFER_M = 100;
export const MAPBOX_GRID_RESOLUTION_M = 2;
export const OPEN_METEO_GRID_RESOLUTION_M = 10;

/** What the handler may read as the caller (RLS applies). */
export interface CallerAccess {
  /** Unbuffered extent of a course version, or `null` if invisible / no geometry. */
  courseExtent(courseId: string, version?: number): Promise<(Bbox & { version: number }) | null>;
}

/** `elevation_grids` row. */
export interface ElevationGridRow {
  course_id: string;
  version: number;
  bbox: Bbox;
  resolution_m: number;
  storage_path: string;
  min_m: number;
  max_m: number;
}

/** Service-role persistence for grids (bucket + table). */
export interface GridStore {
  get(courseId: string, version: number): Promise<ElevationGridRow | null>;
  put(row: ElevationGridRow, raster: Uint8Array): Promise<void>;
}

export interface ElevationDeps {
  authenticate(req: Request): Promise<CallerAccess>;
  store: GridStore;
  mapboxToken: string | undefined;
  fetchImpl: FetchLike;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePoints(raw: unknown): LatLng[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POINTS) {
    throw new HttpError(
      400,
      'bad_request',
      `points must be an array of 1–${MAX_POINTS} {lat, lng}`,
    );
  }
  return raw.map((p: unknown, i) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    return {
      lat: parseCoord(o.lat, `points[${i}].lat`, -90, 90),
      lng: parseCoord(o.lng, `points[${i}].lng`, -180, 180),
    };
  });
}

export function storagePathFor(courseId: string, version: number): string {
  return `${courseId}/v${version}.cmeg`;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'bad_request', 'Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export async function handleElevation(req: Request, deps: ElevationDeps): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const caller = await deps.authenticate(req);
  const body = await readBody(req);
  const source: ElevationSource = deps.mapboxToken ? 'mapbox' : 'open-meteo';

  if (body.points !== undefined) {
    const points = parsePoints(body.points);
    const heightsM = deps.mapboxToken
      ? await mapboxHeights(points, deps.mapboxToken, deps.fetchImpl)
      : await openMeteoHeights(points, deps.fetchImpl);
    return json({ source, heightsM });
  }

  if (typeof body.courseId !== 'string' || !UUID.test(body.courseId)) {
    throw new HttpError(400, 'bad_request', 'Body needs points[] or a courseId (uuid)');
  }
  const courseId = body.courseId.toLowerCase();
  let version: number | undefined;
  if (body.version !== undefined) {
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) {
      throw new HttpError(400, 'bad_request', 'version must be a non-negative integer');
    }
    version = body.version;
  }
  const extent = await caller.courseExtent(courseId, version);
  if (extent === null) {
    throw new HttpError(404, 'not_found', 'Course not found, not visible, or without geometry');
  }

  if (body.force !== true) {
    const existing = await deps.store.get(courseId, extent.version);
    if (existing) return json({ ...rowToResponse(existing), reused: true });
  }

  const { version: v, ...raw } = extent;
  const bbox = expandBbox(raw, COURSE_BUFFER_M);
  const grid: ElevationGrid = deps.mapboxToken
    ? await mapboxGrid(bbox, deps.mapboxToken, deps.fetchImpl, MAPBOX_GRID_RESOLUTION_M)
    : await openMeteoGrid(bbox, deps.fetchImpl, OPEN_METEO_GRID_RESOLUTION_M);
  const { min, max } = gridMinMax(grid);
  const row: ElevationGridRow = {
    course_id: courseId,
    version: v,
    bbox: grid.bbox,
    resolution_m: grid.resolutionM,
    storage_path: storagePathFor(courseId, v),
    min_m: Math.round(min * 100) / 100,
    max_m: Math.round(max * 100) / 100,
  };
  await deps.store.put(row, encodeGridRaster(grid));
  return json({
    ...rowToResponse(row),
    width: grid.width,
    height: grid.height,
    source,
    reused: false,
  });
}

function rowToResponse(row: ElevationGridRow) {
  return {
    courseId: row.course_id,
    version: row.version,
    bbox: row.bbox,
    resolutionM: Number(row.resolution_m),
    storagePath: row.storage_path,
    minM: Number(row.min_m),
    maxM: Number(row.max_m),
  };
}
