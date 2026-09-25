/**
 * The Edge Functions carry a copy of the engine's terrain/weather maths (they
 * are bundled from supabase/functions only). This test runs both on the same
 * inputs so the copy cannot drift. Needs `--unstable-sloppy-imports` because
 * the engine's sources use `.js` import specifiers (see deno.json `test` task).
 */
import { assertEquals } from '@std/assert';
import * as engine from '@caddymate/engine/terrain';
import * as terrain from './terrain.ts';
import * as weather from './weather.ts';

const bbox = { minLat: 53.421, minLng: -6.921, maxLat: 53.428, maxLng: -6.909 };
const probes = Array.from({ length: 25 }, (_, i) => ({
  lat: bbox.minLat + (((i * 7) % 25) / 24) * (bbox.maxLat - bbox.minLat),
  lng: bbox.minLng + (((i * 11) % 25) / 24) * (bbox.maxLng - bbox.minLng),
}));
const surface = (p: { lat: number; lng: number }) => 80 + Math.sin(p.lat * 4e3) * 5 + p.lng;

Deno.test('terrain mirror matches the engine', () => {
  const a = engine.createElevationGrid(bbox, 7, surface);
  const b = terrain.createElevationGrid(bbox, 7, surface);
  assertEquals(b, a);
  assertEquals(terrain.encodeGridRaster(b), engine.encodeGridRaster(a));
  assertEquals(terrain.expandBbox(bbox, 100), engine.expandBbox(bbox, 100));
  assertEquals(terrain.gridMinMax(b), engine.gridMinMax(a));
  for (const p of probes) {
    assertEquals(terrain.sampleElevation(b, p), engine.sampleElevation(a, p));
    for (const z of [0, 12, 15]) {
      assertEquals(terrain.tileForPoint(p, z), engine.tileForPoint(p, z));
      assertEquals(terrain.latToTileY(p.lat, z), engine.latToTileY(p.lat, z));
    }
  }
  const ids = terrain.tilesForBbox(bbox, 15);
  assertEquals(ids, engine.tilesForBbox(bbox, 15));
  const tiles = ids.map((t, k) => {
    const heights = new Float32Array(16).map((_, i) => 50 + i * 0.5 + k);
    return { ...t, size: 4, heights };
  });
  assertEquals(terrain.gridFromTiles(tiles, bbox, 20), engine.gridFromTiles(tiles, bbox, 20));
  for (const p of probes) {
    assertEquals(terrain.sampleHeightTile(tiles[0]!, p), engine.sampleHeightTile(tiles[0]!, p));
  }
  const px = new Uint8Array([1, 134, 160, 7, 8, 9]);
  assertEquals(terrain.decodeTerrainRgb(px, 2, 1), engine.decodeTerrainRgb(px, 2, 1));
});

Deno.test('weather mirror matches the engine', () => {
  const now = new Date('2026-09-25T14:37:12Z');
  for (const at of ['2026-09-25T14:50:00Z', '2026-09-24T03:10:00Z', '2025-02-01T00:00:00Z']) {
    const d = new Date(at);
    const key = weather.weatherCacheKey(53.42451, -6.91649, d);
    assertEquals(key, engine.weatherCacheKey(53.42451, -6.91649, d));
    const src = weather.chooseWeatherSource(d, now)!;
    assertEquals(src, engine.chooseWeatherSource(d, now));
    assertEquals(weather.openMeteoUrl(key, src), engine.openMeteoUrl(key, src));
  }
  const body = {
    current: {
      time: 1_790_347_500,
      wind_speed_10m: 5,
      wind_direction_10m: 90,
      temperature_2m: 12,
      surface_pressure: 1000,
    },
  };
  assertEquals(weather.openMeteoToWeather(body, now), engine.openMeteoToWeather(body, now));
});
