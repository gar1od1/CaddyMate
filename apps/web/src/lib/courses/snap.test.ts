import { describe, expect, it } from 'vitest';
import type { LineString, Polygon, Position } from 'geojson';
import { addFeature, addHole, setGreenPolygon } from './doc';
import { snapPoint, snapTargets, type Project } from './snap';
import { emptyDoc } from './types';

// 1 unit of lng/lat = 100 px; screen y grows downwards.
const project: Project = (p) => ({ x: p[0]! * 100, y: -p[1]! * 100 });

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};
const line: LineString = {
  type: 'LineString',
  coordinates: [
    [3, 0],
    [3, 2],
  ],
};

const close = (a: Position | undefined, b: Position) => {
  expect(a).toBeDefined();
  expect(a![0]).toBeCloseTo(b[0]!, 9);
  expect(a![1]).toBeCloseTo(b[1]!, 9);
};

describe('snapPoint', () => {
  it('returns null when nothing is within tolerance', () => {
    expect(snapPoint([0.5, 0.5], [square], 12, project)).toBeNull();
    expect(snapPoint([0.5, 0.5], [], 12, project)).toBeNull();
  });

  it('snaps to a vertex within tolerance', () => {
    const hit = snapPoint([1.05, 1.05], [square], 12, project);
    expect(hit?.kind).toBe('vertex');
    close(hit?.position, [1, 1]);
    expect(hit!.distancePx).toBeCloseTo(Math.hypot(5, 5));
  });

  it('prefers a vertex to a closer edge', () => {
    // 2 px from the bottom edge, ~10.2 px from the (0,0) corner.
    const hit = snapPoint([0.1, 0.02], [square], 12, project);
    expect(hit?.kind).toBe('vertex');
    close(hit?.position, [0, 0]);
  });

  it('picks the nearest of several vertices', () => {
    const other: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [1.1, 1],
          [2, 1],
          [2, 2],
          [1.1, 1],
        ],
      ],
    };
    const hit = snapPoint([1.08, 1], [square, other], 12, project);
    close(hit?.position, [1.1, 1]);
  });

  it('projects onto the nearest edge when no vertex is close', () => {
    const hit = snapPoint([0.5, 1.08], [square], 12, project);
    expect(hit?.kind).toBe('edge');
    close(hit?.position, [0.5, 1]);
    expect(hit!.distancePx).toBeCloseTo(8);
  });

  it('includes the closing edge of an open ring', () => {
    const open: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    };
    const hit = snapPoint([-0.05, 0.5], [open], 12, project);
    expect(hit?.kind).toBe('edge');
    close(hit?.position, [0, 0.5]);
  });

  it('snaps to line strings and clamps to segment ends', () => {
    const hit = snapPoint([3.1, 1.5], [line], 12, project);
    expect(hit?.kind).toBe('edge');
    close(hit?.position, [3, 1.5]);
    // Beyond the end but within tolerance of the end vertex.
    close(snapPoint([3, 2.1], [line], 12, project)?.position, [3, 2]);
    // Beyond the end and out of tolerance: the clamped projection is too far.
    expect(snapPoint([3, 2.2], [line], 12, project)).toBeNull();
  });

  it('chooses the nearer of two edges', () => {
    const hit = snapPoint([2.95, 0.5], [square, line], 12, project);
    close(hit?.position, [3, 0.5]);
  });

  it('treats the tolerance as inclusive and skips zero-length edges', () => {
    const degenerate: LineString = {
      type: 'LineString',
      coordinates: [
        [5, 5],
        [5, 5],
      ],
    };
    expect(snapPoint([5.12, 5], [degenerate], 12, project)?.kind).toBe('vertex');
    expect(snapPoint([5.13, 5], [degenerate], 12, project)).toBeNull();
  });

  it('never mutates the input geometries', () => {
    const before = JSON.stringify(square);
    const hit = snapPoint([1.01, 1], [square], 12, project);
    hit!.position[0] = 99;
    expect(JSON.stringify(square)).toBe(before);
  });
});

describe('snapTargets', () => {
  const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it('returns the hole’s feature polygons and green, minus the excluded one', () => {
    const newId = ids();
    let doc = addHole(emptyDoc(), newId).doc; // id-1
    doc = addHole(doc, newId).doc; // id-2
    doc = setGreenPolygon(doc, 'id-1', square);
    doc = addFeature(doc, newId, 'id-1', 'bunker', square).doc; // id-3
    doc = addFeature(doc, newId, 'id-1', 'tree', {
      type: 'Point',
      coordinates: [0, 0],
    }).doc; // id-4
    doc = addFeature(doc, newId, 'id-2', 'water', square).doc; // id-5

    expect(snapTargets(doc, 'id-1', null)).toHaveLength(2);
    expect(snapTargets(doc, 'id-1', 'feature:id-3')).toHaveLength(1);
    expect(snapTargets(doc, 'id-1', 'green:id-1')).toHaveLength(1);
    expect(snapTargets(doc, 'id-2', null)).toHaveLength(1);
    expect(snapTargets(doc, null, null)).toEqual([]);
  });
});
