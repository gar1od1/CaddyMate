import { assertAlmostEquals, assertEquals, assertThrows } from '@std/assert';
import {
  createElevationGrid,
  decodeGridRaster,
  decodeTerrainRgb,
  encodeGridRaster,
  expandBbox,
  sampleElevation,
  tileBbox,
  tileForPoint,
  tilesForBbox,
} from './terrain.ts';

const MOYVALLEY = { lat: 53.4245, lng: -6.9165 };

Deno.test('tile maths', () => {
  assertEquals(tileForPoint({ lat: 0, lng: 0 }, 1), { z: 1, x: 1, y: 1 });
  assertEquals(tileForPoint(MOYVALLEY, 15), { z: 15, x: 15754, y: 10609 });
  const b = tileBbox({ z: 15, x: 15754, y: 10609 });
  assertEquals(b.minLat < MOYVALLEY.lat && MOYVALLEY.lat < b.maxLat, true);
  assertEquals(b.minLng < MOYVALLEY.lng && MOYVALLEY.lng < b.maxLng, true);
  assertEquals(
    tilesForBbox(expandBbox({ ...b, maxLat: b.minLat, maxLng: b.minLng }, 1), 15).length,
    4,
  );
});

Deno.test('Terrain-RGB decoding', () => {
  const h = decodeTerrainRgb(new Uint8Array([1, 134, 160, 255, 1, 135, 58, 255]), 2, 1);
  assertAlmostEquals(h[0]!, 0, 1e-4);
  assertAlmostEquals(h[1]!, 15.4, 1e-4);
  assertThrows(() => decodeTerrainRgb(new Uint8Array(5), 2, 1), RangeError);
});

Deno.test('grid raster round-trips', () => {
  const bbox = { minLat: 53.42, minLng: -6.92, maxLat: 53.43, maxLng: -6.91 };
  const g = createElevationGrid(bbox, 50, (p) => 100 * (p.lat - 53) + 10 * p.lng);
  const back = decodeGridRaster(encodeGridRaster(g));
  assertEquals(back, g);
  assertAlmostEquals(sampleElevation(back, { lat: 53.425, lng: -6.915 })!, 42.5 - 69.15, 1e-3);
});
