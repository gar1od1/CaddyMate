import { assertEquals, assertThrows } from '@std/assert';
import {
  chooseWeatherSource,
  isWeatherCacheFresh,
  openMeteoToWeather,
  openMeteoUrl,
  weatherCacheKey,
} from './weather.ts';

const NOW = new Date('2026-09-25T14:37:12Z');

Deno.test('cache key rounds to 3 dp and floors to the UTC hour', () => {
  assertEquals(weatherCacheKey(53.42451, -6.91649, NOW), {
    latR: 53.425,
    lngR: -6.916,
    hour: '2026-09-25T14:00:00.000Z',
  });
  assertEquals(weatherCacheKey(-0.0004, 0.0005, NOW).latR, -0);
});

Deno.test('Open-Meteo current block → Conditions fields', () => {
  const r = openMeteoToWeather(
    {
      current: {
        time: 1_790_347_500,
        wind_speed_10m: 5.2,
        wind_direction_10m: 250,
        wind_gusts_10m: 9.1,
        temperature_2m: 14.3,
        surface_pressure: 1004.6,
      },
    },
    NOW,
  );
  assertEquals(r, {
    windSpeedMps: 5.2,
    windFromDeg: 250,
    gustMps: 9.1,
    tempC: 14.3,
    pressureHpa: 1004.6,
    observedAt: '2026-09-25T14:45:00.000Z',
  });
});

Deno.test('Open-Meteo hourly slot is matched to the hour', () => {
  const t = Date.parse('2026-09-24T09:00:00Z') / 1000;
  const r = openMeteoToWeather(
    {
      hourly: {
        time: [t - 3600, t],
        wind_speed_10m: [1, 2],
        wind_direction_10m: [10, 20],
        wind_gusts_10m: [3, 4],
        temperature_2m: [5, 6],
        surface_pressure: [1000, 1001],
      },
    },
    new Date('2026-09-24T09:59:59Z'),
  );
  assertEquals(r.windSpeedMps, 2);
  assertEquals(r.observedAt, '2026-09-24T09:00:00.000Z');
  assertThrows(() => openMeteoToWeather({ hourly: { time: [] } }, NOW), Error, 'no slot');
});

Deno.test('source selection, URLs and cache freshness', () => {
  assertEquals(chooseWeatherSource(NOW, NOW), 'current');
  assertEquals(chooseWeatherSource(new Date('2026-09-20T10:00:00Z'), NOW), 'forecast');
  assertEquals(chooseWeatherSource(new Date('2025-01-01T10:00:00Z'), NOW), 'archive');
  assertEquals(chooseWeatherSource(new Date('2026-12-01T10:00:00Z'), NOW), null);
  const key = weatherCacheKey(53.4245, -6.9161, new Date('2026-09-20T10:15:00Z'));
  assertEquals(
    new URL(openMeteoUrl(key, 'forecast')).searchParams.get('start_hour'),
    '2026-09-20T10:00',
  );
  assertEquals(new URL(openMeteoUrl(key, 'archive')).host, 'archive-api.open-meteo.com');
  assertEquals(isWeatherCacheFresh(key.hour, new Date('2026-09-20T11:00:00Z'), NOW), true);
  assertEquals(isWeatherCacheFresh(key.hour, new Date('2026-09-20T10:59:00Z'), NOW), false);
});
