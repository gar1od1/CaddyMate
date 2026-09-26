import { assertEquals, assertRejects } from '@std/assert';
import { CONDITION_MODEL_VERSION } from '../_shared/engine/index.ts';
import { ewkbPoint, fakeState, fakeStore, shotRow, USER, uuid } from '../_shared/fake_store.ts';
import { HttpError } from '../_shared/http.ts';
import { DEFAULT_ROLE_PERMISSIONS, grantsForRole } from '../_shared/permissions.ts';
import { driverDistanceFor } from '../_shared/refit.ts';
import type { ClubRow } from '../_shared/types.ts';
import { handleRefit } from './handler.ts';

const PLAYER = grantsForRole('player');

const NOW = new Date('2026-09-25T12:00:00Z');
const I7 = uuid(7);
const DR = uuid(1);
const PT = uuid(99);
const club = (club_id: string, kind: ClubRow['kind'], over: Partial<ClubRow> = {}): ClubRow => ({
  club_id,
  name: kind,
  kind,
  loft_deg: null,
  stock_total_m: null,
  sim_name_aliases: [],
  ...over,
});

function simShots(clubId: string, n: number, carry: number) {
  return Array.from({ length: n }, (_, i) =>
    shotRow({
      shot_id: uuid(),
      source: 'sim',
      club_id: clubId,
      played_at: new Date(NOW.getTime() - i * 3600_000).toISOString(),
      sim_session_id: 's',
      sim_carry_m: carry - 5,
      sim_total_m: carry + (i % 5) - 2,
      sim_offline_m: (i % 7) - 3,
    }),
  );
}

const post = (body: unknown, method = 'POST') =>
  new Request('https://fn.local/refit', {
    method,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });

function deps(st = fakeState()) {
  const store = fakeStore(st);
  return {
    st,
    deps: {
      authenticate: () => Promise.resolve({ userId: USER, store, grants: PLAYER }),
      now: () => NOW,
    },
  };
}

Deno.test('refits all clubs by default: patterns + buckets written, putter skipped', async () => {
  const { st, deps: d } = deps(
    fakeState({
      clubs: [
        club(I7, 'iron', { loft_deg: '34.0', stock_total_m: 150 }),
        club(DR, 'driver'),
        club(PT, 'putter'),
      ],
      shots: [...simShots(I7, 20, 150), ...simShots(DR, 3, 230)],
    }),
  );
  const res = await handleRefit(post({}), d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.skipped, [PT]);
  assertEquals(body.notFound, []);
  const byId = Object.fromEntries(body.clubs.map((c: { clubId: string }) => [c.clubId, c]));
  assertEquals(byId[I7].n_raw, 20);
  assertEquals(byId[I7].confidence, 'forming');
  assertEquals(byId[I7].buckets, 1);
  assertEquals(byId[I7].fitted_at, NOW.toISOString());
  assertEquals(byId[DR].n_raw, 3);
  assertEquals(byId[DR].confidence, 'seeded');
  assertEquals(st.patterns.get(I7)!.engine_version, 1);
  assertEquals(st.patterns.get(I7)!.user_id, USER);
  // Sim shots are calm, off a mat ≈ fairway: one bucket for the 7-iron (n ≥ 15), none for the driver.
  assertEquals(st.buckets.size, 1);
  assertEquals([...st.buckets.values()][0]!.club_id, I7);
  assertEquals([...st.buckets.values()][0]!.bucket_key.startsWith('fairway'), true);
});

Deno.test('stale buckets are removed; requested ids are honoured', async () => {
  const st = fakeState({
    clubs: [club(I7, 'iron'), club(DR, 'driver')],
    shots: simShots(I7, 5, 150),
  });
  st.buckets.set(`${I7}|rough|x|y`, {} as never);
  const { deps: d } = deps(st);
  const other = uuid(4242);
  const body = await (await handleRefit(post({ clubIds: [I7, other] }), d)).json();
  assertEquals(
    body.clubs.map((c: { clubId: string }) => c.clubId),
    [I7],
  );
  assertEquals(body.notFound, [other]);
  assertEquals(st.buckets.size, 0);
  assertEquals(st.patterns.has(DR), false);
});

