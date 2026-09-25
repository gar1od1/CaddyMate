/**
 * Weather for the play view: one fetch per hole (cached in the kv store for
 * 15 min) through the `weather` Edge Function, Open-Meteo directly as fallback.
 */
import { getWeather, type WeatherSnapshot } from '@caddymate/api';
import type { LatLng } from '@caddymate/engine';
import { useEffect, useState } from 'react';
import * as local from '@/data/local';
import { supabase } from '@/lib/supabase';

const TTL_MS = 15 * 60_000;

export async function weatherAt(p: LatLng): Promise<WeatherSnapshot> {
  const key = `weather:${p.lat.toFixed(2)}:${p.lng.toFixed(2)}`;
  const cached = await local.kvGet<WeatherSnapshot>(key);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;
  const fresh = await getWeather(supabase, p.lat, p.lng);
  await local.kvSet(key, fresh);
  return fresh;
}

export function useWeather(p: LatLng | null, holeKey: string): WeatherSnapshot | null {
  const [w, setW] = useState<WeatherSnapshot | null>(null);
  const lat = p?.lat;
  const lng = p?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let alive = true;
    weatherAt({ lat, lng })
      .then((v) => alive && setW(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Re-fetch per hole, not per GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeKey, lat === undefined]);
  return w;
}
