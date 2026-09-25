import { createElevationGrid, encodeGridRaster, sampleElevation } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { getElevationGridMeta, loadElevationGrid, requestElevationGrid } from './elevation.js';
import { FakeDb } from './testing/fakeDb.js';

const bbox = { minLat: 53.42, minLng: -6.92, maxLat: 53.43, maxLng: -6.91 };

describe('elevation grids', () => {
  it('returns null when no grid has been built', async () => {
    const db = new FakeDb({ elevation_grids: [] });
    expect(await getElevationGridMeta(db.asDb(), 'c', 1)).toBeNull();
    expect(await loadElevationGrid(db.asDb(), 'c', 1)).toBeNull();
  });

  it('reads the row, downloads the raster and decodes it', async () => {
    const grid = createElevationGrid(bbox, 50, (p) => 100 + (p.lat - bbox.minLat) * 1000);
    const db = new FakeDb({
      elevation_grids: [
        {
          course_id: 'c',
          version: 1,
          bbox,
          resolution_m: 50,
          storage_path: 'c/v1.cmeg',
          min_m: 100,
          max_m: 110,
        },
      ],
    });
    db.files['c/v1.cmeg'] = encodeGridRaster(grid);
    const meta = await getElevationGridMeta(db.asDb(), 'c', 1);
    expect(meta).toMatchObject({ storagePath: 'c/v1.cmeg', resolutionM: 50, minM: 100 });
    const loaded = await loadElevationGrid(db.asDb(), 'c', 1);
    const p = { lat: 53.425, lng: -6.915 };
    expect(sampleElevation(loaded!, p)).toBeCloseTo(sampleElevation(grid, p)!, 3);
  });

  it('asks the elevation function to build a course grid', async () => {
    const db = new FakeDb();
    let body: unknown = null;
    db.invoke = (name, opts) => {
      body = { name, opts };
      return Promise.resolve({
        data: { storagePath: 'c/v2.cmeg', version: 2, reused: false },
        error: null,
      });
    };
    expect(await requestElevationGrid(db.asDb(), 'c')).toMatchObject({ version: 2 });
    expect(body).toEqual({ name: 'elevation', opts: { body: { courseId: 'c' } } });
    db.invoke = () => Promise.resolve({ data: null, error: { message: 'boom' } });
    await expect(requestElevationGrid(db.asDb(), 'c', 2)).rejects.toThrow('boom');
  });
});
