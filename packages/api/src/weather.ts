/**
 * Weather adapter. Phase 1 calls Open-Meteo directly (free, no key); the
 * interface is what the rest of the app depends on, so this can be swapped
 * for the weather Edge Function (keys server-side, cached in weather_cache)
 * without touching callers.
 */
// TODO(wave-2): route through the Supabase `weather` Edge Function.
import { degToRad } from '@caddymate/engine';
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
