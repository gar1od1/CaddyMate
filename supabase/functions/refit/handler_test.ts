import { assertEquals, assertRejects } from '@std/assert';
import {
  applyConditions,
  CONDITION_MODEL_VERSION,
  type ConditionModelOverrides,
  FLAT_STANCE,
  normaliseShot,
  resolveConditionModel,
} from '../_shared/engine/index.ts';
import { ewkbPoint, fakeState, fakeStore, shotRow, USER, uuid } from '../_shared/fake_store.ts';
import { HttpError } from '../_shared/http.ts';
import { DEFAULT_ROLE_PERMISSIONS, grantsForRole } from '../_shared/permissions.ts';
import { toEngineConditions } from '../_shared/neutral.ts';
import {
  driverDistanceFor,
  learnShotFromRow,
  mergeOverrides,
  renormaliseShot,
  sameJson,
} from '../_shared/refit.ts';
import { shotFromRow } from '../_shared/shots.ts';
import type { ClubRow, ShotRow } from '../_shared/types.ts';
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
  assertEquals(await status(post({ learnConditions: 1 })), 400);
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

// ---------------------------------------------------------------------------
// learnConditions (SPEC §8.6, decision 007)
// ---------------------------------------------------------------------------

const TRUE_MODEL = resolveConditionModel({
  wind: { headPerMps: 0.042, crossPerMps: { iron: 0.024 } },
  elevation: { perMetre: { iron: 0.6 } },
});

/**
 * `n` course 7-iron shots with a stored observed result produced by
 * TRUE_MODEL from a neutral 150 m ± noise; the stored neutral values are what
 * a device on the default model would have written.
 */
function learnShots(n: number, seed = 1): ShotRow[] {
  let a = seed;
  const rnd = () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, (_, i) => {
    const bearing = rnd() * 360;
    const cond = {
      wind_speed_ms: 2 + rnd() * 8,
      wind_dir_deg: rnd() * 360,
      gust_ms: null,
      temp_c: 15,
      pressure_hpa: 1013.25,
      elevation_start_m: 20,
      elevation_end_m: 20 + (rnd() - 0.5) * 20,
      wind_head_ms: null,
      wind_cross_ms: null,
      override: false,
    };
    const ctx = {
      club: { kind: 'iron' as const, loftDeg: 34 },
      lineBearingDeg: bearing,
      conditions: toEngineConditions(cond, { startM: 20, endM: cond.elevation_end_m }),
      lie: 'fairway' as const,
      slope: FLAT_STANCE,
      handedness: 'R' as const,
    };
    const neutral = { alongM: 150 + (rnd() - 0.5) * 6, lateralM: (rnd() - 0.5) * 8 };
    const obs = applyConditions(neutral, { ...ctx, model: TRUE_MODEL });
    const dev = normaliseShot(obs, ctx);
    return shotRow({
      shot_id: uuid(),
      round_id: 'r1',
      hole_number: 1 + (i % 18),
      seq: 1,
      club_id: I7,
      lie: 'fairway',
      played_at: new Date(NOW.getTime() - i * 60_000).toISOString(),
      start_position: ewkbPoint({ lat: 53.4, lng: -6.9 }),
      target_bearing_deg: bearing,
      conditions: cond,
      observed_distance_m: Math.round(obs.alongM * 100) / 100,
      observed_lateral_m: Math.round(obs.lateralM * 100) / 100,
      neutral_distance_m: Math.round(dev.alongM * 100) / 100,
      neutral_lateral_m: Math.round(dev.lateralM * 100) / 100,
      condition_model_version: CONDITION_MODEL_VERSION,
    });
  });
}

const learnState = (over: Parameters<typeof fakeState>[0] = {}) =>
  fakeState({
    clubs: [
      club(I7, 'iron', { loft_deg: '34.0', stock_total_m: 150 }),
      club(DR, 'driver'),
      club(PT, 'putter'),
    ],
    shots: [...learnShots(150), ...simShots(DR, 5, 230)],
    rounds: [
      {
        round_id: 'r1',
        user_id: USER,
        course_id: 'c',
        course_version: 1,
        status: 'complete',
        finished_at: null,
        pin_overrides: {},
        hole_scores: [],
      },
    ],
    ...over,
  });

Deno.test(
  'learnConditions: fits, writes the override first, re-normalises, then refits',
  async () => {
    const st = learnState();
    st.profile = {
      ...st.profile!,
      condition_overrides: { lie: { rough: { distanceFactor: 0.9 } } },
    };
    const { deps: d } = deps(st);
    // Only the driver is requested: the 7-iron is refitted because its neutral results moved.
    const body = await (await handleRefit(post({ clubIds: [DR] }), d)).json();

    const [iron] = body.conditions.estimates;
    assertEquals([iron.kind, iron.n, iron.fitted], ['iron', 150, true]);
    // Shrunk from the default (0.021) towards the truth (0.042), and clamped within 0.3×–3×.
    assertEquals(iron.kHead.value > 0.025 && iron.kHead.value < 0.042, true);
    assertEquals(iron.kCross.value > 0.018 && iron.kCross.value < 0.024, true);
    assertEquals(iron.kElev.value < 0.85 && iron.kElev.value > 0.6, true);
    assertEquals(body.conditions.changed, true);

    // Stored override: learned leaves merged over the manual tweak; no version key.
    const stored = st.profile!.condition_overrides as ConditionModelOverrides;
    assertEquals(stored, body.conditions.overrides);
    assertEquals(stored.lie, { rough: { distanceFactor: 0.9 } });
    assertEquals(stored.wind!.headPerMps, Number(iron.kHead.value.toPrecision(4)));
    assertEquals(stored.wind!.crossPerMps, { iron: Number(iron.kCross.value.toPrecision(4)) });
    assertEquals(stored.elevation!.perMetre, { iron: Number(iron.kElev.value.toPrecision(4)) });
    assertEquals('version' in stored, false);

    // Order: override → shot updates → patterns.
    const first = (p: string) => st.log.findIndex((l) => l.startsWith(p));
    assertEquals(first('writeConditionOverrides') >= 0, true);
    assertEquals(first('writeConditionOverrides') < first('updateShot'), true);
    assertEquals(
      st.log.findLastIndex((l) => l.startsWith('updateShot')) < first('writePatterns'),
      true,
    );

    // Every course shot now carries the neutral result of the learned model.
    assertEquals(body.neutralUpdated, 150);
    const model = resolveConditionModel(stored);
    const s0 = st.shots[0]!;
    const again = renormaliseShot(shotFromRow(s0), {
      club: { kind: 'iron', loftDeg: 34 },
      handedness: 'R',
      pin: null,
      model,
    });
    assertEquals(s0.neutral_distance_m, again.neutralDistanceM);
    assertEquals(s0.condition_model_version, CONDITION_MODEL_VERSION);
    assertEquals(
      body.clubs.map((c: { clubId: string }) => c.clubId),
      [I7, DR],
    );
  },
);

