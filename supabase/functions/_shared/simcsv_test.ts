import { assertAlmostEquals, assertEquals, assertThrows } from '@std/assert';
import {
  detectSimFormat,
  normaliseHeader,
  parseCsvRows,
  parseLateral,
  parseNumber,
  parseSimCsv,
  parseTimestamp,
  SimCsvError,
} from './simcsv.ts';

const fixture = (name: string) =>
  Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const YD = 0.9144;

Deno.test('GSPro shot history: preamble, units row, yards, quoted thousands, summary row', () => {
  const p = parseSimCsv(fixture('gspro.csv'));
  assertEquals(p.detected, 'gspro');
  assertEquals(p.delimiter, ',');
  assertEquals(p.units, { distance: { carry: 'yd', total: 'yd', offline: 'yd' }, speed: 'mph' });
  assertEquals(
    p.shots.map((s) => s.club),
    ['DR', 'DR', '7I', '7I', '7I'],
  );
  const [dr] = p.shots;
  assertEquals(dr!.line, 5);
  assertEquals(dr!.playedAt, '2026-09-20T18:01:12.000Z');
  assertEquals(dr!.carryM, Math.round(243.5 * YD * 100) / 100);
  assertEquals(dr!.totalM, Math.round(262.1 * YD * 100) / 100);
  assertEquals(dr!.offlineM, Math.round(12.4 * YD * 100) / 100);
  assertAlmostEquals(dr!.ballSpeedMps!, 152.3 * 0.44704, 0.01);
  assertEquals(dr!.launchDeg, 11.2);
  assertEquals(dr!.spinRpm, 2650);
  assertEquals(p.shots[1]!.offlineM! < 0, true);
  // "1,54.0" (quoted) parses as 154.0; missing total stays null.
  assertEquals(p.shots[3]!.carryM, Math.round(154 * YD * 100) / 100);
  assertEquals(p.shots[3]!.totalM, null);
  assertEquals(p.rejected, [
    { line: 10, reason: 'no club' },
    { line: 11, reason: 'no carry' },
  ]);
});

Deno.test('Square Golf export: metres in headers, split date/time, L/R sides, CRLF', () => {
  const p = parseSimCsv(fixture('square.csv'), { utcOffsetMinutes: 60 });
  assertEquals(p.detected, 'square');
  assertEquals(p.units.distance, { carry: 'm', total: 'm', offline: 'm' });
  assertEquals(
    p.shots.map((s) => [s.club, s.carryM, s.totalM, s.offlineM, s.playedAt]),
    [
      ['7 Iron', 146.2, 152, -3.1, '2026-09-21T17:05:33.000Z'],
      ['7 Iron', 147.9, 153.4, 4, '2026-09-21T17:06:10.000Z'],
      // Day first when the first part exceeds 12.
      ['Driver', 221.4, 240.8, -5.5, '2026-09-21T17:07:02.000Z'],
      ['Pitching Wedge', 101, null, 0, '2026-09-20T23:15:00.000Z'],
    ],
  );
  assertEquals(p.rejected, []);
});

Deno.test('semicolon files with decimal commas and unit suffixes in header words', () => {
  const csv =
    'Club;Carry_m;Total_m;Offline_m;Timestamp\n7i;146,5;152,25;-3,5;2026-09-21T17:05:33+01:00\n';
  const p = parseSimCsv(csv);
  assertEquals(p.delimiter, ';');
  assertEquals(p.detected, null);
  assertEquals(p.shots[0]!.carryM, 146.5);
  assertEquals(p.shots[0]!.totalM, 152.25);
  assertEquals(p.shots[0]!.offlineM, -3.5);
  assertEquals(p.shots[0]!.playedAt, '2026-09-21T16:05:33.000Z');
});

Deno.test('no header → SimCsvError', () => {
  assertThrows(() => parseSimCsv('a,b,c\n1,2,3\n'), SimCsvError);
});

Deno.test('helpers', () => {
  assertEquals(normaliseHeader('Carry Distance (yds)'), { key: 'carrydistance', unit: 'yd' });
  assertEquals(normaliseHeader('Ball Speed [km/h]'), { key: 'ballspeed', unit: 'kph' });
  assertEquals(normaliseHeader('carry_m'), { key: 'carry', unit: 'm' });
  assertEquals(normaliseHeader('Spin (rpm)'), { key: 'spin', unit: null });
  assertEquals(detectSimFormat(['Club', 'Carry']), null);
  assertEquals(parseCsvRows('﻿a,"b ""q"", c",d\r\n1,2'), [
    ['a', 'b "q", c', 'd'],
    ['1', '2'],
  ]);
  assertEquals(parseNumber('1,234.5'), 1234.5);
  assertEquals(parseNumber('1.234,5', true), 1234.5);
  assertEquals(parseNumber('146.2', true), 146.2);
  assertEquals(parseNumber('243.5 yds'), 243.5);
  assertEquals(parseNumber('-'), null);
  assertEquals(parseNumber('abc'), null);
  assertEquals(parseLateral('12.3L'), -12.3);
  assertEquals(parseLateral('L 12.3'), -12.3);
  assertEquals(parseLateral('12.3 R'), 12.3);
  assertEquals(parseLateral('-4'), -4);
  assertEquals(parseLateral('L?'), null);
  assertEquals(parseTimestamp('2026-09-20T18:01:12Z'), Date.UTC(2026, 8, 20, 18, 1, 12));
  assertEquals(parseTimestamp('9/20/26 12:00 PM'), Date.UTC(2026, 8, 20, 12));
  assertEquals(parseTimestamp('20.09.2026 07:30', -300), Date.UTC(2026, 8, 20, 12, 30));
  assertEquals(parseTimestamp('2026-09-20'), Date.UTC(2026, 8, 20));
  assertEquals(parseTimestamp('13/13/2026'), null);
  assertEquals(parseTimestamp('yesterday'), null);
  assertEquals(parseTimestamp('2026-09-20 25:00'), null);
});
