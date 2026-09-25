/**
 * Phone <-> Garmin watch message protocol (SPEC §11, ADR 001).
 *
 * The watch app (`apps/watch`, Monkey C) is a thin remote: the phone pushes a
 * display-ready `state`, the watch sends back position marks and hole events.
 * This module is the single TypeScript definition of the wire format; the
 * Monkey C side lives in `apps/watch/source/Bridge.mc` and the table in
 * `apps/watch/README.md` must stay in sync with both.
 *
 * Wire constraints (Connect IQ message serialisation): values are plain
 * dictionaries / arrays / strings / numbers / booleans. Monkey C `Float` is
 * 32-bit, so coordinates travel as integer 1e-7 degrees (`latE7`, `lngE7`)
 * and timestamps as integer Unix seconds. Unknown values are *omitted* rather
 * than sent as null, and every decoder treats a missing field as unknown.
 *
 * Units: domain types here are SI (metres, degrees, ms since epoch) like the
 * rest of the app; conversion to the player's display unit happens in
 * `encodeStateMessage`, because the watch is a UI edge and does no maths.
 */
import { metresToYards, yardsToMetres, type LatLng } from '@caddymate/engine';

export const WATCH_PROTOCOL_VERSION = 1;

/** Connect IQ application id from `apps/watch/manifest.xml`. Change both together. */
export const CONNECT_IQ_APP_ID = '3c6bad9f67c047e495ca820294050770';

export type DistanceUnit = 'yd' | 'm';

/** Connect IQ `Position.Quality` enum values as sent by the watch. */
export const GpsQuality = {
  NotAvailable: 0,
  LastKnown: 1,
  Poor: 2,
  Usable: 3,
  Good: 4,
} as const;
export type GpsQuality = (typeof GpsQuality)[keyof typeof GpsQuality];

/**
 * Connect IQ reports a quality bucket, not a radius. These are conservative
 * horizontal-accuracy estimates (metres) used where the app wants
 * `start_accuracy_m` / `end_accuracy_m` (§6.3) and the >8 m prompt (§16).
 */
export const ACCURACY_M_BY_QUALITY: Record<GpsQuality, number | null> = {
  0: null,
  1: 50,
  2: 25,
  3: 10,
  4: 5,
};

// ---------------------------------------------------------------------------
// Domain types (what app code works with)
// ---------------------------------------------------------------------------

export interface WatchClub {
  id: string;
  /** Short label for a 390 px round screen, e.g. "7i", "PW", "Dr". */
  name: string;
}

/** Everything the watch displays. The phone recomputes and resends it on every change. */
export interface WatchState {
  hole: number;
  par: number | null;
  /** Stroke number about to be played on this hole (1-based). */
  stroke: number | null;
  /** Display unit for distances on the watch. */
  unit: DistanceUnit;
  /** Distances in metres from the current ball position. */
  distancesM: {
    front: number | null;
    centre: number | null;
    back: number | null;
    /** To the recommended landing point (§9.4 aim point). */
    landing: number | null;
  };
  recommendation: {
    clubId: string | null;
    /** Club label, e.g. "7i". */
    club: string;
    /** Pre-formatted aim, e.g. "9 yds L". */
    aimText: string;
  } | null;
  /**
   * Cone glyph, real angles in degrees relative to the line to the pin:
   * `aimDeg` + = right (club frame, §4), `halfDeg` = half-width of the cone.
   */
  cone: { aimDeg: number; halfDeg: number } | null;
  /** Bag in display order; populates the watch club picker. */
  clubs: WatchClub[];
  selectedClubId: string | null;
}

export type MarkKind = 'hit' | 'ball';

interface WatchEventBase {
  /** Watch-assigned, monotonically increasing per install. Dedupe key with `tsMs`. */
  id: number;
  /** Hole the watch was showing when the event happened. */
  hole: number;
  /** When the button was pressed, ms since epoch (second resolution). */
  tsMs: number;
}

