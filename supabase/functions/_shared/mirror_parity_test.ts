/**
 * The functions carry mirrors of pure @caddymate/api code (patterns, hole,
 * neutral, geography, row mapping) built on the vendored engine. These tests
 * run the api's own code (on the workspace engine) and the mirrors on the
 * same fixtures so the two cannot drift.
 */
import { assertEquals } from '@std/assert';
import * as apiGeo from '../../../packages/api/src/geography.ts';
import * as apiHole from '../../../packages/api/src/hole.ts';
import * as apiPatterns from '../../../packages/api/src/patterns.ts';
import * as apiRounds from '../../../packages/api/src/rounds.ts';
import * as apiShots from '../../../packages/api/src/shots.ts';
import { resolveConditionModel, type LatLng } from './engine/index.ts';
import { ewkbPoint, shotRow } from './fake_store.ts';
import * as geo from './geography.ts';
import * as hole from './hole.ts';
import * as patterns from './patterns.ts';
import * as shots from './shots.ts';
import type { PatternShotRow } from './patterns.ts';
import type { Shot, ShotRow } from './types.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const FIXTURE: PatternShotRow[] = JSON.parse(
  await Deno.readTextFile(new URL('./fixtures/pattern_rows.json', import.meta.url)),
);
const CLUB_ID = '00000000-0000-4000-9000-000000000007';
const USER_ID = '00000000-0000-4000-8000-00000000abcd';

Deno.test('pattern shot mapping matches the api on the fixture', () => {
  for (const kind of ['neutral', 'observed'] as const) {
    assertEquals(
      patterns.patternShotsFromRows(FIXTURE, kind),
      apiPatterns.patternShotsFromRows(FIXTURE as Any, kind),
    );
  }
  for (const r of FIXTURE) {
    assertEquals(patterns.bucketKeyForRow(r), apiPatterns.bucketKeyForRow(r as Any));
  }
  assertEquals(patterns.PATTERN_SHOT_COLUMNS, apiPatterns.PATTERN_SHOT_COLUMNS);
  for (const club of [
    { kind: 'iron' as const, loftDeg: 34 },
    { kind: 'driver' as const, stockTotalM: 230 },
    { kind: 'wood' as const },
  ]) {
    for (const opts of [{}, { handicapIndex: 3 }, { handicapIndex: 24, driverDistanceM: 200 }]) {
      assertEquals(patterns.clubPrior(club, opts), apiPatterns.clubPrior(club, opts));
    }
  }
});

/** Just enough of a supabase-js client for `fitAndStoreClubPattern` (records writes). */
function recordingDb(rows: readonly PatternShotRow[]) {
  const writes = { pattern: null as Any, buckets: [] as Any[] };
  const from = (table: string) => {
    let op = 'select';
    let payload: Any = null;
    const q: Any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      delete: () => ((op = 'delete'), q),
      upsert: (p: Any) => ((op = 'upsert'), (payload = p), q),
      then: (resolve: (v: Any) => void) => {
        if (op === 'upsert' && table === 'club_patterns') writes.pattern = payload;
        if (op === 'upsert' && table === 'club_condition_patterns') writes.buckets = payload;
        const data = op === 'select' && table === 'shots' ? rows : op === 'select' ? [] : null;
        resolve({ data, error: null });
      },
    };
    return q;
  };
  return { db: { from } as Any, writes };
}

