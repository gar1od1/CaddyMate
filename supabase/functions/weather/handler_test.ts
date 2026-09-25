import { assertEquals, assertRejects } from '@std/assert';
import { HttpError } from '../_shared/http.ts';
import type { WeatherCacheKey, WeatherReading } from '../_shared/weather.ts';
import { type CachedWeather, handleWeather, type WeatherDeps } from './handler.ts';

const NOW = new Date('2026-09-25T14:37:12Z');
const CURRENT = {
  current: {
    time: 1_790_347_500,
    wind_speed_10m: 5.2,
    wind_direction_10m: 250,
    wind_gusts_10m: 9.1,
    temperature_2m: 14.3,
    surface_pressure: 1004.6,
  },
};

function fakeDeps(over: Partial<WeatherDeps> = {}) {
  const store = new Map<string, CachedWeather>();
  const calls = { fetch: [] as string[], put: 0 };
  const k = (key: WeatherCacheKey) => `${key.latR}/${key.lngR}/${key.hour}`;
  const deps: WeatherDeps = {
    authenticate: () => Promise.resolve({}),
    cacheGet: (key) => Promise.resolve(store.get(k(key)) ?? null),
    cachePut: (key, payload: WeatherReading) => {
      calls.put++;
      store.set(k(key), { payload, fetchedAt: NOW });
      return Promise.resolve();
    },
    fetchJson: (url) => {
      calls.fetch.push(url);
      return Promise.resolve(CURRENT);
    },
    now: () => NOW,
    ...over,
  };
  return { deps, store, calls };
}

const get = (qs: string, method = 'GET') =>
  new Request(`https://fn.local/weather?${qs}`, { method });

Deno.test('miss → Open-Meteo → cache; second call is a hit', async () => {
  const { deps, calls } = fakeDeps();
  const r1 = await handleWeather(get('lat=53.42451&lng=-6.91649'), deps);
  const b1 = await r1.json();
  assertEquals(b1, {
    windSpeedMps: 5.2,
    windFromDeg: 250,
    gustMps: 9.1,
    tempC: 14.3,
    pressureHpa: 1004.6,
    observedAt: '2026-09-25T14:45:00.000Z',
    source: 'current',
    latR: 53.425,
    lngR: -6.916,
    hour: '2026-09-25T14:00:00.000Z',
    cached: false,
  });
  assertEquals(calls.fetch.length, 1);
  assertEquals(new URL(calls.fetch[0]!).searchParams.get('latitude'), '53.425');
  const b2 = await (await handleWeather(get('lat=53.4249&lng=-6.9161'), deps)).json();
  assertEquals(b2.cached, true);
  assertEquals(calls.fetch.length, 1);
});

Deno.test('past hour uses the hourly forecast slot', async () => {
  const t = Date.parse('2026-09-25T09:00:00Z') / 1000;
  const { deps, calls } = fakeDeps({
    fetchJson: (url) => {
      calls.fetch.push(url);
      return Promise.resolve({
        hourly: {
          time: [t],
          wind_speed_10m: [3],
          wind_direction_10m: [200],
          temperature_2m: [11],
          surface_pressure: [1012],
        },
      });
    },
  });
  const body = await (
    await handleWeather(get('lat=53&lng=-7&at=2026-09-25T09:20:00Z'), deps)
  ).json();
  assertEquals(body.source, 'forecast');
  assertEquals(body.windSpeedMps, 3);
  assertEquals(body.gustMps, undefined);
  assertEquals(new URL(calls.fetch[0]!).searchParams.get('start_hour'), '2026-09-25T09:00');
});

Deno.test('stale cache entries are refetched; cache failures are tolerated', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const stale = fakeDeps({
      cacheGet: () =>
        Promise.resolve({
          payload: { windSpeedMps: 0, windFromDeg: 0, tempC: 0, pressureHpa: 0, observedAt: '' },
          fetchedAt: new Date('2026-09-25T13:00:00Z'),
        }),
    });
    assertEquals(
      (await (await handleWeather(get('lat=1&lng=2'), stale.deps)).json()).cached,
      false,
    );
    const broken = fakeDeps({
      cacheGet: () => Promise.reject(new Error('db down')),
      cachePut: () => Promise.reject(new Error('db down')),
    });
    const res = await handleWeather(get('lat=1&lng=2'), broken.deps);
    assertEquals(res.status, 200);
  } finally {
    console.warn = warn;
  }
});

Deno.test('rejects bad requests', async () => {
  const { deps } = fakeDeps();
  const status = async (req: Request, d = deps) =>
    (await assertRejects(() => handleWeather(req, d), HttpError)).status;
  assertEquals(await status(get('lat=1&lng=2', 'POST')), 405);
  assertEquals(await status(get('lng=2')), 400);
  assertEquals(await status(get('lat=1&lng=200')), 400);
  assertEquals(await status(get('lat=1&lng=2&at=yesterday')), 400);
  assertEquals(await status(get('lat=1&lng=2&at=2027-01-01T00:00:00Z')), 422);
  const unauth = fakeDeps({
    authenticate: () => Promise.reject(new HttpError(401, 'unauthorized', 'no')),
  });
  assertEquals(await status(get('lat=1&lng=2'), unauth.deps), 401);
  const junk = fakeDeps({ fetchJson: () => Promise.resolve({}) });
  assertEquals(await status(get('lat=1&lng=2'), junk.deps), 502);
  const down = fakeDeps({
    fetchJson: () => Promise.reject(new HttpError(504, 'upstream_timeout', 'slow')),
  });
  assertEquals(await status(get('lat=1&lng=2'), down.deps), 504);
});
