/**
 * Overpass API access for the OSM course importer (SPEC §13). The network call
 * sits behind {@link OverpassClient} so the mapper can be tested offline with
 * fixture responses.
 */

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface OverpassLatLon {
  lat: number;
  lon: number;
}

export type OverpassTags = Record<string, string>;

export interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OverpassTags;
}

export interface OverpassWay {
  type: 'way';
  id: number;
  nodes?: number[];
  /** Present with `out geom`. */
  geometry?: OverpassLatLon[];
  tags?: OverpassTags;
}

export interface OverpassMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: OverpassLatLon[];
  lat?: number;
  lon?: number;
}

export interface OverpassRelation {
  type: 'relation';
  id: number;
  members: OverpassMember[];
  tags?: OverpassTags;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassResponse {
  elements: OverpassElement[];
}

/** Either an explicit bounding box or a circle around a point. */
export type OverpassArea =
  | { kind: 'bbox'; south: number; west: number; north: number; east: number }
  | { kind: 'around'; lat: number; lng: number; radiusM: number };

/** Largest area we are willing to ask Overpass for (a big 36-hole resort fits). */
export const MAX_AREA_SPAN_M = 6000;

const M_PER_DEG_LAT = 111_320;

/** Throws on malformed or oversized areas; returns the area unchanged otherwise. */
export function validateArea(area: OverpassArea): OverpassArea {
  const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
  if (area.kind === 'bbox') {
    const { south, west, north, east } = area;
    if (!finite(south, west, north, east)) throw new Error('bbox must be numeric');
    if (south >= north || west >= east) throw new Error('bbox must be south < north, west < east');
    if (south < -90 || north > 90 || west < -180 || east > 180)
      throw new Error('bbox out of range');
    const midLat = ((south + north) / 2) * (Math.PI / 180);
    const spanNS = (north - south) * M_PER_DEG_LAT;
    const spanEW = (east - west) * M_PER_DEG_LAT * Math.cos(midLat);
    if (Math.max(spanNS, spanEW) > MAX_AREA_SPAN_M) {
      throw new Error(`bbox is larger than ${MAX_AREA_SPAN_M / 1000} km across`);
    }
    return area;
  }
  const { lat, lng, radiusM } = area;
  if (!finite(lat, lng, radiusM)) throw new Error('centre and radius must be numeric');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('centre out of range');
  if (radiusM <= 0 || radiusM * 2 > MAX_AREA_SPAN_M) {
    throw new Error(`radius must be between 1 and ${MAX_AREA_SPAN_M / 2} m`);
  }
  return area;
}

function areaFilter(area: OverpassArea): string {
  if (area.kind === 'bbox') return `(${area.south},${area.west},${area.north},${area.east})`;
  return `(around:${Math.round(area.radiusM)},${area.lat},${area.lng})`;
}

/**
 * Overpass QL for every golf feature plus the generic water / woodland / tree
 * tags courses are often mapped with. `out geom` inlines way and relation
 * member geometry, so no second round-trip for nodes is needed.
 */
export function buildGolfQuery(area: OverpassArea): string {
  const f = areaFilter(validateArea(area));
  return [
    '[out:json][timeout:90];',
    '(',
    `  nwr["golf"]${f};`,
    `  nwr["leisure"="golf_course"]${f};`,
    `  nwr["natural"="water"]${f};`,
    `  nwr["natural"="wood"]${f};`,
    `  nwr["landuse"="forest"]${f};`,
    `  node["natural"="tree"]${f};`,
    ');',
    'out geom;',
  ].join('\n');
}

export interface OverpassClient {
  query(ql: string, signal?: AbortSignal): Promise<OverpassResponse>;
}

export interface HttpOverpassOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpOverpassClient(opts: HttpOverpassOptions = {}): OverpassClient {
  const endpoint = opts.endpoint ?? OVERPASS_ENDPOINT;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    async query(ql, signal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'CaddyMate course importer',
        },
        body: new URLSearchParams({ data: ql }).toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Overpass returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const body = (await res.json()) as Partial<OverpassResponse>;
      if (!Array.isArray(body.elements)) throw new Error('Overpass response has no elements');
      return { elements: body.elements };
    },
  };
}
