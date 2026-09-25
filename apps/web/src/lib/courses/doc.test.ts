import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { haversineDistanceM, metresToYards } from '@caddymate/engine';
import {
  addFeature,
  addHole,
  addTeeSet,
  placeTeeMarker,
  removeHole,
  removeTeeSet,
  setGreenPolygon,
  updateHole,
  validateDoc,
  withYardages,
} from './doc';
import { formatYards, markerYardageM, openRing, closeRing } from './geometry';
import { emptyDoc } from './types';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const green: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-6.9181, 53.4229],
      [-6.9179, 53.4229],
      [-6.9179, 53.4231],
      [-6.9181, 53.4231],
      [-6.9181, 53.4229],
    ],
  ],
};

describe('course doc edits', () => {
  it('numbers new holes with the first free number', () => {
    const newId = ids();
    let doc = addHole(emptyDoc(), newId).doc;
    doc = addHole(doc, newId).doc;
    doc = updateHole(doc, doc.holes[0]!.hole_id, { hole_number: 3 });
    const { doc: d3, hole } = addHole(doc, newId, 3);
    expect(hole.hole_number).toBe(1);
    expect(d3.holes.map((h) => h.hole_number)).toEqual([1, 2, 3]);
  });

  it('sets the green centre from the polygon centroid only when missing', () => {
    const newId = ids();
    const { doc, hole } = addHole(emptyDoc(), newId);
    const withGreen = setGreenPolygon(doc, hole.hole_id, green);
    const c = withGreen.holes[0]!.green_centre!.coordinates;
    expect(c[0]).toBeCloseTo(-6.918, 6);
    expect(c[1]).toBeCloseTo(53.423, 6);
    const moved = updateHole(withGreen, hole.hole_id, {
      green_centre: { type: 'Point', coordinates: [-6.91805, 53.423] },
    });
    expect(setGreenPolygon(moved, hole.hole_id, green).holes[0]!.green_centre!.coordinates).toEqual(
      [-6.91805, 53.423],
    );
  });

  it('places, moves and measures tee markers', () => {
    const newId = ids();
    const created = addHole(emptyDoc(), newId);
    let doc = created.doc;
    const hole = created.hole;
    doc = setGreenPolygon(doc, hole.hole_id, green);
    const { doc: d2, teeSet } = addTeeSet(doc, newId, { name: 'White' });
    doc = placeTeeMarker(d2, newId, teeSet.tee_set_id, hole.hole_id, {
      type: 'Point',
      coordinates: [-6.92, 53.42],
    });
    doc = placeTeeMarker(doc, newId, teeSet.tee_set_id, hole.hole_id, {
      type: 'Point',
      coordinates: [-6.9201, 53.42],
    });
    expect(doc.tee_markers).toHaveLength(1);
    const measured = withYardages(doc).tee_markers[0]!;
    const expected = haversineDistanceM({ lat: 53.42, lng: -6.9201 }, { lat: 53.423, lng: -6.918 });
    expect(measured.yardage_m).toBeCloseTo(expected, 1);
    expect(formatYards(markerYardageM(measured, doc.holes[0]))).toBe(
      `${Math.round(metresToYards(expected))} yds`,
    );
    expect(formatYards(null)).toBe('—');
  });

  it('cascades hole and tee-set removal', () => {
    const newId = ids();
    const created = addHole(emptyDoc(), newId);
    let doc = created.doc;
    const hole = created.hole;
    doc = addFeature(doc, newId, hole.hole_id, 'bunker', green).doc;
    const { doc: d2, teeSet } = addTeeSet(doc, newId);
    doc = placeTeeMarker(d2, newId, teeSet.tee_set_id, hole.hole_id, {
      type: 'Point',
      coordinates: [0, 0],
    });
    expect(removeTeeSet(doc, teeSet.tee_set_id).tee_markers).toHaveLength(0);
    const gone = removeHole(doc, hole.hole_id);
    expect(gone.features).toHaveLength(0);
    expect(gone.tee_markers).toHaveLength(0);
  });

  it('gives new features the default penalty and tree dimensions', () => {
    const newId = ids();
    const { doc, hole } = addHole(emptyDoc(), newId);
    expect(addFeature(doc, newId, hole.hole_id, 'water', green).feature.penalty).toBe('lateral');
    const tree = addFeature(doc, newId, hole.hole_id, 'tree', {
      type: 'Point',
      coordinates: [0, 0],
    }).feature;
    expect(tree).toMatchObject({ polygon: null, tree_radius_m: 4, tree_height_m: 10 });
  });

  it('de-duplicates tee set names', () => {
    const newId = ids();
    const a = addTeeSet(emptyDoc(), newId, { name: 'Blue' }).doc;
    expect(addTeeSet(a, newId, { name: 'Blue' }).teeSet.name).toBe('Blue 2');
  });
});

describe('validateDoc', () => {
  it('flags duplicate hole numbers and bad pars as errors', () => {
    const newId = ids();
    const created = addHole(emptyDoc(), newId);
    let doc = created.doc;
    const hole = created.hole;
    doc = addHole(doc, newId).doc;
    doc = updateHole(doc, hole.hole_id, { hole_number: 2, par: 7 });
    const errors = validateDoc(doc)
      .filter((i) => i.level === 'error')
      .map((i) => i.message);
    expect(errors).toContain('Hole number 2 is used 2 times.');
    expect(errors).toContain('Hole 2: par must be 3–6.');
  });

  it('warns about missing geometry, markers and duplicate stroke indexes', () => {
    const newId = ids();
    const created = addHole(emptyDoc(), newId);
    let doc = created.doc;
    const hole = created.hole;
    const second = addHole(doc, newId);
    doc = second.doc;
    const { doc: d2, teeSet } = addTeeSet(doc, newId);
    doc = placeTeeMarker(d2, newId, teeSet.tee_set_id, hole.hole_id, {
      type: 'Point',
      coordinates: [0, 0],
    });
    doc = placeTeeMarker(doc, newId, teeSet.tee_set_id, second.hole.hole_id, {
      type: 'Point',
      coordinates: [0, 0],
    });
    doc = {
      ...doc,
      tee_markers: doc.tee_markers.map((m) => ({ ...m, stroke_index: 4 })),
    };
    const messages = validateDoc(doc).map((i) => i.message);
    expect(messages).toContain('Hole 1: no line of play.');
    expect(messages).toContain('Hole 1: no green centre.');
    expect(messages).toContain('White: stroke index 4 used 2 times.');
    expect(validateDoc(addHole(emptyDoc(), ids()).doc).map((i) => i.message)).toContain(
      'No tee sets yet (needed to publish).',
    );
  });
});

describe('rings', () => {
  it('opens and closes rings', () => {
    const ring = green.coordinates[0]!;
    expect(openRing(ring)).toHaveLength(4);
    expect(closeRing(openRing(ring))).toEqual(ring);
    expect(closeRing([])).toEqual([]);
  });
});
