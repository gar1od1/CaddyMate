/**
 * PostGIS geography <-> app types.
 *
 * PostgREST serialises `geography` columns with Postgres' text output, which is
 * hex-encoded EWKB (e.g. `0101000020E6100000…`) — PostGIS only defines a JSON
 * cast for `geometry`, not `geography` (verified against PostGIS 3 locally).
 * So reads decode EWKB here; GeoJSON objects/strings are accepted as well in
 * case a view or RPC returns them. Writes use EWKT (`SRID=4326;POINT(lng lat)`),
 * which the geography input function accepts directly.
 */
import type { LatLng, Polygon } from '@caddymate/engine';

export type Position = [number, number];

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

const WKB_Z = 0x80000000;
const WKB_M = 0x40000000;
const WKB_SRID = 0x20000000;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('invalid hex in EWKB');
    out[i] = byte;
  }
  return out;
}

class Reader {
  private offset = 0;
  private little = true;
  constructor(private readonly view: DataView) {}
  setEndian(byte: number) {
    this.little = byte === 1;
  }
  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, this.little);
    this.offset += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.offset, this.little);
    this.offset += 8;
    return v;
  }
}

function readGeometry(r: Reader): Geometry {
  r.setEndian(r.u8());
  let type = r.u32();
  let dims = 2;
  if (type & WKB_Z) dims++;
  if (type & WKB_M) dims++;
  if (type & WKB_SRID) r.u32();
  type &= 0x0fffffff;
  // ISO WKB encodes Z/M as +1000/+2000/+3000 instead of flag bits.
  if (type >= 1000) {
    const iso = Math.floor(type / 1000);
    dims = iso === 3 ? 4 : 3;
    type %= 1000;
  }
  const point = (): Position => {
    const x = r.f64();
    const y = r.f64();
    for (let d = 2; d < dims; d++) r.f64();
    return [x, y];
  };
  const points = (): Position[] => {
    const n = r.u32();
    const out: Position[] = [];
    for (let i = 0; i < n; i++) out.push(point());
    return out;
  };
  const rings = (): Position[][] => {
    const n = r.u32();
    const out: Position[][] = [];
    for (let i = 0; i < n; i++) out.push(points());
    return out;
  };
  const children = <T extends Geometry>(): T[] => {
    const n = r.u32();
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(readGeometry(r) as T);
    return out;
  };
  switch (type) {
    case 1:
      return { type: 'Point', coordinates: point() };
    case 2:
      return { type: 'LineString', coordinates: points() };
    case 3:
      return { type: 'Polygon', coordinates: rings() };
    case 4:
      return {
        type: 'MultiPoint',
        coordinates: children<{ type: 'Point'; coordinates: Position }>().map((g) => g.coordinates),
      };
    case 5:
      return {
        type: 'MultiLineString',
        coordinates: children<{ type: 'LineString'; coordinates: Position[] }>().map(
          (g) => g.coordinates,
        ),
      };
    case 6:
      return {
        type: 'MultiPolygon',
        coordinates: children<{ type: 'Polygon'; coordinates: Position[][] }>().map(
          (g) => g.coordinates,
        ),
      };
    default:
      throw new Error(`unsupported WKB geometry type ${String(type)}`);
  }
}

/** Decode hex (E)WKB into a GeoJSON geometry. */
export function parseEwkbHex(hex: string): Geometry {
  const bytes = hexToBytes(hex);
  return readGeometry(new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
}

function isGeometry(v: unknown): v is Geometry {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    'coordinates' in v &&
    Array.isArray((v as { coordinates: unknown }).coordinates)
  );
}

/**
 * Parse whatever PostgREST handed back for a geography column: hex EWKB,
 * a GeoJSON string, or a GeoJSON object. Returns null for null/unparseable.
 */
export function parseGeography(value: unknown): Geometry | null {
  if (value === null || value === undefined) return null;
  if (isGeometry(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  const s = value.trim();
  try {
    if (s.startsWith('{')) {
      const parsed: unknown = JSON.parse(s);
      return isGeometry(parsed) ? parsed : null;
    }
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return parseEwkbHex(s);
  } catch {
    return null;
  }
  return null;
}

const toLatLng = ([lng, lat]: Position): LatLng => ({ lat, lng });

export function geographyToPoint(value: unknown): LatLng | null {
  const g = parseGeography(value);
  if (!g) return null;
  if (g.type === 'Point') return toLatLng(g.coordinates);
  if (g.type === 'MultiPoint' && g.coordinates[0]) return toLatLng(g.coordinates[0]);
  return null;
}

export function geographyToLine(value: unknown): LatLng[] | null {
  const g = parseGeography(value);
  if (!g) return null;
  if (g.type === 'LineString') return g.coordinates.map(toLatLng);
  if (g.type === 'MultiLineString') return g.coordinates.flat().map(toLatLng);
  return null;
}

export function geographyToPolygon(value: unknown): Polygon | null {
  const g = parseGeography(value);
  if (!g) return null;
  const rings =
    g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates[0] : null;
  if (!rings?.[0]) return null;
  const [outer, ...holes] = rings;
  return { outer: outer.map(toLatLng), holes: holes.map((h) => h.map(toLatLng)) };
}

const fmt = (n: number) => String(Number(n.toFixed(8)));

/** EWKT for a point, accepted by PostgREST on geography(point) columns. */
export function pointToEwkt(p: LatLng | null | undefined): string | null {
  return p ? `SRID=4326;POINT(${fmt(p.lng)} ${fmt(p.lat)})` : null;
}

/** LatLng -> GeoJSON position ([lng, lat]) for map layers. */
export const toPosition = (p: LatLng): Position => [p.lng, p.lat];

/** Polygon -> GeoJSON rings (closed). */
export function polygonToRings(poly: Polygon): Position[][] {
  const close = (ring: readonly LatLng[]): Position[] => {
    const pts = ring.map(toPosition);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) pts.push(first);
    return pts;
  };
  return [close(poly.outer), ...(poly.holes ?? []).map(close)];
}