/** Hit / Ball here from the wrist (§5.3, §5.4). */
export interface WatchMark extends WatchEventBase {
  kind: MarkKind;
  /** The watch's own fix; null if it had none (fall back to the phone's GPS at `tsMs`). */
  position: LatLng | null;
  quality: GpsQuality;
  /** Estimated from `quality`; null when there is no fix. */
  accuracyM: number | null;
  /** Time of the fix itself (ms), which can be older than `tsMs`. */
  fixTsMs: number | null;
}

export type WatchHoled = WatchEventBase;

export interface WatchClubSelected extends WatchEventBase {
  clubId: string;
}

/** Sent once when the watch app starts; the phone should reply with `sendState`. */
export interface WatchHello {
  tsMs: number;
  appVersion: string;
  /** Messages still buffered on the watch (they follow the hello). */
  pending: number;
}

export type WatchInbound =
  | { type: 'hello'; value: WatchHello }
  | { type: 'mark'; value: WatchMark }
  | { type: 'holed'; value: WatchHoled }
  | { type: 'club'; value: WatchClubSelected };

// ---------------------------------------------------------------------------
// Wire types (exactly what crosses Bluetooth)
// ---------------------------------------------------------------------------

export interface WireState {
  v: number;
  type: 'state';
  hole: number;
  par?: number;
  stroke?: number;
  unit: DistanceUnit;
  /** Integers in `unit`. */
  distances: { front?: number; centre?: number; back?: number; landing?: number };
  recommendation?: { clubId?: string; club: string; aimText: string };
  cone?: { aimDeg: number; halfDeg: number };
  clubs: WatchClub[];
  selectedClubId?: string;
}

export type WirePhoneToWatch = WireState;

interface WireEventBase {
  v: number;
  id: number;
  hole: number;
  /** Unix seconds. */
  ts: number;
}

export interface WireHello {
  v: number;
  type: 'hello';
  ts: number;
  appVersion: string;
  pending: number;
}

export interface WireMark extends WireEventBase {
  type: 'mark';
  kind: MarkKind;
  latE7?: number;
  lngE7?: number;
  quality: number;
  fixTs?: number;
}

export interface WireHoled extends WireEventBase {
  type: 'holed';
}

export interface WireClub extends WireEventBase {
  type: 'club';
  clubId: string;
}

export type WireWatchToPhone = WireHello | WireMark | WireHoled | WireClub;

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Phone -> watch
// ---------------------------------------------------------------------------

const E7 = 1e7;

const toUnit = (metres: number, unit: DistanceUnit): number =>
  Math.round(unit === 'yd' ? metresToYards(metres) : metres);

const fromUnit = (value: number, unit: DistanceUnit): number =>
  unit === 'yd' ? yardsToMetres(value) : value;

/** Round to 0.1 deg: plenty for a glyph, and keeps the payload small. */
const roundDeg = (deg: number): number => Math.round(deg * 10) / 10;

/** Domain state -> wire `state` message. Distances become integers in `state.unit`. */
export function encodeStateMessage(state: WatchState): WireState {
  const distances: WireState['distances'] = {};
  for (const key of ['front', 'centre', 'back', 'landing'] as const) {
    const m = state.distancesM[key];
    if (m !== null && Number.isFinite(m)) distances[key] = toUnit(m, state.unit);
  }
  const wire: WireState = {
    v: WATCH_PROTOCOL_VERSION,
    type: 'state',
    hole: state.hole,
    unit: state.unit,
    distances,
    clubs: state.clubs.map(({ id, name }) => ({ id, name })),
  };
  if (state.par !== null) wire.par = state.par;
  if (state.stroke !== null) wire.stroke = state.stroke;
  if (state.recommendation) {
    const { clubId, club, aimText } = state.recommendation;
    wire.recommendation = clubId === null ? { club, aimText } : { clubId, club, aimText };
  }
  if (state.cone) {
    wire.cone = { aimDeg: roundDeg(state.cone.aimDeg), halfDeg: roundDeg(state.cone.halfDeg) };
  }
  if (state.selectedClubId !== null) wire.selectedClubId = state.selectedClubId;
  return wire;
}

