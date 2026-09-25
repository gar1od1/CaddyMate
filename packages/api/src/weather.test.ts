import { describe, expect, it } from 'vitest';
import { FakeDb } from './testing/fakeDb.js';
import {
  fetchWeather,
  fetchWeatherViaFunction,
  getWeather,
  openMeteoUrl,
  parseOpenMeteo,
  parseWeatherFunction,
  windComponents,
} from './weather.js';

const payload = {
  current: {
    time: '2026-09-25T10:00',
    wind_speed_10m: 5.2,
    wind_direction_10m: 250,
    wind_gusts_10m: 9.1,
    temperature_2m: 14.3,
    surface_pressure: 1004.2,
  },
};

describe('weather adapter', () => {
  it('builds the Open-Meteo URL in m/s', () => {
    const url = openMeteoUrl(53.4245, -6.9165);
    expect(url).toContain('latitude=53.4245');
    expect(url).toContain('longitude=-6.9165');
    expect(url).toContain('wind_speed_unit=ms');
    expect(url).toContain('surface_pressure');
  });

  it('parses the current block', () => {
    const w = parseOpenMeteo(payload, new Date('2026-09-25T10:05:00Z'));
    expect(w).toMatchObject({
      windSpeedMps: 5.2,
      windFromDeg: 250,
      gustMps: 9.1,
      tempC: 14.3,
      pressureHpa: 1004.2,
      source: 'open-meteo',
    });
    expect(() => parseOpenMeteo({})).toThrow();
  });

  it('fetches through an injectable fetch', async () => {
    const w = await fetchWeather(1, 2, () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
    );
    expect(w.windSpeedMps).toBe(5.2);
    await expect(
      fetchWeather(1, 2, () =>
        Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
      ),
    ).rejects.toThrow('500');
  });

  it('decomposes wind along the line (SPEC §7.1 signs)', () => {
    // Playing north, wind from the north: pure headwind.
    expect(windComponents(5, 0, 0)).toEqual({ headMps: 5, crossMps: 0 });
    // Wind from the south: tailwind.
    expect(windComponents(5, 180, 0).headMps).toBeCloseTo(-5);
    // Wind from the west while playing north: from the player's left → +cross.
    const w = windComponents(5, 270, 0);
    expect(w.headMps).toBeCloseTo(0);
    expect(w.crossMps).toBeCloseTo(5);
    expect(windComponents(5, 90, 0).crossMps).toBeCloseTo(-5);
  });
});

describe('weather via the Edge Function', () => {
  const fnPayload = {
    windSpeedMps: 4.1,
    windFromDeg: 200,
    tempC: 12,
    pressureHpa: 1001,
    observedAt: '2026-09-25T10:00:00Z',
    source: 'current',
    cached: true,
  };

  it('parses the function response', () => {
    expect(parseWeatherFunction(fnPayload)).toMatchObject({
      windSpeedMps: 4.1,
      windFromDeg: 200,
      gustMps: null,
      tempC: 12,
      pressureHpa: 1001,
      source: 'edge:current',
    });
    expect(() => parseWeatherFunction({ tempC: 1 })).toThrow('malformed');
  });

  it('invokes GET weather?lat=&lng=', async () => {
    const db = new FakeDb();
    const calls: { name: string; opts: unknown }[] = [];
    db.invoke = (name, opts) => {
      calls.push({ name, opts });
      return Promise.resolve({ data: fnPayload, error: null });
    };
    const w = await fetchWeatherViaFunction(db.asDb(), 53.4245, -6.9165);
    expect(w.windSpeedMps).toBe(4.1);
    expect(calls[0]!.name).toBe('weather?lat=53.42450&lng=-6.91650');
    expect(calls[0]!.opts).toEqual({ method: 'GET' });
  });

  it('falls back to Open-Meteo when the function errors', async () => {
    const db = new FakeDb();
    db.invoke = () => Promise.resolve({ data: null, error: { message: 'relay error' } });
    const w = await getWeather(db.asDb(), 1, 2, () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
    );
    expect(w.source).toBe('open-meteo');
    db.invoke = () => Promise.resolve({ data: fnPayload, error: null });
    expect((await getWeather(db.asDb(), 1, 2)).source).toBe('edge:current');
  });
});
