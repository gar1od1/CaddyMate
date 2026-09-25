import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  chooseWeatherSource,
  hourFloorIso,
  isWeatherCacheFresh,
  openMeteoToWeather,
  openMeteoUrl,
  roundCoord,
  weatherCacheKey,
} from './index.js';

const NOW = new Date('2026-09-25T14:37:12Z');
const H = 3_600_000;

describe('cache keys', () => {
  it('rounds coordinates to 3 dp and floors to the UTC hour', () => {
    expect(weatherCacheKey(53.42451, -6.91649, NOW)).toEqual({
      latR: 53.425,
      lngR: -6.916,
      hour: '2026-09-25T14:00:00.000Z',
    });
    expect(roundCoord(1.23456, 2)).toBe(1.23);
    expect(hourFloorIso(new Date('2026-09-25T14:00:00Z'))).toBe('2026-09-25T14:00:00.000Z');
  });

  it('rounding is within half a unit and idempotent (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (x) => {
        const r = roundCoord(x);
        expect(Math.abs(r - x)).toBeLessThanOrEqual(0.0005 + 1e-12);
        expect(roundCoord(r)).toBe(r);
      }),
    );
  });
});

describe('source selection and URLs', () => {
  it('picks current / forecast / archive / none', () => {
    expect(chooseWeatherSource(new Date(NOW.getTime() - 20 * 60_000), NOW)).toBe('current');
    expect(chooseWeatherSource(new Date(NOW.getTime() - 3 * H), NOW)).toBe('forecast');
    expect(chooseWeatherSource(new Date(NOW.getTime() + 48 * H), NOW)).toBe('forecast');
    expect(chooseWeatherSource(new Date(NOW.getTime() - 100 * 24 * H), NOW)).toBe('archive');
    expect(chooseWeatherSource(new Date(NOW.getTime() + 17 * 24 * H), NOW)).toBeNull();
  });

  it('builds Open-Meteo URLs', () => {
    const key = weatherCacheKey(53.4245, -6.9161, NOW);
    const common = 'latitude=53.425&longitude=-6.916&wind_speed_unit=ms&timeformat=unixtime';
    const vars = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure';
    expect(openMeteoUrl(key, 'current')).toBe(
      `https://api.open-meteo.com/v1/forecast?${common}&current=${vars}`,
    );
    expect(openMeteoUrl(key, 'forecast')).toBe(
      `https://api.open-meteo.com/v1/forecast?${common}&hourly=${vars}&timezone=GMT` +
        '&start_hour=2026-09-25T14:00&end_hour=2026-09-25T14:00',
    );
    expect(openMeteoUrl(key, 'archive')).toBe(
      `https://archive-api.open-meteo.com/v1/archive?${common}&hourly=${vars}&timezone=GMT` +
        '&start_date=2026-09-25&end_date=2026-09-25',
    );
  });
});

describe('openMeteoToWeather', () => {
  const current = {
    time: 1_790_347_500, // 2026-09-25T14:45:00Z
    wind_speed_10m: 5.2,
    wind_direction_10m: 250,
    wind_gusts_10m: 9.1,
    temperature_2m: 14.3,
    surface_pressure: 1004.6,
  };

  it('maps the current block', () => {
    expect(openMeteoToWeather({ current }, NOW)).toEqual({
      windSpeedMps: 5.2,
      windFromDeg: 250,
      gustMps: 9.1,
      tempC: 14.3,
      pressureHpa: 1004.6,
      observedAt: '2026-09-25T14:45:00.000Z',
    });
    const bare: Partial<typeof current> = { ...current };
    delete bare.time;
    delete bare.wind_gusts_10m;
    const r = openMeteoToWeather({ current: bare }, NOW);
    expect(r.observedAt).toBe(NOW.toISOString());
    expect('gustMps' in r).toBe(false);
  });

  const t = (iso: string): number => Date.parse(iso) / 1000;
  const hourly = {
    time: [t('2026-09-25T13:00:00Z'), t('2026-09-25T14:00:00Z')],
    wind_speed_10m: [3, 4],
    wind_direction_10m: [180, 190],
    wind_gusts_10m: [6, null],
    temperature_2m: [12, 13],
    surface_pressure: [1010, 1011],
  };

  it('maps the hourly slot for the requested hour', () => {
    expect(openMeteoToWeather({ hourly }, new Date('2026-09-25T13:59:00Z'))).toEqual({
      windSpeedMps: 3,
      windFromDeg: 180,
      gustMps: 6,
      tempC: 12,
      pressureHpa: 1010,
      observedAt: '2026-09-25T13:00:00.000Z',
    });
    expect(openMeteoToWeather({ hourly }, NOW)).not.toHaveProperty('gustMps');
  });

  it('rejects unusable responses', () => {
    expect(() => openMeteoToWeather(null, NOW)).toThrow(/not an object/);
    expect(() => openMeteoToWeather({}, NOW)).toThrow(/neither/);
    expect(() => openMeteoToWeather({ hourly: { time: 5 } }, NOW)).toThrow(/neither/);
    expect(() => openMeteoToWeather({ hourly }, new Date('2026-09-25T20:00:00Z'))).toThrow(
      /no slot/,
    );
    expect(() =>
      openMeteoToWeather({ hourly: { ...hourly, temperature_2m: [12, null] } }, NOW),
    ).toThrow(/missing/);
    expect(() => openMeteoToWeather({ hourly: { ...hourly, surface_pressure: 'x' } }, NOW)).toThrow(
      /missing/,
    );
    expect(() =>
      openMeteoToWeather({ current: { ...current, wind_speed_10m: undefined } }, NOW),
    ).toThrow(/missing/);
    expect(() =>
      openMeteoToWeather({ current: { ...current, wind_direction_10m: NaN } }, NOW),
    ).toThrow(/missing/);
  });
});

describe('isWeatherCacheFresh', () => {
  const hour = '2026-09-25T12:00:00.000Z';
  it('treats readings fetched after their hour as final', () => {
    expect(isWeatherCacheFresh(hour, new Date('2026-09-25T13:05:00Z'), NOW)).toBe(true);
  });
  it('expires readings fetched before their hour ended after the TTL', () => {
    expect(isWeatherCacheFresh(hour, new Date('2026-09-25T12:30:00Z'), NOW)).toBe(false);
    const nowish = new Date('2026-09-25T12:40:00Z');
    expect(isWeatherCacheFresh(hour, new Date('2026-09-25T12:30:00Z'), nowish)).toBe(true);
  });
});
