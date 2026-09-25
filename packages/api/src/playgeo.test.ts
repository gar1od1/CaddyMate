import { destinationPoint, haversineDistanceM, type LatLng } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import {
  defaultAimPoint,
  greenDistances,
  hazardsAlongLine,
  inferLie,
  resolveTargetRef,
  surfaceAt,
} from './playgeo.js';
import type { Hole, HoleFeature } from './types.js';

const O: LatLng = { lat: 53.4245, lng: -6.9165 };
const p = (north: number, east = 0) => destinationPoint(destinationPoint(O, 0, north), 90, east);
/** Axis-aligned square (metres) from (n0,e0) to (n1,e1). */
const square = (n0: number, e0: number, n1: number, e1: number) => ({
  outer: [p(n0, e0), p(n0, e1), p(n1, e1), p(n1, e0)],
});
const feature = (id: string, kind: HoleFeature['kind'], poly: ReturnType<typeof square>) =>
  ({
    id,
    holeId: 'h1',
    kind,
    penalty: kind === 'water' ? 'yellow' : kind === 'ob' ? 'ob' : 'none',
    polygon: poly,
    point: null,
    treeRadiusM: null,
    treeHeightM: null,
    notes: null,
  }) satisfies HoleFeature;

const hole: Hole = {
  id: 'h1',
  number: 1,
  par: 4,
  lineOfPlay: [p(0), p(250), p(380, 50)],
  green: square(370, 35, 390, 65),
  greenCentre: p(380, 50),
  features: [
    feature('fw', 'fairway', square(150, -20, 300, 20)),
    feature('bk', 'bunker', square(240, 0, 250, 10)),
    feature('wt', 'water', square(200, 30, 230, 60)),
    feature('rough', 'rough', square(0, -60, 400, 80)),
  ],
};
const other: Hole = {
  ...hole,
  id: 'h2',
  number: 2,
  green: null,
  features: [feature('fw2', 'fairway', square(0, 100, 100, 140))],
};

describe('surfaceAt / inferLie', () => {
  it('resolves overlaps by precedence', () => {
    expect(inferLie([hole], p(245, 5), 1)).toBe('sand');
    expect(inferLie([hole], p(200), 1)).toBe('fairway');
    expect(inferLie([hole], p(100, -40), 1)).toBe('rough');
    expect(inferLie([hole], p(380, 50), 1)).toBe('green');
  });

  it('flags penalty areas and falls back to fairway', () => {
    const s = surfaceAt([hole], p(215, 45), 1);
    expect(s.feature?.kind).toBe('water');
    expect(s.penalty).toBe('yellow');
    expect(s.lie).toBeNull();
    expect(inferLie([hole], p(-500), 1)).toBe('fairway');
  });

  it('checks neighbouring holes', () => {
    expect(inferLie([hole, other], p(50, 120), 1)).toBe('fairway');
  });
});

describe('greenDistances', () => {
  it('measures front and back along the line to the centre', () => {
    const d = greenDistances(p(380, 50 - 100), p(380, 50), hole.green);
    expect(d.centreM).toBeCloseTo(100, 0);
    expect(d.frontM).toBeCloseTo(85, 0);
    expect(d.backM).toBeCloseTo(115, 0);
  });

  it('falls back without a polygon and reports 0 front on the green', () => {
    const d = greenDistances(p(200), p(300), null);
    expect(d.frontM).toBeCloseTo(90, 0);
    expect(d.backM).toBeCloseTo(110, 0);
    expect(greenDistances(p(380, 45), p(380, 50), hole.green).frontM).toBe(0);
  });
});

describe('defaultAimPoint', () => {
  it('walks the line of play to the club distance', () => {
    const aim = defaultAimPoint(p(0), hole.lineOfPlay, hole.greenCentre!, 230);
    expect(haversineDistanceM(p(0), aim)).toBeCloseTo(230, 0);
    expect(haversineDistanceM(aim, p(230))).toBeLessThan(1);
    // Across the dogleg corner.
    const aim2 = defaultAimPoint(p(0), hole.lineOfPlay, hole.greenCentre!, 300);
    expect(haversineDistanceM(p(0), aim2)).toBeCloseTo(300, 0);
  });

  it('aims at the pin when in reach or without a line', () => {
    expect(defaultAimPoint(p(300), hole.lineOfPlay, hole.greenCentre!, 150)).toEqual(
      hole.greenCentre,
    );
    expect(defaultAimPoint(p(0), null, hole.greenCentre!, 150)).toEqual(hole.greenCentre);
  });
});

describe('resolveTargetRef', () => {
  it('offsets right/long in the ball→anchor frame', () => {
    const t = resolveTargetRef(p(0), {
      kind: 'feature',
      anchor: p(200),
      offsetRightM: 10,
      offsetLongM: -20,
    });
    expect(haversineDistanceM(t, p(180, 10))).toBeLessThan(0.5);
  });
});

describe('hazardsAlongLine', () => {
  it('lists crossed hazards nearest first with carry distances', () => {
    const hz = hazardsAlongLine(p(0, 5), 0, hole.features, 400);
    expect(hz.map((h) => h.feature.id)).toEqual(['bk']);
    expect(hz[0]!.nearM).toBeCloseTo(240, 0);
    expect(hz[0]!.farM).toBeCloseTo(250, 0);
    expect(hazardsAlongLine(p(0, 5), 0, hole.features, 100)).toEqual([]);
    const water = hazardsAlongLine(p(215, 45), 0, hole.features, 100);
    expect(water[0]?.nearM).toBe(0);
  });
});