Deno.test('learnConditions: below 60 shots nothing is written; opt-out skips it', async () => {
  const st = learnState({ shots: learnShots(40) });
  const { deps: d } = deps(st);
  const body = await (await handleRefit(post({}), d)).json();
  assertEquals(body.conditions.estimates[0].fitted, false);
  assertEquals(body.conditions.overrides, {});
  assertEquals(body.conditions.changed, false);
  assertEquals(body.neutralUpdated, 0);
  assertEquals(st.log.includes('writeConditionOverrides'), false);

  const st2 = learnState();
  const { deps: d2 } = deps(st2);
  const off = await (await handleRefit(post({ learnConditions: false }), d2)).json();
  assertEquals(off.conditions, null);
  assertEquals(off.neutralUpdated, 0);
  assertEquals(st2.log.includes('writeConditionOverrides'), false);
  assertEquals(
    off.clubs.map((c: { clubId: string }) => c.clubId),
    [I7, DR],
  );
});

Deno.test(
  'learnConditions: repeated refits settle; a settled one writes only patterns',
  async () => {
    const st = learnState();
    const { deps: d } = deps(st);
    const runs: { changed: boolean; neutralUpdated: number; head: number }[] = [];
    for (let i = 0; i < 6; i++) {
      st.log.length = 0;
      const body = await (await handleRefit(post({}), d)).json();
      runs.push({
        changed: body.conditions.changed,
        neutralUpdated: body.neutralUpdated,
        head: body.conditions.overrides.wind.headPerMps,
      });
      if (!body.conditions.changed) break;
    }
    const last = runs[runs.length - 1]!;
    // The baseline mean and the coefficients reach a fixed point within a few runs.
    assertEquals(runs.length < 6, true);
    assertEquals(last, { ...last, changed: false, neutralUpdated: 0 });
    assertEquals(last.head, runs[runs.length - 2]!.head);
    assertEquals(
      st.log.every((l) => l.startsWith('writePatterns')),
      true,
    );
  },
);

Deno.test('recomputeNeutral with overrides in force re-derives every course shot', async () => {
  const st = learnState({ shots: learnShots(10) });
  st.profile = {
    ...st.profile!,
    condition_overrides: { elevation: { perMetre: { iron: 0.5 } } },
  };
  const { deps: d } = deps(st);
  const body = await (
    await handleRefit(post({ recomputeNeutral: true, learnConditions: false }), d)
  ).json();
  // All ten are at the current version, but their neutral values were from the defaults.
  assertEquals(body.neutralUpdated, 10);
});

Deno.test('mergeOverrides / sameJson', () => {
  assertEquals(mergeOverrides(null, { wind: { headPerMps: 0.03 } }), {
    wind: { headPerMps: 0.03 },
  });
  assertEquals(
    mergeOverrides(
      { wind: { crossPerMps: { iron: 0.01 } }, x: [1] },
      { wind: { crossPerMps: { wedge: 0.02 } } },
    ),
    { wind: { crossPerMps: { iron: 0.01, wedge: 0.02 } }, x: [1] } as ConditionModelOverrides,
  );
  assertEquals(mergeOverrides({ wind: 3 }, { wind: { headPerMps: 1 } }), {
    wind: { headPerMps: 1 },
  });
  assertEquals(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assertEquals(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
  assertEquals(sameJson({ a: 1 }, { b: 1 }), false);
  assertEquals(sameJson([1, 2], [1]), false);
  assertEquals(sameJson([1, 2], [1, 3]), false);
  assertEquals(sameJson(1, '1'), false);
});

Deno.test('learnShotFromRow skips rows that cannot inform the fit', () => {
  const [row] = learnShots(1);
  const ctx = {
    club: club(I7, 'iron', { loft_deg: null }),
    mean: { alongM: 150, lateralM: 0 },
    handedness: 'R' as const,
    pin: null,
  };
  const ok = learnShotFromRow({ ...row!, end_accuracy_m: 3 }, ctx)!;
  assertEquals(ok.club, { kind: 'iron' });
  assertEquals(ok.endAccuracyM, 3);
  assertEquals(learnShotFromRow(row!, { ...ctx, club: undefined }), null);
  assertEquals(learnShotFromRow(row!, { ...ctx, mean: undefined }), null);
  assertEquals(learnShotFromRow({ ...row!, conditions: null }, ctx), null);
  assertEquals(learnShotFromRow({ ...row!, start_position: null }, ctx), null);
  assertEquals(learnShotFromRow({ ...row!, observed_lateral_m: null }, ctx), null);
});
