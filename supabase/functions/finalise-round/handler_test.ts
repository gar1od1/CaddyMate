import { assertEquals } from '@std/assert';
import type { LatLng } from '../_shared/engine/index.ts';
import { ewkbPoint, fakeState, fakeStore, shotRow, USER, uuid } from '../_shared/fake_store.ts';
import { HttpError } from '../_shared/http.ts';
import { grantsForRole } from '../_shared/permissions.ts';
import type { RoundRow } from '../_shared/store.ts';
import type { ClubRow, ShotRow } from '../_shared/types.ts';
import { handleFinaliseRound, storedSurfaces } from './handler.ts';

const PLAYER = grantsForRole('player');

const NOW = new Date('2026-09-25T16:00:00Z');
const ROUND = uuid(500);
const DR = uuid(1);
const I7 = uuid(7);
const PT = uuid(99);
const G1: LatLng = { lat: 53.403, lng: -6.9 };
const G2: LatLng = { lat: 53.41, lng: -6.91 };
const club = (club_id: string, kind: ClubRow['kind']): ClubRow => ({
  club_id,
  name: kind,
  kind,
  loft_deg: null,
  stock_total_m: null,
  sim_name_aliases: [],
});
const at = (n: number) => new Date(Date.UTC(2026, 8, 25, 12, n)).toISOString();

function state() {
  const tee = { lat: 53.4, lng: -6.9 };
  const land = { lat: 53.4018, lng: -6.8998 };
  const green = { lat: 53.40295, lng: -6.90002 };
  const h = (over: Partial<ShotRow> & { shot_id: string }) =>
    shotRow({ round_id: ROUND, hole_number: 1, played_at: at(over.seq ?? 0), ...over });
  const shots: ShotRow[] = [
    // Hole 1: seqs 2, 5, 9, 10 (gaps → renumbered 1..4); the approach's end is missing.
    h({
      shot_id: 'a',
      seq: 2,
      club_id: DR,
      lie: 'tee',
      start_position: ewkbPoint(tee),
      end_position: ewkbPoint(land),
      result_surface: 'fairway',
    }),
    h({ shot_id: 'b', seq: 5, club_id: I7, lie: 'fairway', start_position: ewkbPoint(land) }),
    h({
      shot_id: 'c',
      seq: 9,
      club_id: PT,
      lie: 'green',
      start_position: ewkbPoint(green),
      putt_distance_m: 5,
    }),
    h({ shot_id: 'd', seq: 10, club_id: PT, lie: 'green', holed: true }),
    // Hole 2: tee shot OB (stroke and distance), re-tee, then holed out.
    h({
      shot_id: 'e',
      hole_number: 2,
      seq: 1,
      club_id: DR,
      lie: 'tee',
      penalty: 'ob',
      stroke_count: 2,
    }),
    h({ shot_id: 'f', hole_number: 2, seq: 2, club_id: DR, lie: 'tee', holed: true }),
    // A sim shot in the same club never belongs to a hole.
    shotRow({ shot_id: 'sim', source: 'sim', club_id: I7, sim_total_m: 150, sim_offline_m: 1 }),
  ];
  const round: RoundRow = {
    round_id: ROUND,
    user_id: USER,
    course_id: 'c1',
    course_version: 2,
    status: 'live',
    finished_at: null,
    pin_overrides: { '2': G2 },
    hole_scores: [
      // Hole 2 has a manual override; hole 3 was scored by hand without shots.
      {
        round_id: ROUND,
        hole_number: 2,
        strokes_logged: 0,
        strokes_override: 4,
        override_reason: 'fix',
        putts: 0,
        penalties: 0,
        points: 2,
        net_strokes: null,
      },
      {
        round_id: ROUND,
        hole_number: 3,
        strokes_logged: 0,
        strokes_override: 5,
        override_reason: 'no gps',
        putts: 2,
        penalties: 0,
        points: null,
        net_strokes: null,
      },
    ],
  };
  return fakeState({
    clubs: [club(DR, 'driver'), club(I7, 'iron'), club(PT, 'putter')],
    shots,
    rounds: [round],
    greens: new Map([
      [
        'c1/2',
        new Map([
          [1, G1],
          [2, { lat: 0, lng: 0 }],
        ]),
      ],
    ]),
  });
}

const post = (body: unknown) =>
  new Request('https://fn.local/finalise-round', { method: 'POST', body: JSON.stringify(body) });

