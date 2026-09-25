/**
 * Course elevation grid on the device (docs/SPEC.md §5.1, §7.2, §7.5): the
 * CMEG raster from Storage bucket `elevation`, cached as bytes in SQLite and
 * decoded once per app session. When the course has no grid yet the
 * `elevation` Edge Function is asked to build one in the background (once
 * per session per course; failures are ignored — GPS altitude stands in).
 */
import {
  downloadElevationRaster,
  getElevationGridMeta,
  requestElevationGrid,
} from '@caddymate/api';
import {
  decodeGridRaster,
  sampleElevation,
  type ElevationGrid,
  type LatLng,
} from '@caddymate/engine';
import { useEffect, useState } from 'react';
import * as local from '@/data/local';
import { supabase } from '@/lib/supabase';

const memory = new Map<string, ElevationGrid>();
const loading = new Map<string, Promise<ElevationGrid | null>>();
const requested = new Set<string>();

const keyFor = (courseId: string, version: number) => `grid:${courseId}:v${String(version)}`;

/** The decoded grid if this session already has it (synchronous, for recompute). */
export function cachedGrid(courseId: string, version: number): ElevationGrid | null {
  return memory.get(keyFor(courseId, version)) ?? null;
}

function decode(bytes: Uint8Array): ElevationGrid | null {
  try {
    return decodeGridRaster(bytes);
  } catch {
    return null;
  }
}

async function fromRemote(courseId: string, version: number): Promise<ElevationGrid | null> {
  const meta = await getElevationGridMeta(supabase, courseId, version);
  if (!meta) return null;
  const bytes = await downloadElevationRaster(supabase, meta.storagePath);
  const grid = decode(bytes);
  if (grid) await local.blobSet(keyFor(courseId, version), bytes);
  return grid;
}

/** Fire-and-forget: ask the Edge Function to build the grid, then pick it up. */
function requestBuild(courseId: string, version: number): void {
  const key = keyFor(courseId, version);
  if (requested.has(key)) return;
  requested.add(key);
  void requestElevationGrid(supabase, courseId, version)
    .then(() => fromRemote(courseId, version))
    .then((grid) => {
      if (grid) memory.set(key, grid);
    })
    .catch(() => undefined);
}

/** Cached bytes → remote grid → background build request. Never throws. */
export function loadCourseGrid(courseId: string, version: number): Promise<ElevationGrid | null> {
  const key = keyFor(courseId, version);
  const hit = memory.get(key);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(key);
  if (!p) {
    p = (async () => {
      try {
        const bytes = await local.blobGet(key);
        const cached = bytes ? decode(bytes) : null;
        if (cached) return cached;
        const remote = await fromRemote(courseId, version);
        if (!remote) requestBuild(courseId, version);
        return remote;
      } catch {
        return null;
      }
    })().then((grid) => {
      loading.delete(key);
      if (grid) memory.set(key, grid);
      return grid;
    });
    loading.set(key, p);
  }
  return p;
}

/** The course grid for the play view; null until loaded (or when none exists). */
export function useCourseGrid(
  courseId: string | undefined,
  version: number | undefined,
): ElevationGrid | null {
  const [grid, setGrid] = useState<ElevationGrid | null>(
    courseId !== undefined && version !== undefined ? cachedGrid(courseId, version) : null,
  );
  useEffect(() => {
    if (courseId === undefined || version === undefined) return;
    let alive = true;
    const pick = () =>
      void loadCourseGrid(courseId, version).then((g) => {
        if (alive && g) setGrid(g);
      });
    pick();
    // A background build may land later in the round; look again now and then.
    const timer = setInterval(() => {
      if (cachedGrid(courseId, version)) {
        setGrid(cachedGrid(courseId, version));
        clearInterval(timer);
      }
    }, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [courseId, version]);
  return grid;
}

/** Height sampler for a grid (null off-grid), or null without a grid. */
export const elevationSampler = (grid: ElevationGrid | null) =>
  grid ? (p: LatLng) => sampleElevation(grid, p) : null;