Deno.test('club fit matches the api fitAndStoreClubPattern on the fixture', async () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const club = { kind: 'iron' as const, loftDeg: 34, stockTotalM: 150 };
  for (const opts of [
    { handicapIndex: 13, halfLifeDays: 180 },
    { handicapIndex: 4, halfLifeDays: 60, driverDistanceM: 250 },
  ]) {
    const { db, writes } = recordingDb(FIXTURE);
    await apiPatterns.fitAndStoreClubPattern(db, USER_ID, CLUB_ID, { ...opts, club, now });
    const fit = patterns.fitClubFromRows(club, FIXTURE, { ...opts, now })!;
    const mine = patterns.patternRows(USER_ID, CLUB_ID, fit, 'T');
    assertEquals({ ...mine.pattern, fitted_at: 'T' }, { ...writes.pattern, fitted_at: 'T' });
    assertEquals(
      mine.buckets,
      writes.buckets.map((b: Any) => ({ ...b, fitted_at: 'T' })),
    );
    assertEquals(mine.buckets.length > 0, true, 'fixture should fill at least one bucket');
  }
  assertEquals(patterns.fitClubFromRows({ kind: 'putter' }, FIXTURE), null);
});

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

const TEE: LatLng = { lat: 53.4, lng: -6.9 };
const PIN: LatLng = { lat: 53.4032, lng: -6.8985 };
const off = (p: LatLng, dLat: number, dLng: number): LatLng => ({
  lat: p.lat + dLat,
  lng: p.lng + dLng,
});
const COND = {
  wind_speed_ms: 5,
  wind_dir_deg: 250,
  gust_ms: 8,
  temp_c: 12,
  pressure_hpa: 1005,
  elevation_start_m: 20,
  elevation_end_m: 14,
  wind_head_ms: null,
  wind_cross_ms: null,
  override: false,
};
const CLUBS: Record<string, { kind: Any; loftDeg: number | null }> = {
  d: { kind: 'driver', loftDeg: 10.5 },
  i7: { kind: 'iron', loftDeg: 34 },
  sw: { kind: 'wedge', loftDeg: 56 },
  p: { kind: 'putter', loftDeg: null },
};

function holeRows(): ShotRow[] {
  const land1 = off(TEE, 0.0018, 0.0006);
  const land2 = off(PIN, -0.0002, 0.0001);
  const base = { round_id: 'r1', hole_number: 4, conditions: COND, played_at: '2026-09-20T10:0' };
  return [
    shotRow({
      ...base,
      shot_id: 'a',
      seq: 1,
      club_id: 'd',
      lie: 'tee',
      played_at: base.played_at + '1:00Z',
      start_position: ewkbPoint(TEE),
      end_position: ewkbPoint(land1),
      target_bearing_deg: 20,
      slope_up: 'mild',
    }),
    // Seq gap and no end (Ball here skipped): back-filled from the next start.
    shotRow({
      ...base,
      shot_id: 'b',
      seq: 3,
      club_id: 'i7',
      lie: 'rough',
      played_at: base.played_at + '4:00Z',
      start_position: ewkbPoint(off(land1, 0.00001, 0)),
      target_point: ewkbPoint(PIN),
      slope_above: 'severe',
    }),
    shotRow({
      ...base,
      shot_id: 'pen',
      seq: 2,
      penalty: 'lateral',
      stroke_count: 1,
      played_at: base.played_at + '5:00Z',
    }),
    shotRow({
      ...base,
      shot_id: 'c',
      seq: 6,
      club_id: 'sw',
      lie: 'first_cut',
      played_at: base.played_at + '6:00Z',
      start_position: ewkbPoint(off(PIN, -0.0004, 0.0002)),
      end_position: ewkbPoint(land2),
      strike: 'thin',
    }),
    shotRow({
      ...base,
      shot_id: 'd1',
      seq: 7,
      club_id: 'p',
      lie: 'green',
      played_at: base.played_at + '7:00Z',
      putt_distance_m: '6.10',
      putt_remaining_m: 0.9,
    }),
    shotRow({
      ...base,
      shot_id: 'd2',
      seq: 8,
      club_id: 'p',
      lie: 'green',
      played_at: base.played_at + '8:00Z',
      holed: true,
    }),
  ];
}

