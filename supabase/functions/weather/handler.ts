/**
 * `GET /weather?lat=…&lng=…&at=<ISO>` → the weather half of `Conditions`
 * (docs/SPEC.md §7) from Open-Meteo, read through `weather_cache` keyed by
 * lat/lng rounded to 3 dp and the UTC hour. Dependencies are injected so the
 * flow is testable without Supabase or the network.
 */
import { HttpError, json, parseCoord } from '../_shared/http.ts';
import {
  chooseWeatherSource,
  isWeatherCacheFresh,
  openMeteoToWeather,
  openMeteoUrl,
  weatherCacheKey,
  type WeatherCacheKey,
  type WeatherReading,
  type WeatherSource,
} from '../_shared/weather.ts';

export interface CachedWeather {
  payload: WeatherReading;
  fetchedAt: Date;
}

export interface WeatherDeps {
  /** Verify the caller; throws HttpError(401) otherwise. */
  authenticate(req: Request): Promise<unknown>;
  cacheGet(key: WeatherCacheKey): Promise<CachedWeather | null>;
  cachePut(key: WeatherCacheKey, payload: WeatherReading): Promise<void>;
  fetchJson(url: string): Promise<unknown>;
  now(): Date;
}

export interface WeatherResponse extends WeatherReading {
  source: WeatherSource;
  cached: boolean;
  /** Rounded cache cell the reading describes. */
  latR: number;
  lngR: number;
  hour: string;
}

export function parseAt(raw: string | null, now: Date): Date {
  if (raw === null || raw === '') return now;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new HttpError(400, 'bad_request', 'at must be an ISO 8601 timestamp');
  return new Date(t);
}

export async function handleWeather(req: Request, deps: WeatherDeps): Promise<Response> {
  if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET');
  await deps.authenticate(req);
  const q = new URL(req.url).searchParams;
  const lat = parseCoord(q.get('lat'), 'lat', -90, 90);
  const lng = parseCoord(q.get('lng'), 'lng', -180, 180);
  const now = deps.now();
  const at = parseAt(q.get('at'), now);
  const source = chooseWeatherSource(at, now);
  if (source === null) {
    throw new HttpError(422, 'out_of_range', 'at is beyond the 16-day forecast horizon');
  }
  const key = weatherCacheKey(lat, lng, at);
  const meta = { source, latR: key.latR, lngR: key.lngR, hour: key.hour };

  // Cache problems must never fail the request: fall through to Open-Meteo.
  const hit = await deps.cacheGet(key).catch((err: unknown) => {
    console.warn('weather_cache read failed', err);
    return null;
  });
  if (hit && isWeatherCacheFresh(key.hour, hit.fetchedAt, now)) {
    return json({ ...hit.payload, ...meta, cached: true } satisfies WeatherResponse);
  }

  let reading: WeatherReading;
  try {
    reading = openMeteoToWeather(await deps.fetchJson(openMeteoUrl(key, source)), at);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'upstream_error', (err as Error).message);
  }
  await deps.cachePut(key, reading).catch((err: unknown) => {
    console.warn('weather_cache write failed', err);
  });
  return json({ ...reading, ...meta, cached: false } satisfies WeatherResponse);
}
