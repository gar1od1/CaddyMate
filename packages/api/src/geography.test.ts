import { describe, expect, it } from 'vitest';
import {
  geographyToLine,
  geographyToPoint,
  geographyToPolygon,
  parseGeography,
  pointToEwkt,
  polygonToRings,
} from './geography.js';

// Produced by PostGIS: select 'SRID=4326;…'::geography::text
const POINT = '0101000020E6100000D122DBF97EAA1BC07593180456B64A40';
const LINE =
  '0102000020E6100000020000009A99999999991BC03333333333B34A40A4703D0AD7A31BC014AE47E17AB44A40';
const POLY =
  '0103000020E610000001000000040000009A99999999991BC03333333333B34A40A4703D0AD7A31BC03333333333B34A40A4703D0AD7A31BC014AE47E17AB44A409A99999999991BC03333333333B34A40';
const POINT_Z = '01010000A0E6100000D122DBF97EAA1BC07593180456B64A400000000000005440';

describe('parseGeography', () => {
  it('decodes hex EWKB points, lines and polygons', () => {
    expect(geographyToPoint(POINT)).toEqual({ lat: 53.4245, lng: -6.9165 });
    expect(geographyToPoint(POINT_Z)).toEqual({ lat: 53.4245, lng: -6.9165 });
    expect(geographyToLine(LINE)).toEqual([
      { lat: 53.4, lng: -6.9 },
      { lat: 53.41, lng: -6.91 },
    ]);
    const poly = geographyToPolygon(POLY);
    expect(poly?.outer).toHaveLength(4);
    expect(poly?.outer[2]).toEqual({ lat: 53.41, lng: -6.91 });
    expect(poly?.holes).toEqual([]);
  });

  it('accepts GeoJSON objects and strings', () => {
    const gj = { type: 'Point', coordinates: [1, 2] };
    expect(geographyToPoint(gj)).toEqual({ lat: 2, lng: 1 });
    expect(geographyToPoint(JSON.stringify(gj))).toEqual({ lat: 2, lng: 1 });
    expect(
      geographyToPolygon({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          ],
        ],
      })?.outer,
    ).toHaveLength(3);
  });

  it('returns null for junk and wrong geometry types', () => {
    expect(parseGeography(null)).toBeNull();
    expect(parseGeography('')).toBeNull();
    expect(parseGeography('zz')).toBeNull();
    expect(parseGeography('{not json')).toBeNull();
    expect(geographyToPoint(LINE)).toBeNull();
    expect(geographyToPolygon(POINT)).toBeNull();
    expect(geographyToLine(POINT)).toBeNull();
  });

  it('round-trips through EWKT formatting', () => {
    expect(pointToEwkt({ lat: 53.4245, lng: -6.9165 })).toBe('SRID=4326;POINT(-6.9165 53.4245)');
    expect(pointToEwkt(null)).toBeNull();
  });

  it('closes rings for GeoJSON output', () => {
    const rings = polygonToRings({
      outer: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 1 },
      ],
    });
    expect(rings[0]).toHaveLength(4);
    expect(rings[0]![3]).toEqual([0, 0]);
  });
});
