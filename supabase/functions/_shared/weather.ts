/**
 * Server-side copy of packages/engine/src/terrain/weather.ts (Open-Meteo request
 * and response normalisation); `parity_test.ts` checks the two agree.
 */

/** Weather half of the engine's `Conditions` (SI units), plus the instant it describes. */
export interface WeatherReading {
  /** Wind speed at 10 m, m/s. */
  windSpeedMps: number;
  /** Meteorological direction the wind blows FROM, degrees true. */
  windFromDeg: number;
  gustMps?: number;
  tempC: number;
  pressureHpa: number;
  /** ISO timestamp of the observation / forecast slot. */
  observedAt: string;
}

export type WeatherSource = 'current' | 'forecast' | 'archive';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Requests within this window of "now" use Open-Meteo's `current` block. */
export const CURRENT_WINDOW_MS = 30 * 60_000;
/** Forecast API reach: 92 past days, 16 forecast days. */
export const FORECAST_PAST_MS = 92 * DAY_MS;
export const FORECAST_AHEAD_MS = 16 * DAY_MS;
/** A cached reading fetched before its hour ended is re-fetched after this. */
export const WEATHER_CACHE_TTL_MS = 30 * 60_000;

export const OPEN_METEO_VARIABLES =
  'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure';

/** Round a coordinate to `dp` decimals (3 dp ≈ 110 m — one cache cell). */
export function roundCoord(x: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Start of the UTC hour containing `at`, as an ISO string. */
export function hourFloorIso(at: Date): string {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

export interface WeatherCacheKey {
  latR: number;
  lngR: number;
  /** ISO start of the UTC hour. */
  hour: string;
}

/** `weather_cache` primary key for a request. */
export function weatherCacheKey(lat: number, lng: number, at: Date): WeatherCacheKey {
  return { latR: roundCoord(lat), lngR: roundCoord(lng), hour: hourFloorIso(at) };
}

/** Which Open-Meteo product serves `at`; `null` when it is beyond the forecast horizon. */
export function chooseWeatherSource(at: Date, now: Date): WeatherSource | null {
  const dt = at.getTime() - now.getTime();
  if (Math.abs(dt) <= CURRENT_WINDOW_MS) return 'current';
  if (dt > FORECAST_AHEAD_MS) return null;
  return dt < -FORECAST_PAST_MS ? 'archive' : 'forecast';
}

/** Open-Meteo URL for the cache cell `key` from `source`. */
export function openMeteoUrl(key: WeatherCacheKey, source: WeatherSource): string {
  const common = `latitude=${String(key.latR)}&longitude=${String(key.lngR)}&wind_speed_unit=ms&timeformat=unixtime`;
  if (source === 'current') {
    return `https://api.open-meteo.com/v1/forecast?${common}&current=${OPEN_METEO_VARIABLES}`;
  }
  const hourly = `&hourly=${OPEN_METEO_VARIABLES}&timezone=GMT`;
  if (source === 'forecast') {
    const h = key.hour.slice(0, 16); // YYYY-MM-DDTHH:MM
    return `https://api.open-meteo.com/v1/forecast?${common}${hourly}&start_hour=${h}&end_hour=${h}`;
  }
  const d = key.hour.slice(0, 10);
  return `https://archive-api.open-meteo.com/v1/archive?${common}${hourly}&start_date=${d}&end_date=${d}`;
}

type Row = Record<string, unknown>;

function num(block: Row, name: string, i?: number): number | undefined {
  const raw = block[name];
  const v = i === undefined ? raw : Array.isArray(raw) ? (raw as unknown[])[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function reading(block: Row, i: number | undefined, observedAt: string): WeatherReading {
  const windSpeedMps = num(block, 'wind_speed_10m', i);
  const windFromDeg = num(block, 'wind_direction_10m', i);
  const tempC = num(block, 'temperature_2m', i);
  const pressureHpa = num(block, 'surface_pressure', i);
  const gustMps = num(block, 'wind_gusts_10m', i);
  if (
    windSpeedMps === undefined ||
    windFromDeg === undefined ||
    tempC === undefined ||
    pressureHpa === undefined
  ) {
    throw new Error('Open-Meteo response is missing wind, temperature or pressure');
  }
  const out: WeatherReading = { windSpeedMps, windFromDeg, tempC, pressureHpa, observedAt };
  if (gustMps !== undefined) out.gustMps = gustMps;
  return out;
}

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null;

/**
 * Normalise an Open-Meteo JSON response (requested with `wind_speed_unit=ms`,
 * `timeformat=unixtime`). Uses the `current` block when present, otherwise the
 * `hourly` slot for the UTC hour containing `at`.
 */
export function openMeteoToWeather(json: unknown, at: Date): WeatherReading {
  if (!isRow(json)) throw new Error('Open-Meteo response is not an object');
  const current = json.current;
  if (isRow(current)) {
    const t = num(current, 'time');
    return reading(current, undefined, new Date((t ?? at.getTime() / 1000) * 1000).toISOString());
  }
  const hourly = json.hourly;
  const times = isRow(hourly) ? hourly.time : undefined;
  if (!isRow(hourly) || !Array.isArray(times)) {
    throw new Error('Open-Meteo response has neither current nor hourly data');
  }
  const hour = hourFloorIso(at);
  const target = Date.parse(hour) / 1000;
  const i = times.indexOf(target);
  if (i < 0) throw new Error(`Open-Meteo response has no slot for ${hour}`);
  return reading(hourly, i, hour);
}

/**
 * Whether a cached reading for `hourIso`, fetched at `fetchedAt`, can be served
 * at `now`: final once fetched after its hour ended, otherwise for the TTL.
 */
export function isWeatherCacheFresh(hourIso: string, fetchedAt: Date, now: Date): boolean {
  const hourEnd = Date.parse(hourIso) + HOUR_MS;
  return (
    fetchedAt.getTime() >= hourEnd || now.getTime() - fetchedAt.getTime() < WEATHER_CACHE_TTL_MS
  );
}
