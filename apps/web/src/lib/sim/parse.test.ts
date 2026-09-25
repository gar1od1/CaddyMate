import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  detectFormat,
  normaliseHeader,
  parseCsv,
  parseDistanceCell,
  parseSimCsv,
  parseTimestamp,
  toMetres,
} from './parse';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

const yd = (v: number) => Math.round(v * 0.9144 * 100) / 100;

describe('csv primitives', () => {
  it('detects the delimiter outside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('"a,b";c;d')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('')).toBe(',');
  });

  it('parses quotes, doubled quotes, CRLF, BOM and embedded newlines', () => {
    const rows = parseCsv('﻿a,"b ""x""",c\r\n"multi\nline",2,3\r\n4,5,');
    expect(rows).toEqual([
      ['a', 'b "x"', 'c'],
      ['multi\nline', '2', '3'],
      ['4', '5', ''],
    ]);
  });

  it('normalises headers and splits units', () => {
    expect(normaliseHeader('Carry (yds)')).toEqual({ key: 'carry', unit: 'yd' });
    expect(normaliseHeader('Total Distance m')).toEqual({ key: 'totaldistance', unit: 'm' });
    expect(normaliseHeader('Side Carry [Meters]')).toEqual({ key: 'sidecarry', unit: 'm' });
    expect(normaliseHeader('Club')).toEqual({ key: 'club', unit: null });
    expect(normaliseHeader('m')).toEqual({ key: 'm', unit: null });
  });

  it('parses distance cells with side markers, units and decimal commas', () => {
    expect(parseDistanceCell('12.5')).toEqual({ value: 12.5, unit: null });
    expect(parseDistanceCell('-3')).toEqual({ value: -3, unit: null });
    expect(parseDistanceCell('4,5 L')).toEqual({ value: -4.5, unit: null });
    expect(parseDistanceCell('R 2')).toEqual({ value: 2, unit: null });
    expect(parseDistanceCell('L7')).toEqual({ value: -7, unit: null });
    expect(parseDistanceCell('152 yds')).toEqual({ value: 152, unit: 'yd' });
    expect(parseDistanceCell('140m')).toEqual({ value: 140, unit: 'm' });
    for (const blank of ['', ' ', '-', 'n/a', 'abc']) expect(parseDistanceCell(blank)).toBeNull();
  });

  it('converts to metres', () => {
    expect(toMetres(100, 'yd')).toBeCloseTo(91.44);
    expect(toMetres(100, 'm')).toBe(100);
    expect(toMetres(10, 'ft')).toBeCloseTo(3.048);
  });

  it('parses timestamps', () => {
    expect(parseTimestamp('01/05/2026 7:15:02 PM')).toBe(
      new Date(2026, 0, 5, 19, 15, 2).toISOString(),
    );
    expect(parseTimestamp('25/12/2025 12:00 AM')).toBe(new Date(2025, 11, 25, 0, 0).toISOString());
    expect(parseTimestamp('2026-02-11 18:02:11')).toBe(
      new Date(2026, 1, 11, 18, 2, 11).toISOString(),
    );
    expect(parseTimestamp('2026-02-11T18:02:11Z')).toBe('2026-02-11T18:02:11.000Z');
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('soon')).toBeNull();
  });
});

describe('detectFormat', () => {
  it('uses title lines, header signatures, then the file name', () => {
    expect(detectFormat(['Club', 'Carry'], ['GSPro export']).format).toBe('gspro');
    expect(detectFormat(['Club', 'HLA', 'VLA', 'Carry']).format).toBe('gspro');
    expect(detectFormat(['Club Type', 'Carry Distance', 'Side Carry']).format).toBe('square');
    expect(detectFormat(['Club', 'Carry'], [], 'my-square-session.csv').format).toBe('square');
    expect(detectFormat(['Club', 'Carry']).format).toBeNull();
  });
});

describe('parseSimCsv', () => {
  it('reads a GSPro shot-history export (yards, title line, summary rows)', () => {
    const r = parseSimCsv(fixture('gspro-shot-history.csv'), 'shots.csv');
    expect(r.errors).toEqual([]);
    expect(r.format).toBe('gspro');
    expect(r.headerRow).toBe(2);
    expect(r.columns.club?.header).toBe('Club');
    expect(r.columns.timestamp?.header).toBe('Date');
    expect(r.columns.carry?.header).toBe('Carry (yds)');
    expect(r.columns.total?.header).toBe('Total Dist (yds)');
    expect(r.columns.offline?.header).toBe('Offline (yds)');
    expect(r.units.carry).toEqual({ unit: 'yd', source: 'header' });
    expect(r.shots).toHaveLength(4);
    expect(r.shots[0]).toEqual({
      row: 3,
      club: 'Driver',
      timestamp: new Date(2026, 0, 5, 19, 15, 2).toISOString(),
      carryM: yd(238.4),
      totalM: yd(262),
      offlineM: yd(-12.5),
    });
    expect(r.shots[3]!.offlineM).toBe(yd(14.1));
    expect(r.skipped).toEqual([
      { row: 7, reason: 'no club' },
      { row: 8, reason: 'summary row' },
    ]);
    expect(r.perClub).toEqual([
      { club: '7 Iron', count: 2 },
      { club: 'Driver', count: 2 },
    ]);
  });

  it('reads a Square export (semicolons, units row in metres, L/R sides)', () => {
    const r = parseSimCsv(fixture('square-export.csv'));
    expect(r.errors).toEqual([]);
    expect(r.format).toBe('square');
    expect(r.delimiter).toBe(';');
    expect(r.columns.club?.header).toBe('Club Type');
    expect(r.columns.offline?.header).toBe('Side Carry');
    expect(r.units.total).toEqual({ unit: 'm', source: 'units-row' });
    expect(r.shots.map((s) => [s.club, s.carryM, s.totalM, s.offlineM])).toEqual([
      ['PW', 110.5, 115.2, -4.5],
      ['PW', 108, 113.9, 2],
      ['5 Hybrid', 180, 192.4, 6.1],
    ]);
    expect(r.shots[0]!.timestamp).toBe(new Date(2026, 1, 11, 18, 2, 11).toISOString());
    expect(r.skipped).toEqual([{ row: 6, reason: 'no carry or total' }]);
  });

  it('reads a units column and cell suffixes', () => {
    const csv = [
      'Club,Carry,Total,Offline,Units',
      '7i,150,160,-5,Yards',
      '7i,140,146,3,Meters',
    ].join('\n');
    const r = parseSimCsv(csv);
    expect(r.units.carry?.source).toBe('units-column');
    expect(r.shots.map((s) => s.totalM)).toEqual([yd(160), 146]);
    const suffixed = parseSimCsv('Club,Carry,Total\n7i,150 yds,160 yds\n');
    expect(suffixed.units.total).toEqual({ unit: 'yd', source: 'cell' });
    expect(suffixed.shots[0]!.totalM).toBe(yd(160));
    expect(suffixed.warnings).toHaveLength(2);
  });

  it('combines separate date and time columns', () => {
    const r = parseSimCsv('Date,Time,Club,Carry\n2026-03-01,09:30:00,PW,100\n');
    expect(r.shots[0]!.timestamp).toBe(new Date(2026, 2, 1, 9, 30).toISOString());
  });

  it('reports a missing header', () => {
    const r = parseSimCsv('foo,bar\n1,2\n');
    expect(r.errors).toHaveLength(1);
    expect(r.shots).toEqual([]);
  });
});
