/**
 * Course elevation grids (docs/SPEC.md §6.2, §7.2, §7.5). The `elevation`
 * Edge Function builds a CMEG raster per course version into the Storage
 * bucket `elevation` and upserts `elevation_grids`; clients read the row,
 * download the raster and decode it with the engine's `decodeGridRaster`.
 */
import { decodeGridRaster, type Bbox, type ElevationGrid } from '@caddymate/engine';
import type { Db } from './client.js';
import { errorMessage, mustMaybe, num } from './errors.js';

export const ELEVATION_BUCKET = 'elevation';

export interface ElevationGridMeta {
  courseId: string;
  version: number;
  bbox: Bbox;
  resolutionM: number;
  storagePath: string;
  minM: number | null;
  maxM: number | null;
}

/** The `elevation_grids` row for a course version, or null when none has been built yet. */
export async function getElevationGridMeta(
  db: Db,
  courseId: string,
  version: number,
): Promise<ElevationGridMeta | null> {
  const row = mustMaybe(
    await db
      .from('elevation_grids')
      .select('course_id, version, bbox, resolution_m, storage_path, min_m, max_m')
      .eq('course_id', courseId)
      .eq('version', version)
      .maybeSingle(),
    'getElevationGridMeta',
  );
  if (!row) return null;
  return {
    courseId: row.course_id,
    version: row.version,
    bbox: row.bbox as unknown as Bbox,
    resolutionM: num(row.resolution_m) ?? 0,
    storagePath: row.storage_path,
    minM: num(row.min_m),
    maxM: num(row.max_m),
  };
}

/** Raw CMEG bytes of a stored grid (Storage bucket `elevation`). */
export async function downloadElevationRaster(db: Db, storagePath: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(ELEVATION_BUCKET).download(storagePath);
  if (error) throw new Error(`downloadElevationRaster: ${error.message}`);
  // React Native's Blob has no arrayBuffer() on older runtimes; Response does.
  const blob = data as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  const buf =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Response(blob).arrayBuffer();
  return new Uint8Array(buf);
}

/** Meta + decoded grid for a course version, or null when no grid exists. */
export async function loadElevationGrid(
  db: Db,
  courseId: string,
  version: number,
): Promise<ElevationGrid | null> {
  const meta = await getElevationGridMeta(db, courseId, version);
  if (!meta) return null;
  return decodeGridRaster(await downloadElevationRaster(db, meta.storagePath));
}

/**
 * Ask the `elevation` Edge Function to build (or reuse) the course grid:
 * `POST { courseId, version? }`. Resolves with the stored meta.
 */
export async function requestElevationGrid(
  db: Db,
  courseId: string,
  version?: number,
): Promise<{ storagePath: string; version: number; reused: boolean }> {
  type Built = { storagePath: string; version: number; reused: boolean };
  const res = await db.functions.invoke<Built>('elevation', {
    body: version === undefined ? { courseId } : { courseId, version },
  });
  const error: unknown = res.error;
  if (error) throw new Error(`requestElevationGrid: ${errorMessage(error)}`);
  if (!res.data) throw new Error('requestElevationGrid: no data');
  return res.data;
}
