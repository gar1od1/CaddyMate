import { describe, expect, it, vi } from 'vitest';
import { haversineDistanceM } from '@caddymate/engine';
import fixture from './__fixtures__/overpass-sample.json';
import { estimatePar, mapOverpassToCourse } from './mapper';
import {
  buildGolfQuery,
  createHttpOverpassClient,
  validateArea,
  type OverpassResponse,
} from './overpass';

const response = fixture as unknown as OverpassResponse;

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

const run = () => mapOverpassToCourse(response, { newId: ids() });

const ll = (c: number[]) => ({ lat: c[1]!, lng: c[0]! });

describe('mapOverpassToCourse', () => {
  it('numbers holes from ref, renumbering duplicates', () => {
    const { doc, warnings } = run();
    expect(doc.holes.map((h) => h.hole_number)).toEqual([1, 2, 3]);
    expect(warnings.some((w) => w.includes('Duplicate hole ref 1'))).toBe(true);
  });

  it('uses the par tag, else estimates from length', () => {
    const { doc } = run();
    expect(doc.holes.map((h) => h.par)).toEqual([4, 3, 5]);
    expect(estimatePar(150)).toBe(3);
    expect(estimatePar(380)).toBe(4);
    expect(estimatePar(480)).toBe(5);
  });

  it('keeps the hole way as the line of play, reversing green → tee ways', () => {
    const { doc, warnings } = run();
    const [h1, h2] = doc.holes;
    expect(h1!.line_of_play!.coordinates[0]).toEqual([-6.92, 53.42]);
    expect(h1!.line_of_play!.coordinates).toHaveLength(3);
    // Way 1002 was drawn from the green; the tee end must come first now.
    expect(h2!.line_of_play!.coordinates[0]).toEqual([-6.9175, 53.4235]);
    expect(warnings.some((w) => w.startsWith('Hole 2: line of play was drawn'))).toBe(true);
  });

  it('attaches the green nearest each hole end and uses its centroid as centre', () => {
    const { doc, stats, warnings } = run();
    const [h1, h2, h3] = doc.holes;
    expect(h1!.green_polygon!.coordinates[0]).toHaveLength(5);
    expect(h1!.green_centre!.coordinates[0]).toBeCloseTo(-6.918, 6);
    expect(h1!.green_centre!.coordinates[1]).toBeCloseTo(53.423, 6);
    expect(h2!.green_centre!.coordinates[0]).toBeCloseTo(-6.915, 6);
    expect(h3!.green_polygon).toBeNull();
    expect(stats.greens).toBe(2);
    expect(warnings).toContain('Hole 3: no green found near the end of the line of play.');
  });

  it('creates one Default tee set with a marker per hole from tee centroids', () => {
    const { doc } = run();
    expect(doc.tee_sets).toHaveLength(1);
    const set = doc.tee_sets[0]!;
    expect(set).toMatchObject({ name: 'Default', colour_hex: '#ffffff', par: 12 });
    expect(doc.tee_markers).toHaveLength(3);
    const byHole = new Map(doc.tee_markers.map((m) => [m.hole_id, m]));
    const [h1, h2, h3] = doc.holes;
    // Tee 3001 (centroid 53.42003,-6.92002) is nearer hole 1's start than 3002.
    const m1 = byHole.get(h1!.hole_id)!;
    expect(m1.marker_point.coordinates[1]).toBeCloseTo(53.42003, 6);
    expect(m1.marker_point.coordinates[0]).toBeCloseTo(-6.92002, 6);
    expect(m1.stroke_index).toBe(5);
    expect(m1.tee_set_id).toBe(set.tee_set_id);
    const expected = haversineDistanceM(
      ll(m1.marker_point.coordinates),
      ll(h1!.green_centre!.coordinates),
    );
    expect(m1.yardage_m).toBeCloseTo(expected, 1);
    // Hole 2's tee is a node.
    expect(byHole.get(h2!.hole_id)!.marker_point.coordinates).toEqual([-6.91752, 53.42352]);
    // Hole 3 has no tee: fall back to the line start, no yardage without a green.
    const m3 = byHole.get(h3!.hole_id)!;
    expect(m3.marker_point.coordinates).toEqual([-6.914, 53.421]);
    expect(m3.yardage_m).toBeNull();
  });

  it('maps and assigns features to the nearest hole line', () => {
    const { doc } = run();
    const [h1, h2] = doc.holes;
    const summary = doc.features.map((f) => [
      f.notes,
      f.kind,
      f.penalty,
      doc.holes.find((h) => h.hole_id === f.hole_id)!.hole_number,
    ]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ['OSM way/4001', 'bunker', 'none', 1],
        ['OSM way/4002', 'fairway', 'none', 1],
        ['OSM way/4003', 'water', 'lateral', 1],
        ['Swan Pond (OSM relation/5001)', 'water', 'lateral', 2],
        ['OSM way/5002', 'wooded', 'none', 2],
        ['OSM node/6001', 'tree', 'none', 1],
      ]),
    );
    expect(doc.features).toHaveLength(6);
    expect(h1 && h2).toBeTruthy();
  });

  it('stitches multipolygon outer ways and keeps inner rings', () => {
    const { doc } = run();
    const pond = doc.features.find((f) => f.notes?.startsWith('Swan Pond'))!;
    expect(pond.polygon!.coordinates).toHaveLength(2);
    for (const ring of pond.polygon!.coordinates) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('stores trees as points with height, other kinds as closed polygons', () => {
    const { doc } = run();
    const tree = doc.features.find((f) => f.kind === 'tree')!;
    expect(tree.polygon).toBeNull();
    expect(tree.point).toEqual({ type: 'Point', coordinates: [-6.9197, 53.4214] });
    expect(tree.tree_height_m).toBe(12);
    for (const f of doc.features.filter((x) => x.kind !== 'tree')) {
      const ring = f.polygon!.coordinates[0]!;
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(f.point).toBeNull();
    }
  });

  it('skips far features and counts ignored tags', () => {
    const { stats, warnings } = run();
    expect(stats.unassigned).toBe(1); // the driving range 2 km away
    expect(stats.ignored).toBe(2); // cart path + clubhouse
    expect(warnings.some((w) => w.includes('1 feature(s) more than 100 m'))).toBe(true);
    expect(stats).toMatchObject({ holes: 3, greens: 2, teeMarkers: 3, features: 6 });
  });

  it('reads the course boundary, name and OSM reference', () => {
    const { course } = run();
    expect(course.name).toBe('Test Golf Club');
    expect(course.osmRef).toBe('way/7001');
    expect(course.boundary!.coordinates[0]).toHaveLength(5);
    expect(course.centre!.lat).toBeCloseTo(53.422, 5);
    expect(course.centre!.lng).toBeCloseTo(-6.9175, 5);
  });

  it('references only ids it created', () => {
    const { doc } = run();
    const holeIds = new Set(doc.holes.map((h) => h.hole_id));
    const setIds = new Set(doc.tee_sets.map((t) => t.tee_set_id));
    expect(doc.features.every((f) => holeIds.has(f.hole_id))).toBe(true);
    expect(doc.tee_markers.every((m) => holeIds.has(m.hole_id) && setIds.has(m.tee_set_id))).toBe(
      true,
    );
  });

  it('handles a response with no holes', () => {
    const result = mapOverpassToCourse({
      elements: response.elements.filter((e) => e.tags?.golf !== 'hole'),
    });
    expect(result.doc).toEqual({ holes: [], features: [], tee_sets: [], tee_markers: [] });
    expect(result.warnings[0]).toMatch(/No golf=hole ways/);
    expect(result.course.name).toBe('Test Golf Club');
  });

  it('falls back to the hole endpoints for the centre without a boundary', () => {
    const result = mapOverpassToCourse(
      { elements: response.elements.filter((e) => e.tags?.leisure !== 'golf_course') },
      { newId: ids() },
    );
    expect(result.course.name).toBeNull();
    expect(result.course.boundary).toBeNull();
    expect(result.course.centre).not.toBeNull();
  });
});

