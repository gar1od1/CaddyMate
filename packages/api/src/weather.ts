/**
 * Weather adapter. `getWeather` goes through the Supabase `weather` Edge
 * Function (cached server-side in `weather_cache`, see
 * supabase/functions/README.md) and falls back to calling Open-Meteo
 * directly when the function errors (e.g. local dev without functions).
 */
import { degToRad } from '@caddymate/engine';
import type { Db } from './client.js';
import { errorMessage } from './errors.js';
import type { WeatherSnapshot } from './types.js';

type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export function openMeteoUrl(lat: number, lng: number): string {
  const params = [
    `latitude=${lat.toFixed(4)}`,
    `longitude=${lng.toFixed(4)}`,
    'current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure',
    'wind_speed_unit=ms',
  ];
  return `${OPEN_METEO_URL}?${params.join('&')}`;
}

interface OpenMeteoCurrent {
  time?: string;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number | null;
  temperature_2m?: number;
  surface_pressure?: number;
}

/** Map an Open-Meteo `/forecast?current=…` payload to a snapshot. */
export function parseOpenMeteo(payload: unknown, now = new Date()): WeatherSnapshot {
  const current = (payload as { current?: OpenMeteoCurrent } | null)?.current;
  if (!current || typeof current.wind_speed_10m !== 'number') {
    throw new Error('Open-Meteo: missing current conditions');
  }
  return {
    windSpeedMps: current.wind_speed_10m,
    windFromDeg: current.wind_direction_10m ?? 0,
    gustMps: current.wind_gusts_10m ?? null,
    tempC: current.temperature_2m ?? 20,
    pressureHpa: current.surface_pressure ?? 1013.25,
    fetchedAt: now.toISOString(),
    source: 'open-meteo',
  };
}

export async function fetchWeather(
  lat: number,
  lng: number,
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<WeatherSnapshot> {
  const res = await fetchImpl(openMeteoUrl(lat, lng));
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${String(res.status)}`);
  return parseOpenMeteo(await res.json());
}

/** Response of the `weather` Edge Function (`GET ?lat=&lng=[&at=]`). */
interface WeatherFunctionResponse {
  windSpeedMps?: number;
  windFromDeg?: number;
  gustMps?: number | null;
  tempC?: number;
  pressureHpa?: number;
  observedAt?: string;
  source?: string;
}

/** Map the `weather` Edge Function's JSON to a snapshot. */
export function parseWeatherFunction(payload: unknown, now = new Date()): WeatherSnapshot {
  const p = payload as WeatherFunctionResponse | null;
  if (!p || typeof p.windSpeedMps !== 'number' || typeof p.windFromDeg !== 'number') {
    throw new Error('weather function: malformed response');
  }
  return {
    windSpeedMps: p.windSpeedMps,
    windFromDeg: p.windFromDeg,
    gustMps: typeof p.gustMps === 'number' ? p.gustMps : null,
    tempC: p.tempC ?? 20,
    pressureHpa: p.pressureHpa ?? 1013.25,
    fetchedAt: now.toISOString(),
    source: `edge:${p.source ?? 'current'}`,
  };
}

/** Weather through the `weather` Edge Function; throws on any function error. */
export async function fetchWeatherViaFunction(
  db: Pick<Db, 'functions'>,
  lat: number,
  lng: number,
  at?: Date,
): Promise<WeatherSnapshot> {
  const q = [`lat=${lat.toFixed(5)}`, `lng=${lng.toFixed(5)}`];
  if (at) q.push(`at=${encodeURIComponent(at.toISOString())}`);
  const res = await db.functions.invoke<unknown>(`weather?${q.join('&')}`, { method: 'GET' });
  const error: unknown = res.error;
  if (error) throw new Error(`weather function: ${errorMessage(error)}`);
  return parseWeatherFunction(res.data);
}

/**
 * Current weather at a point: the Edge Function first, Open-Meteo directly
 * when it fails. Throws only when both fail.
 */
export async function getWeather(
  db: Pick<Db, 'functions'>,
  lat: number,
  lng: number,
  fetchImpl?: FetchLike,
): Promise<WeatherSnapshot> {
  try {
    return await fetchWeatherViaFunction(db, lat, lng);
  } catch {
    return fetchWeather(lat, lng, fetchImpl);
  }
}

export interface WindComponents {
  /** + into the player's face (headwind), − tailwind. m/s. */
  headMps: number;
  /** + from the player's left (pushes the ball right), m/s. */
  crossMps: number;
}

/**
 * Decompose wind (blowing FROM `windFromDeg`) along an intended line on
 * `lineBearingDeg` (docs/SPEC.md §7.1 sign conventions).
 */
export function windComponents(
  speedMps: number,
  windFromDeg: number,
  lineBearingDeg: number,
): WindComponents {
  const δ = degToRad(windFromDeg - lineBearingDeg);
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { headMps: clean(speedMps * Math.cos(δ)), crossMps: clean(-speedMps * Math.sin(δ)) };
}
