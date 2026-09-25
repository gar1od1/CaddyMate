import { describe, expect, it, vi } from 'vitest';

import { ConnectIqBridge, NoopWatchBridge, type ConnectIqNativeModule } from './bridge';
import {
  createInboundDeduper,
  decodeStateMessage,
  decodeWatchMessage,
  encodeStateMessage,
  encodeWatchMessage,
  GpsQuality,
  type WatchInbound,
  type WatchState,
} from './protocol';

const MOYVALLEY = { lat: 53.4245123, lng: -6.9165456 };
const T = 1_790_000_000_000; // ms, whole second

const state: WatchState = {
  hole: 7,
  par: 4,
  stroke: 2,
  unit: 'yd',
  distancesM: { front: 128.0, centre: 141.2, back: 155.9, landing: 137.5 },
  recommendation: { clubId: 'c-7i', club: '7i', aimText: '9 yds L' },
  cone: { aimDeg: -2.345, halfDeg: 4.06 },
  clubs: [
    { id: 'c-dr', name: 'Dr' },
    { id: 'c-7i', name: '7i' },
  ],
  selectedClubId: 'c-7i',
};

describe('state (phone -> watch)', () => {
  it('encodes display-ready integers in the chosen unit', () => {
    const wire = encodeStateMessage(state);
    expect(wire).toEqual({
      v: 1,
      type: 'state',
      hole: 7,
      par: 4,
      stroke: 2,
      unit: 'yd',
      distances: { front: 140, centre: 154, back: 170, landing: 150 },
      recommendation: { clubId: 'c-7i', club: '7i', aimText: '9 yds L' },
      cone: { aimDeg: -2.3, halfDeg: 4.1 },
      clubs: state.clubs,
      selectedClubId: 'c-7i',
    });
  });

  it('omits unknown values instead of sending null', () => {
    const wire = encodeStateMessage({
      ...state,
      par: null,
      stroke: null,
      distancesM: { front: null, centre: 100, back: null, landing: null },
      recommendation: null,
      cone: null,
      selectedClubId: null,
    });
    expect(wire).toEqual({
      v: 1,
      type: 'state',
      hole: 7,
      unit: 'yd',
      distances: { centre: 109 },
      clubs: state.clubs,
    });
    expect(JSON.stringify(wire)).not.toContain('null');
  });

  it.each(['yd', 'm'] as const)('round-trips within half a display unit (%s)', (unit) => {
    const decoded = decodeStateMessage(encodeStateMessage({ ...state, unit }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const halfUnitM = unit === 'yd' ? 0.4572 : 0.5;
    for (const k of ['front', 'centre', 'back', 'landing'] as const) {
      expect(Math.abs(decoded.value.distancesM[k]! - state.distancesM[k]!)).toBeLessThanOrEqual(
        halfUnitM,
      );
    }
    expect({ ...decoded.value, distancesM: null, cone: null }).toEqual({
      ...state,
      unit,
      distancesM: null,
      cone: null,
    });
    expect(decoded.value.cone).toEqual({ aimDeg: -2.3, halfDeg: 4.1 });
  });

  it('survives a JSON round trip (what a native bridge effectively does)', () => {
    const wire = encodeStateMessage(state);
    expect(decodeStateMessage(JSON.parse(JSON.stringify(wire)))).toEqual(decodeStateMessage(wire));
  });

  it('rejects malformed state', () => {
    expect(decodeStateMessage(null).ok).toBe(false);
    expect(decodeStateMessage({ type: 'state', v: 1, hole: 1, unit: 'km' }).ok).toBe(false);
    expect(decodeStateMessage({ type: 'state', v: 1, hole: 1.5, unit: 'yd' }).ok).toBe(false);
  });
});

describe('events (watch -> phone)', () => {
  const events: WatchInbound[] = [
    { type: 'hello', value: { tsMs: T, appVersion: '0.1.0', pending: 3 } },
    {
      type: 'mark',
      value: {
        id: 12,
        hole: 7,
        tsMs: T,
        kind: 'hit',
        position: MOYVALLEY,
        quality: GpsQuality.Good,
        accuracyM: 5,
        fixTsMs: T - 1000,
      },
    },
    {
      type: 'mark',
      value: {
        id: 13,
        hole: 7,
        tsMs: T + 60_000,
        kind: 'ball',
        position: null,
        quality: GpsQuality.NotAvailable,
        accuracyM: null,
        fixTsMs: null,
      },
    },
    { type: 'holed', value: { id: 14, hole: 7, tsMs: T + 120_000 } },
    { type: 'club', value: { id: 15, hole: 8, tsMs: T + 180_000, clubId: 'c-dr' } },
  ];

  it.each(events.map((e) => [e.type, e] as const))('round-trips %s', (_type, event) => {
    const wire = encodeWatchMessage(event);
    const decoded = decodeWatchMessage(JSON.parse(JSON.stringify(wire)));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    if (decoded.value.type === 'mark' && event.type === 'mark' && event.value.position) {
      const p = decoded.value.value.position!;
      expect(Math.abs(p.lat - event.value.position.lat)).toBeLessThan(1e-7);
      expect(Math.abs(p.lng - event.value.position.lng)).toBeLessThan(1e-7);
      expect({ ...decoded.value.value, position: null }).toEqual({
        ...event.value,
        position: null,
      });
    } else {
      expect(decoded.value).toEqual(event);
    }
  });

  it('encodes coordinates as integer 1e-7 degrees', () => {
    const wire = encodeWatchMessage(events[1]!);
    expect(wire).toMatchObject({ latE7: 534245123, lngE7: -69165456, quality: 4 });
  });

  it('decodes exactly what the Monkey C Bridge sends', () => {
    // Shape produced by Bridge.sendMark on the watch (a truncated Double -> Number).
    const fromWatch = {
      v: 1,
      id: 3,
      type: 'mark',
      kind: 'ball',
      hole: 2,
      ts: 1_790_000_100,
      latE7: 534245120,
      lngE7: -69165450,
      quality: 3,
      fixTs: 1_790_000_099,
    };
    expect(decodeWatchMessage(fromWatch)).toEqual({
      ok: true,
      value: {
        type: 'mark',
        value: {
          id: 3,
          hole: 2,
          tsMs: 1_790_000_100_000,
          kind: 'ball',
          position: { lat: 53.424512, lng: -6.916545 },
          quality: GpsQuality.Usable,
          accuracyM: 10,
          fixTsMs: 1_790_000_099_000,
        },
      },
    });
  });

  it('treats a mark without coordinates, or with quality 0, as having no fix', () => {
    const noQuality = decodeWatchMessage({
      v: 1,
      id: 1,
      type: 'mark',
      kind: 'hit',
      hole: 1,
      ts: 1,
      latE7: 1,
      lngE7: 1,
      quality: 0,
    });
    expect(noQuality.ok && noQuality.value.type === 'mark' && noQuality.value.value.position).toBe(
      null,
    );
  });

  it('rejects malformed or unknown messages', () => {
    const base = { v: 1, id: 1, hole: 1, ts: 1 };
    expect(decodeWatchMessage('hit').ok).toBe(false);
    expect(decodeWatchMessage({ ...base, type: 'mark', kind: 'drop' }).ok).toBe(false);
    expect(decodeWatchMessage({ ...base, type: 'club' }).ok).toBe(false);
    expect(decodeWatchMessage({ ...base, type: 'reboot' }).ok).toBe(false);
    expect(decodeWatchMessage({ ...base, v: undefined, type: 'holed' }).ok).toBe(false);
    expect(decodeWatchMessage({ ...base, id: 'x', type: 'holed' }).ok).toBe(false);
    expect(
      decodeWatchMessage({ ...base, type: 'mark', kind: 'hit', latE7: 1e9, lngE7: 0, quality: 4 })
        .ok,
    ).toBe(false);
  });
});

describe('dedupe and bridges', () => {
  const holed = { v: 1, type: 'holed', id: 9, hole: 3, ts: 100 };

  it('drops replayed events but not hellos', () => {
    const d = createInboundDeduper(2);
    const msg = decodeWatchMessage(holed);
    const hello = decodeWatchMessage({ v: 1, type: 'hello', ts: 1, appVersion: 'x', pending: 0 });
    if (!msg.ok || !hello.ok) throw new Error('decode failed');
    expect(d.isDuplicate(msg.value)).toBe(false);
    expect(d.isDuplicate(msg.value)).toBe(true);
    expect(d.isDuplicate(hello.value)).toBe(false);
    expect(d.isDuplicate(hello.value)).toBe(false);
  });

  it('dispatches decoded events once to subscribers', () => {
    const bridge = new NoopWatchBridge();
    const onHoled = vi.fn();
    const off = bridge.onHoled(onHoled);
    expect(bridge.receive(holed)).toBe(true);
    expect(bridge.receive(holed)).toBe(false);
    expect(onHoled).toHaveBeenCalledOnce();
    expect(onHoled).toHaveBeenCalledWith({ id: 9, hole: 3, tsMs: 100_000 });
    off();
    bridge.receive({ ...holed, id: 10 });
    expect(onHoled).toHaveBeenCalledOnce();
  });

  it('ConnectIqBridge sends encoded state through the native module', async () => {
    let listener: ((p: unknown) => void) | undefined;
    const initialize = vi.fn(async () => {});
    const sendMessage = vi.fn<ConnectIqNativeModule['sendMessage']>(async () => {});
    const native: ConnectIqNativeModule = {
      initialize,
      sendMessage,
      addMessageListener: (l) => {
        listener = l;
        return { remove: () => (listener = undefined) };
      },
    };
    const bridge = new ConnectIqBridge(native);
    const onMark = vi.fn();
    bridge.onMark(onMark);
    await bridge.sendState(state);
    expect(initialize).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(encodeStateMessage(state));
    listener?.(encodeWatchMessage({ type: 'holed', value: { id: 1, hole: 7, tsMs: T } }));
    listener?.({ v: 1, type: 'mark', kind: 'hit', id: 2, hole: 7, ts: 5, quality: 0 });
    expect(onMark).toHaveBeenCalledOnce();
    expect(new ConnectIqBridge(null).isAvailable).toBe(false);
  });
});