Deno.test('recomputeNeutral re-normalises course shots behind the model version', async () => {
  const tee = { lat: 53.4, lng: -6.9 };
  const land = { lat: 53.4013, lng: -6.8998 };
  const cond = {
    wind_speed_ms: 6,
    wind_dir_deg: 200,
    gust_ms: null,
    temp_c: 10,
    pressure_hpa: 1000,
    elevation_start_m: 10,
    elevation_end_m: 4,
    wind_head_ms: null,
    wind_cross_ms: null,
    override: false,
  };
  const course = (over: Parameters<typeof shotRow>[0]) =>
    shotRow({
      round_id: 'r1',
      hole_number: 3,
      seq: 1,
      club_id: I7,
      lie: 'fairway',
      start_position: ewkbPoint(tee),
      end_position: ewkbPoint(land),
      conditions: cond,
      ...over,
    });
  const st = fakeState({
    clubs: [club(I7, 'iron', { loft_deg: 34 })],
    shots: [
      course({
        shot_id: 'old',
        condition_model_version: 0,
        neutral_distance_m: 1,
        neutral_lateral_m: 1,
      }),
      // No stored bearing / target: the pin (round override) gives the line.
      course({ shot_id: 'never', seq: 2 }),
      course({
        shot_id: 'current',
        seq: 3,
        condition_model_version: CONDITION_MODEL_VERSION,
        neutral_distance_m: 7,
      }),
    ],
    rounds: [
      {
        round_id: 'r1',
        user_id: USER,
        course_id: 'c',
        course_version: 1,
        status: 'complete',
        finished_at: null,
        pin_overrides: { '3': { lat: 53.4016, lng: -6.8999 } },
        hole_scores: [],
      },
    ],
  });
  const { deps: d } = deps(st);
  const body = await (await handleRefit(post({ recomputeNeutral: true }), d)).json();
  assertEquals(body.neutralUpdated, 2);
  const [old, never, current] = st.shots;
  for (const s of [old!, never!]) {
    assertEquals(s.condition_model_version, CONDITION_MODEL_VERSION);
    assertEquals(typeof s.neutral_distance_m, 'number');
    assertEquals((s.neutral_distance_m as number) > 100, true);
  }
  assertEquals(old!.observed_distance_m, never!.observed_distance_m);
  assertEquals(current!.neutral_distance_m, 7);
  // 'current' has no neutral lateral, so only the two re-normalised shots feed the fit.
  assertEquals(body.clubs[0].n_raw, 2);
});

Deno.test('driver distance comes from the driver stock total', () => {
  assertEquals(driverDistanceFor([club(DR, 'driver', { stock_total_m: '231.5' })]), 231.5);
  assertEquals(driverDistanceFor([club(I7, 'iron', { stock_total_m: 150 })]) > 200, true);
});

Deno.test('rejects bad requests', async () => {
  const { deps: d } = deps();
  const status = (req: Request, dd = d) =>
    handleRefit(req, dd).then(
      () => 200,
      (e: HttpError) => e.status,
    );
  assertEquals(await status(post(null, 'GET')), 405);
  assertEquals(await status(post({ clubIds: ['nope'] })), 400);
  assertEquals(await status(post({ clubIds: 'x' })), 400);
  assertEquals(await status(post({ recomputeNeutral: 'yes' })), 400);
  assertEquals(
    await status(new Request('https://fn.local/refit', { method: 'POST', body: '{' })),
    400,
  );
  await assertRejects(
    () =>
      handleRefit(post({}), {
        authenticate: () => Promise.reject(new HttpError(401, 'unauthorized', 'no')),
        now: () => NOW,
      }),
    HttpError,
  );
});

Deno.test(
  '403 without clubs.refit (clubs page switched off), before anything is written',
  async () => {
    const { st } = deps(fakeState({ clubs: [club(I7, 'iron')], shots: simShots(I7, 5, 150) }));
    const player = DEFAULT_ROLE_PERMISSIONS.player.filter((k) => k !== 'clubs.view');
    const grants = grantsForRole('player', { ...DEFAULT_ROLE_PERMISSIONS, player });
    const err = await handleRefit(post({}), {
      authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants }),
      now: () => NOW,
    }).catch((e: HttpError) => e);
    assertEquals(err instanceof HttpError && [err.status, err.code], [403, 'forbidden']);
    assertEquals(st.patterns.size, 0);
  },
);
