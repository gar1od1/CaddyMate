import { assert, assertAlmostEquals, assertEquals, assertRejects } from '@std/assert';
import { encode } from 'npm:fast-png@6';
import { HttpError } from '../_shared/http.ts';
import {
  decodeGridRaster,
  sampleElevation,
  tileBbox,
  tileForPoint,
  type TileId,
} from '../_shared/terrain.ts';
import {
  type ElevationDeps,
  type ElevationGridRow,
  handleElevation,
  storagePathFor,
} from './handler.ts';

const COURSE = '6f1c7a52-6b0e-4a8e-9a53-3c1f2b7d9e10';
const MOYVALLEY = { lat: 53.4245, lng: -6.9165 };

/** A 256-px Terrain-RGB tile whose height is 100 m + 0.1 m per pixel row. */
function terrainPng(_t: TileId): Uint8Array<ArrayBuffer> {
  const size = 256;
  const data = new Uint8Array(size * size * 3);
  for (let r = 0; r < size; r++) {
    const code = Math.round((100 + 0.1 * r + 10000) / 0.1);
    for (let c = 0; c < size; c++) {
      const o = (r * size + c) * 3;
      data[o] = code >> 16;
      data[o + 1] = (code >> 8) & 255;
      data[o + 2] = code & 255;
    }
  }
  return new Uint8Array(encode({ width: size, height: size, data, channels: 3 }));
}

function fakeFetch(log: string[]) {
  return (url: string): Promise<Response> => {
    log.push(url);
    const u = new URL(url);
    if (u.host === 'api.mapbox.com') {
      const [z, x, y] = u.pathname.replace('.pngraw', '').split('/').slice(-3).map(Number);
      return Promise.resolve(new Response(terrainPng({ z: z!, x: x!, y: y! })));
    }
    const n = u.searchParams.get('latitude')!.split(',').length;
    const lats = u.searchParams.get('latitude')!.split(',').map(Number);
    return Promise.resolve(
      Response.json({ elevation: Array.from({ length: n }, (_, i) => 1000 * (lats[i]! - 53)) }),
    );
  };
}

function deps(over: Partial<ElevationDeps> = {}) {
  const log: string[] = [];
  const saved: { row?: ElevationGridRow; raster?: Uint8Array } = {};
  const d: ElevationDeps = {
    authenticate: () =>
      Promise.resolve({
        courseExtent: (id: string, version?: number) =>
          Promise.resolve(
            id === COURSE
              ? {
                  version: version ?? 3,
                  minLat: 53.423,
                  minLng: -6.918,
                  maxLat: 53.426,
                  maxLng: -6.914,
                }
              : null,
          ),
      }),
    store: {
      get: () => Promise.resolve(null),
      put: (row, raster) => {
        saved.row = row;
        saved.raster = raster;
        return Promise.resolve();
      },
    },
    mapboxToken: undefined,
    fetchImpl: fakeFetch(log),
    ...over,
  };
  return { d, log, saved };
}