describe('overpass query', () => {
  it('builds a bbox query', () => {
    const q = buildGolfQuery({ kind: 'bbox', south: 53.41, west: -6.93, north: 53.43, east: -6.9 });
    expect(q).toContain('nwr["golf"](53.41,-6.93,53.43,-6.9);');
    expect(q).toContain('nwr["leisure"="golf_course"](53.41,-6.93,53.43,-6.9);');
    expect(q).toContain('nwr["natural"="water"]');
    expect(q.startsWith('[out:json]')).toBe(true);
    expect(q.trim().endsWith('out geom;')).toBe(true);
  });

  it('builds an around query', () => {
    const q = buildGolfQuery({ kind: 'around', lat: 53.42, lng: -6.91, radiusM: 1500.4 });
    expect(q).toContain('nwr["golf"](around:1500,53.42,-6.91);');
  });

  it('rejects bad or oversized areas', () => {
    expect(() => validateArea({ kind: 'bbox', south: 1, west: 0, north: 0, east: 1 })).toThrow();
    expect(() =>
      validateArea({ kind: 'bbox', south: 53, west: -7, north: 53.2, east: -6.8 }),
    ).toThrow(/larger than/);
    expect(() => validateArea({ kind: 'around', lat: 53, lng: -7, radiusM: 10_000 })).toThrow();
    expect(() => validateArea({ kind: 'around', lat: 95, lng: -7, radiusM: 100 })).toThrow();
  });

  it('posts the query and parses the JSON response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    const client = createHttpOverpassClient({
      endpoint: 'https://overpass.test/api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const out = await client.query('[out:json];node(1);out;');
    expect(out.elements).toHaveLength(response.elements.length);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://overpass.test/api');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('data=%5Bout%3Ajson%5D%3Bnode%281%29%3Bout%3B');
  });

  it('surfaces HTTP errors', async () => {
    const client = createHttpOverpassClient({
      fetch: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
    });
    await expect(client.query('x')).rejects.toThrow('HTTP 429: rate limited');
  });
});