/**
 * Wire `state` -> domain state. The phone never receives this message; it
 * exists for tests and for a future on-phone watch preview. Distances come
 * back as metres of the rounded display value.
 */
export function decodeStateMessage(raw: unknown): DecodeResult<WatchState> {
  if (!isRecord(raw) || raw.type !== 'state') return fail('not a state message');
  if (!isInt(raw.v)) return fail('missing protocol version');
  if (!isInt(raw.hole)) return fail('hole must be an integer');
  const unit = raw.unit === 'm' ? 'm' : raw.unit === 'yd' ? 'yd' : null;
  if (!unit) return fail('unit must be "yd" or "m"');
  const d = isRecord(raw.distances) ? raw.distances : {};
  const dist = (k: string): number | null => (isNum(d[k]) ? fromUnit(d[k], unit) : null);

  let recommendation: WatchState['recommendation'] = null;
  if (isRecord(raw.recommendation)) {
    const r = raw.recommendation;
    if (!isStr(r.club) || !isStr(r.aimText)) return fail('recommendation needs club and aimText');
    recommendation = {
      clubId: isStr(r.clubId) ? r.clubId : null,
      club: r.club,
      aimText: r.aimText,
    };
  }
  let cone: WatchState['cone'] = null;
  if (isRecord(raw.cone)) {
    if (!isNum(raw.cone.aimDeg) || !isNum(raw.cone.halfDeg)) return fail('cone needs numbers');
    cone = { aimDeg: raw.cone.aimDeg, halfDeg: raw.cone.halfDeg };
  }
  const clubs: WatchClub[] = [];
  if (Array.isArray(raw.clubs)) {
    for (const c of raw.clubs as unknown[]) {
      if (isRecord(c) && isStr(c.id) && isStr(c.name)) clubs.push({ id: c.id, name: c.name });
    }
  }
  return {
    ok: true,
    value: {
      hole: raw.hole,
      par: isInt(raw.par) ? raw.par : null,
      stroke: isInt(raw.stroke) ? raw.stroke : null,
      unit,
      distancesM: {
        front: dist('front'),
        centre: dist('centre'),
        back: dist('back'),
        landing: dist('landing'),
      },
      recommendation,
      cone,
      clubs,
      selectedClubId: isStr(raw.selectedClubId) ? raw.selectedClubId : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Watch -> phone
// ---------------------------------------------------------------------------

const qualityOf = (q: unknown): GpsQuality =>
  isInt(q) && q >= 0 && q <= 4 ? (q as GpsQuality) : GpsQuality.NotAvailable;

/**
 * Decode anything received from the watch. Tolerant of extra fields and of
 * the Mobile SDK handing numbers over as floats; strict about the fields the
 * app acts on. Unknown `type`s are rejected so callers can log and ignore them.
 */
export function decodeWatchMessage(raw: unknown): DecodeResult<WatchInbound> {
  if (!isRecord(raw)) return fail('message is not an object');
  if (!isInt(raw.v) || raw.v < 1) return fail('missing protocol version');
  if (!isInt(raw.ts)) return fail('ts must be integer seconds');
  const tsMs = raw.ts * 1000;

  if (raw.type === 'hello') {
    return {
      ok: true,
      value: {
        type: 'hello',
        value: {
          tsMs,
          appVersion: isStr(raw.appVersion) ? raw.appVersion : 'unknown',
          pending: isInt(raw.pending) ? raw.pending : 0,
        },
      },
    };
  }

  if (!isInt(raw.id)) return fail('id must be an integer');
  if (!isInt(raw.hole)) return fail('hole must be an integer');
  const base = { id: raw.id, hole: raw.hole, tsMs };

  switch (raw.type) {
    case 'mark': {
      if (raw.kind !== 'hit' && raw.kind !== 'ball') return fail('kind must be hit or ball');
      const hasFix = isInt(raw.latE7) && isInt(raw.lngE7);
      const quality = hasFix ? qualityOf(raw.quality) : GpsQuality.NotAvailable;
      const position =
        hasFix && quality !== GpsQuality.NotAvailable
          ? { lat: (raw.latE7 as number) / E7, lng: (raw.lngE7 as number) / E7 }
          : null;
      if (position && (Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180)) {
        return fail('position out of range');
      }
      return {
        ok: true,
        value: {
          type: 'mark',
          value: {
            ...base,
            kind: raw.kind,
            position,
            quality: position ? quality : GpsQuality.NotAvailable,
            accuracyM: position ? ACCURACY_M_BY_QUALITY[quality] : null,
            fixTsMs: position && isInt(raw.fixTs) ? raw.fixTs * 1000 : null,
          },
        },
      };
    }
    case 'holed':
      return { ok: true, value: { type: 'holed', value: base } };
    case 'club':
      if (!isStr(raw.clubId)) return fail('clubId must be a string');
      return { ok: true, value: { type: 'club', value: { ...base, clubId: raw.clubId } } };
    default:
      return fail(`unknown message type ${JSON.stringify(raw.type)}`);
  }
}

/**
 * Domain event -> wire message, i.e. what the watch would send. Used by tests
 * and by a dev-only watch simulator on the phone.
 */
export function encodeWatchMessage(msg: WatchInbound): WireWatchToPhone {
  const v = WATCH_PROTOCOL_VERSION;
  const s = (ms: number): number => Math.floor(ms / 1000);
  switch (msg.type) {
    case 'hello':
      return {
        v,
        type: 'hello',
        ts: s(msg.value.tsMs),
        appVersion: msg.value.appVersion,
        pending: msg.value.pending,
      };
    case 'mark': {
      const m = msg.value;
      const wire: WireMark = {
        v,
        type: 'mark',
        id: m.id,
        hole: m.hole,
        ts: s(m.tsMs),
        kind: m.kind,
        quality: m.position ? m.quality : GpsQuality.NotAvailable,
      };
      if (m.position) {
        // Monkey C truncates (Double.toNumber); round here, the 1 cm difference is irrelevant.
        wire.latE7 = Math.round(m.position.lat * E7);
        wire.lngE7 = Math.round(m.position.lng * E7);
        if (m.fixTsMs !== null) wire.fixTs = s(m.fixTsMs);
      }
      return wire;
    }
    case 'holed':
      return { v, type: 'holed', id: msg.value.id, hole: msg.value.hole, ts: s(msg.value.tsMs) };
    case 'club':
      return {
        v,
        type: 'club',
        id: msg.value.id,
        hole: msg.value.hole,
        ts: s(msg.value.tsMs),
        clubId: msg.value.clubId,
      };
  }
}

// ---------------------------------------------------------------------------
// At-least-once delivery: dedupe on the phone
// ---------------------------------------------------------------------------

/**
 * The watch retries a message until Connect IQ reports success, and a success
 * can be lost after the phone already received it, so duplicates are normal.
 * `(type, id, ts)` identifies an event: `id` alone can repeat after a watch
 * app reinstall resets its counter, `ts` makes that collision implausible.
 * Persist `seenKeys()` with the round if dedupe must survive an app restart.
 */
export function createInboundDeduper(capacity = 1000, initial: Iterable<string> = []) {
  const seen = new Set<string>(initial);
  return {
    /** True if this event was already accepted; otherwise records it and returns false. */
    isDuplicate(msg: WatchInbound): boolean {
      if (msg.type === 'hello') return false;
      const key = [msg.type, msg.value.id, msg.value.tsMs].join(':');
      if (seen.has(key)) return true;
      seen.add(key);
      if (seen.size > capacity) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return false;
    },
    seenKeys: (): string[] => [...seen],
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
/** Mobile SDKs may hand integers over as doubles; accept integral values. */
function isInt(x: unknown): x is number {
  return isNum(x) && Number.isInteger(x);
}
function isStr(x: unknown): x is string {
  return typeof x === 'string';
}
function fail<T>(error: string): DecodeResult<T> {
  return { ok: false, error };
}