const post = (body: unknown, method = 'POST') =>
  new Request('https://fn.local/elevation', {
    method,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

Deno.test('points via Open-Meteo, batched by 100', async () => {
  const { d, log } = deps();
  const points = Array.from({ length: 150 }, (_, i) => ({ lat: 53 + i / 1000, lng: -6.9 }));
  const body = await (await handleElevation(post({ points }), d)).json();
  assertEquals(body.source, 'open-meteo');
  assertEquals(body.heightsM.length, 150);
  assertAlmostEquals(body.heightsM[149], 149, 1e-6);
  assertEquals(log.length, 2);
});

Deno.test('points via Mapbox Terrain-RGB, one fetch per tile, token kept server-side', async () => {
  const { d, log } = deps({ mapboxToken: 'pk.secret' });
  const t = tileForPoint(MOYVALLEY, 15);
  const b = tileBbox(t);
  const mid = { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
  const res = await handleElevation(post({ points: [mid, MOYVALLEY] }), d);
  const text = await res.text();
  assert(!text.includes('pk.secret'));
  const body = JSON.parse(text);
  assertEquals(body.source, 'mapbox');
  assertEquals(log.length, 1);
  assert(log[0]!.includes(`/15/${t.x}/${t.y}.pngraw?access_token=pk.secret`));
  // The tile centre sits between pixel rows 127 and 128.
  assertAlmostEquals(body.heightsM[0], 100 + 0.1 * 127.5, 0.05);
});

Deno.test('course grid (Open-Meteo, 10 m) is built, stored and decodable', async () => {
  const { d, saved } = deps();
  const body = await (await handleElevation(post({ courseId: COURSE }), d)).json();
  assertEquals(body.reused, false);
  assertEquals(body.source, 'open-meteo');
  assertEquals(body.version, 3);
  assertEquals(body.resolutionM, 10);
  assertEquals(body.storagePath, storagePathFor(COURSE, 3));
  assertEquals(saved.row!.storage_path, `${COURSE}/v3.cmeg`);
  const grid = decodeGridRaster(saved.raster!);
  assertEquals([grid.width, grid.height], [body.width, body.height]);
  // 100 m buffer around the course extent.
  assert(grid.bbox.minLat < 53.423 - 0.0008 && grid.bbox.maxLng > -6.914 + 0.0014);
  assertAlmostEquals(sampleElevation(grid, { lat: 53.4245, lng: -6.916 })!, 424.5, 0.5);
  assertAlmostEquals(body.minM, 1000 * (grid.bbox.minLat - 53), 0.5);
});

Deno.test('course grid (Mapbox, 2 m) and reuse of an existing grid', async () => {
  const { d, saved, log } = deps({ mapboxToken: 'pk.x' });
  const body = await (await handleElevation(post({ courseId: COURSE, version: 2 }), d)).json();
  assertEquals(body.source, 'mapbox');
  assertEquals(body.resolutionM, 2);
  assertEquals(body.version, 2);
  assert(log.every((u) => u.startsWith('https://api.mapbox.com/')));
  assert(saved.row!.max_m > saved.row!.min_m);

  const existing = { ...saved.row!, resolution_m: '2.00', min_m: '1.5', max_m: '9.25' };
  const again = deps({
    store: {
      get: () => Promise.resolve(existing as unknown as ElevationGridRow),
      put: () => Promise.reject(new Error('should not write')),
    },
  });
  const reused = await (await handleElevation(post({ courseId: COURSE }), again.d)).json();
  assertEquals(reused.reused, true);
  assertEquals([reused.resolutionM, reused.minM, reused.maxM], [2, 1.5, 9.25]);
  const forced = await (
    await handleElevation(post({ courseId: COURSE, force: true }), deps().d)
  ).json();
  assertEquals(forced.reused, false);
});

Deno.test('rejects bad requests', async () => {
  const { d } = deps();
  const status = async (req: Request, dd = d) =>
    (await assertRejects(() => handleElevation(req, dd), HttpError)).status;
  assertEquals(await status(post({}, 'GET')), 405);
  assertEquals(await status(new Request('https://x', { method: 'POST', body: 'nope' })), 400);
  assertEquals(await status(post([1])), 400);
  assertEquals(await status(post({})), 400);
  assertEquals(await status(post({ points: [] })), 400);
  assertEquals(await status(post({ points: [{ lat: 91, lng: 0 }] })), 400);
  assertEquals(await status(post({ points: [null] })), 400);
  assertEquals(await status(post({ courseId: 'x' })), 400);
  assertEquals(await status(post({ courseId: COURSE, version: -1 })), 400);
  assertEquals(await status(post({ courseId: crypto.randomUUID() })), 404);
  const bad = deps({ fetchImpl: () => Promise.resolve(Response.json({ elevation: [1] })) });
  assertEquals(await status(post({ points: [MOYVALLEY, MOYVALLEY] }), bad.d), 502);
  const huge = { lat: 0, lng: 0 };
  const far = Array.from({ length: 80 }, (_, i) => ({ lat: huge.lat, lng: i }));
  assertEquals(await status(post({ points: far }), deps({ mapboxToken: 'pk.x' }).d), 413);
});
