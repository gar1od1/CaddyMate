/** Synthetic course fixtures for unit tests (a par 4 playing due north). */
import type { Club, CourseBundle, Hole, HoleFeature } from '@caddymate/api';
import { destinationPoint, type LatLng, type Polygon } from '@caddymate/engine';

export const TEE: LatLng = { lat: 53.4245, lng: -6.9165 };
export const at = (alongM: number, rightM = 0): LatLng =>
  destinationPoint(destinationPoint(TEE, 0, alongM), 90, rightM);

/** Regular polygon around a centre. */
export function circle(centre: LatLng, radiusM: number, n = 24): Polygon {
  const outer = Array.from({ length: n }, (_, i) =>
    destinationPoint(centre, (360 * i) / n, radiusM),
  );
  return { outer, holes: [] };
}

export function rect(nearM: number, farM: number, leftM: number, rightM: number): Polygon {
  return {
    outer: [at(nearM, leftM), at(nearM, rightM), at(farM, rightM), at(farM, leftM)],
    holes: [],
  };
}

const feature = (id: string, kind: HoleFeature['kind'], polygon: Polygon): HoleFeature => ({
  id,
  holeId: 'h1',
  kind,
  penalty: kind === 'water' ? 'yellow' : 'none',
  polygon,
  point: null,
  treeRadiusM: null,
  treeHeightM: null,
  notes: null,
});

export const PIN = at(370);

export const HOLE: Hole = {
  id: 'h1',
  number: 1,
  par: 4,
  lineOfPlay: [TEE, at(230), PIN],
  green: circle(PIN, 14),
  greenCentre: PIN,
  features: [
    feature('fw', 'fairway', rect(180, 350, -18, 18)),
    feature('bk', 'bunker', circle(at(368, -20), 6)),
    feature('wt', 'water', rect(250, 300, 25, 60)),
    {
      ...feature('tr', 'tree', rect(0, 1, 0, 1)),
      polygon: null,
      point: at(200, -30),
      treeRadiusM: 5,
    },
  ],
};

export const club = (
  id: string,
  name: string,
  kind: Club['kind'],
  loft: number,
  stock: number | null,
): Club => ({
  id,
  name,
  kind,
  loftDeg: loft,
  bagOrder: 0,
  active: true,
  stockTotalM: stock,
  stockCarryM: null,
  simNameAliases: [],
});

export const BAG: Club[] = [
  club('dr', 'Driver', 'driver', 9, 219),
  club('5w', '5W', 'wood', 18, 192),
  club('6i', '6i', 'iron', 26.5, 155),
  club('7i', '7i', 'iron', 30.5, 146),
  club('9i', '9i', 'iron', 39.5, 128),
  club('pw', 'PW', 'wedge', 44.5, 110),
  club('pt', 'Putter', 'putter', 3, null),
];

export const BUNDLE: CourseBundle = {
  course: {
    id: 'c1',
    name: 'Test',
    slug: 'test',
    country: 'IE',
    centroid: TEE,
    currentVersion: 1,
    status: 'published',
  },
  version: 1,
  holes: [HOLE],
  teeSets: [],
};