Deno.test(
  're-derives holes, writes hole_scores and gross, completes the round, refits clubs',
  async () => {
    const st = state();
    const reviewed: string[] = [];
    const res = await handleFinaliseRound(post({ roundId: ROUND }), {
      authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants: PLAYER }),
      now: () => NOW,
      reviewRoundHook: (id, shots) => {
        reviewed.push(`${id}:${shots.length}`);
        return Promise.resolve();
      },
    });
    assertEquals(res.status, 200);
    const body = await res.json();

    assertEquals(body.holes, [
      { holeNumber: 1, strokes: 4, strokesLogged: 4, putts: 2, penalties: 0, holed: true },
      { holeNumber: 2, strokes: 4, strokesLogged: 3, putts: 0, penalties: 0, holed: true },
      { holeNumber: 3, strokes: 5, strokesLogged: 0, putts: 2, penalties: 0, holed: false },
    ]);
    assertEquals(body.gross, 13);
    assertEquals(body.status, 'complete');
    const round = st.rounds[0]!;
    assertEquals(
      [round.status, round.finished_at, (round as unknown as { gross: number }).gross],
      ['complete', NOW.toISOString(), 13],
    );
    const hs = Object.fromEntries(round.hole_scores.map((h) => [h.hole_number, h]));
    assertEquals(hs[1]!.strokes_logged, 4);
    assertEquals([hs[2]!.strokes_logged, hs[2]!.strokes_override, hs[2]!.points], [3, 4, 2]);
    assertEquals(hs[3]!.strokes_override, 5);

    const byId = Object.fromEntries(st.shots.map((s) => [s.shot_id, s]));
    assertEquals(
      ['a', 'b', 'c', 'd'].map((id) => byId[id]!.seq),
      [1, 2, 3, 4],
    );
    // Approach end back-filled from the putt's start, surface kept from the putt's lie.
    assertEquals(byId.b!.end_position, ewkbPoint({ lat: 53.40295, lng: -6.90002 }));
    assertEquals(byId.b!.result_surface, 'green');
    assertEquals(byId.a!.result_surface, 'fairway');
    assertEquals(typeof byId.a!.observed_distance_m, 'number');
    assertEquals(typeof byId.a!.neutral_distance_m, 'number');
    assertEquals(byId.d!.distance_to_pin_after_m, 0);
    assertEquals(byId.c!.distance_to_pin_before_m, 5);
    assertEquals(body.shotsUpdated >= 4, true);

    assertEquals(reviewed, [`${ROUND}:6`]);
    assertEquals(body.clubsRefit.map((c: { clubId: string }) => c.clubId).sort(), [DR, I7].sort());
    assertEquals(st.patterns.has(PT), false);

    // Idempotent: a second run changes no shots.
    const again = await (
      await handleFinaliseRound(post({ roundId: ROUND }), {
        authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants: PLAYER }),
        now: () => NOW,
      })
    ).json();
    assertEquals(again.shotsUpdated, 0);
    assertEquals(again.gross, 13);
  },
);

Deno.test('storedSurfaces prefers where a shot ended, then the next lie', () => {
  const p = { lat: 1, lng: 2 };
  const f = storedSurfaces([
    { start: p, lie: 'rough', end: null, resultSurface: null },
    { start: null, lie: null, end: p, resultSurface: 'first_cut' },
  ] as never);
  assertEquals(f(p), 'first_cut');
  assertEquals(f({ lat: 0, lng: 0 }), null);
});

Deno.test('404 for unknown or foreign rounds; 400 for a bad id', async () => {
  const st = state();
  const d = {
    authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants: PLAYER }),
    now: () => NOW,
  };
  const status = (req: Request) =>
    handleFinaliseRound(req, d).then(
      () => 200,
      (e: HttpError) => e.status,
    );
  assertEquals(await status(post({ roundId: uuid(4040) })), 404);
  st.rounds[0]!.user_id = uuid(2);
  assertEquals(await status(post({ roundId: ROUND })), 404);
  assertEquals(await status(post({ roundId: 'x' })), 400);
  assertEquals(await status(new Request('https://fn.local/', { method: 'GET' })), 405);
});

Deno.test('403 without rounds.write', async () => {
  const st = state();
  const grants = grantsForRole('player', { player: ['rounds.view'], curator: [], admin: [] });
  const err = await handleFinaliseRound(post({ roundId: ROUND }), {
    authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants }),
    now: () => NOW,
  }).catch((e: HttpError) => e);
  assertEquals(err instanceof HttpError && [err.status, err.code], [403, 'forbidden']);
  assertEquals(st.rounds[0]!.status, 'live');
});
