// Supabase Edge Function `weather` — see ./handler.ts and ../README.md.
import { requireUser, serviceClient } from '../_shared/auth.ts';
import { fetchJson, serveJson } from '../_shared/http.ts';
import type { WeatherReading } from '../_shared/weather.ts';
import { handleWeather } from './handler.ts';

Deno.serve(
  serveJson((req) =>
    handleWeather(req, {
      authenticate: requireUser,
      async cacheGet(key) {
        const { data, error } = await serviceClient()
          .from('weather_cache')
          .select('payload, fetched_at')
          .eq('lat_r', key.latR)
          .eq('lng_r', key.lngR)
          .eq('hour', key.hour)
          .maybeSingle();
        if (error) throw error;
        return data
          ? {
              payload: data.payload as WeatherReading,
              fetchedAt: new Date(data.fetched_at as string),
            }
          : null;
      },
      async cachePut(key, payload) {
        const { error } = await serviceClient().from('weather_cache').upsert({
          lat_r: key.latR,
          lng_r: key.lngR,
          hour: key.hour,
          payload,
          fetched_at: new Date().toISOString(),
        });
        if (error) throw error;
      },
      fetchJson: (url) => fetchJson(url),
      now: () => new Date(),
    }),
  ),
);