Deno.test('row mapping and geography match the api', () => {
  const rows = holeRows();
  for (const r of rows) assertEquals(shots.shotFromRow(r), apiShots.shotFromRow(r as Any) as Any);
  const hs = {
    round_id: 'r1',
    hole_number: 4,
    strokes_logged: 6,
    strokes_override: 5,
    override_reason: 'gimme',
    putts: 2,
    penalties: 1,
    points: null,
    net_strokes: null,
  };
  assertEquals(shots.holeScoreFromRow(hs), apiRounds.holeScoreFromRow(hs as Any));
  assertEquals(
    shots.holeScoreToRow(shots.holeScoreFromRow(hs)),
    apiRounds.holeScoreToRow(apiRounds.holeScoreFromRow(hs as Any)) as Any,
  );
  const values: unknown[] = [
    ewkbPoint(PIN),
    ewkbPoint(PIN).toLowerCase(),
    '{"type":"Point","coordinates":[-6.9,53.4]}',
    { type: 'MultiPoint', coordinates: [[1, 2]] },
    'zz',
    '',
    null,
    42,
  ];
  for (const v of values) assertEquals(geo.geographyToPoint(v), apiGeo.geographyToPoint(v));
  assertEquals(geo.pointToEwkt(PIN), apiGeo.pointToEwkt(PIN));
});

const LEARNED = resolveConditionModel({
  wind: { headPerMps: 0.03, crossPerMps: { iron: 0.02, wedge: 0.02 } },
  elevation: { perMetre: { driver: 1.2, wood: 1.2, hybrid: 1.2, iron: 1.2, wedge: 1.2 } },
});

Deno.test('recomputeHoleShots / tallyHole / applyTally match the api', () => {
  const input: Shot[] = holeRows().map(shots.shotFromRow);
  const surfaceAt = (p: LatLng) => (p.lat > 53.403 ? ('green' as const) : ('fairway' as const));
  const contexts = [
    { pin: PIN },
    { pin: null },
    { pin: PIN, surfaceAt, clubFor: (id: string) => CLUBS[id] ?? null, handedness: 'L' as const },
    {
      pin: PIN,
      clubFor: (id: string) => CLUBS[id] ?? null,
      elevationAt: (p: LatLng) => (p.lat - 53.4) * 1e4,
    },
    // The player's learned condition model (decision 007).
    {
      pin: PIN,
      clubFor: (id: string) => CLUBS[id] ?? null,
      elevationAt: (p: LatLng) => (p.lat - 53.4) * 1e4,
      model: LEARNED,
    },
  ];
  for (const ctx of contexts) {
    const mine = hole.recomputeHoleShots(input, ctx);
    const theirs = apiHole.recomputeHoleShots(input as Any, ctx as Any);
    assertEquals(mine, theirs as Any);
    assertEquals(hole.tallyHole(mine), apiHole.tallyHole(theirs));
    const prev = {
      roundId: 'r1',
      holeNumber: 4,
      strokesLogged: 1,
      strokesOverride: 4,
      overrideReason: 'x',
      putts: 0,
      penalties: 0,
      points: 2,
      netStrokes: 5,
    };
    for (const p of [prev, null]) {
      const a = hole.applyTally(p, 'r1', 4, hole.tallyHole(mine));
      assertEquals(a, apiHole.applyTally(p, 'r1', 4, apiHole.tallyHole(theirs)));
      assertEquals(hole.holeStrokes(a), apiHole.holeStrokes(a));
    }
  }
  // Neutral results for full shots (incl. the back-filled one), none for penalty records / putts.
  const full = hole.recomputeHoleShots(input, contexts[2]!);
  assertEquals(
    full.map((s) => s.id),
    ['a', 'pen', 'b', 'c', 'd1', 'd2'],
  );
  assertEquals(
    full.map((s) => s.neutralDistanceM !== null),
    [true, false, true, true, false, false],
  );
  // The learned model reaches the neutral results (same shots, same elevations).
  const dflt = hole.recomputeHoleShots(input, contexts[3]!);
  const learned = hole.recomputeHoleShots(input, contexts[4]!);
  assertEquals(
    learned.some((s, i) => s.neutralDistanceM !== dflt[i]!.neutralDistanceM),
    true,
  );
});
