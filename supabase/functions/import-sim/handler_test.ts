import { assertEquals } from '@std/assert';
import { fakeState, fakeStore, shotRow, USER, uuid } from '../_shared/fake_store.ts';
import { HttpError } from '../_shared/http.ts';
import { grantsForRole } from '../_shared/permissions.ts';
import type { ClubRow } from '../_shared/types.ts';
import { clubResolver, dedupe, fileHash, handleImportSim } from './handler.ts';

const PLAYER = grantsForRole('player');

const NOW = new Date('2026-09-25T12:00:00Z');
const DR = uuid(1);
const I7 = uuid(7);
const PW = uuid(10);
const fixture = (name: string) =>
  Deno.readTextFileSync(new URL(`../_shared/fixtures/${name}`, import.meta.url));
const club = (
  club_id: string,
  name: string,
  kind: ClubRow['kind'],
  aliases: string[] = [],
): ClubRow => ({
  club_id,
  name,
  kind,
  loft_deg: null,
  stock_total_m: null,
  sim_name_aliases: aliases,
});

function setup() {
  const st = fakeState({
    clubs: [
      club(DR, 'Driver', 'driver'),
      club(I7, '7i', 'iron', ['7 Iron']),
      club(PW, 'PW', 'wedge'),
    ],
  });
  const deps = {
    authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants: PLAYER }),
    now: () => NOW,
  };
  return { st, deps };
}

const post = (body: unknown) =>
  new Request('https://fn.local/import-sim', { method: 'POST', body: JSON.stringify(body) });

Deno.test(
  'GSPro import: aliases, inserts in metres, remembers aliases, refits, file-hash dedupe',
  async () => {
    const { st, deps } = setup();
    const csv = fixture('gspro.csv');
    const body = await (
      await handleImportSim(post({ source: 'gspro', csv, clubAliases: { DR: DR, '7I': I7 } }), deps)
    ).json();
    assertEquals(body.duplicate, false);
    assertEquals(body.detected, 'gspro');
    assertEquals(body.inserted, 5);
    assertEquals(body.skipped, 2);
    assertEquals(body.skippedDetail, { duplicates: 0, unmappedClub: 0, invalid: 2 });
    assertEquals(body.unmappedClubs, []);
    assertEquals(body.clubsRefit.map((c: { clubId: string }) => c.clubId).sort(), [DR, I7].sort());

    const session = st.sessions[0]!;
    assertEquals(body.sessionId, session.session_id);
    assertEquals([session.source, session.row_count, session.file_hash.length], ['gspro', 5, 64]);
    const sims = st.shots.filter((s) => s.source === 'sim');
    assertEquals(sims.length, 5);
    const first = sims.find((s) => s.played_at === '2026-09-20T18:01:12.000Z')!;
    assertEquals(
      [first.club_id, first.sim_carry_m, first.sim_offline_m, first.strike],
      [DR, 222.66, 11.34, 'good'],
    );
    assertEquals(first.sim_session_id, session.session_id);
    assertEquals(st.clubs.find((c) => c.club_id === DR)!.sim_name_aliases, ['DR']);
    // '7I' already matches the club's name (case-insensitive): not stored as an alias.
    assertEquals(st.clubs.find((c) => c.club_id === I7)!.sim_name_aliases, ['7 Iron']);
    // The 7I shot without a total has no neutral distance (§8.1: sim total), so 2 of 3 count.
    assertEquals(st.patterns.get(I7)!.n_raw, 2);

    // The same file again (even re-saved with CRLF) is a duplicate: nothing inserted.
    const again = await (
      await handleImportSim(post({ source: 'gspro', csv: csv.replace(/\n/g, '\r\n') }), deps)
    ).json();
    assertEquals([again.duplicate, again.sessionId, again.inserted], [true, session.session_id, 0]);
    assertEquals(st.shots.length, 5);
  },
);

Deno.test(
  'Square import: stored aliases and names resolve; overlapping shots dedupe within ±1 s',
  async () => {
    const { st, deps } = setup();
    // An earlier import already holds the first 7 Iron shot, 0.8 s off.
    st.shots.push(
      shotRow({
        shot_id: uuid(),
        source: 'sim',
        club_id: I7,
        played_at: '2026-09-21T17:05:33.800Z',
        sim_session_id: 'old',
        sim_carry_m: '146.20',
      }),
    );
    const csv = fixture('square.csv');
    const body = await (
      await handleImportSim(post({ source: 'square', csv, utcOffsetMinutes: 60 }), deps)
    ).json();
    assertEquals(body.detected, 'square');
    assertEquals(body.inserted, 2);
    assertEquals(body.skippedDetail, { duplicates: 1, unmappedClub: 1, invalid: 0 });
    assertEquals(body.unmappedClubs, ['Pitching Wedge']);
    const added = st.shots.filter((s) => s.sim_session_id === body.sessionId);
    assertEquals(
      added.map((s) => [s.club_id, s.sim_carry_m, s.sim_total_m, s.sim_offline_m]),
      [
        [I7, 147.9, 153.4, 4],
        [DR, 221.4, 240.8, -5.5],
      ],
    );
  },
);

Deno.test('dedupe: within the file and against existing, timestamps optional', () => {
  const shot = (carryM: number) => ({ carryM }) as never;
  const c = (clubId: string, at: number | null, carryM: number) => ({
    shot: shot(carryM),
    clubId,
    at,
  });
  const r = dedupe(
    [
      c('a', 1000, 150),
      c('a', 1900, 150),
      c('a', 2500, 150.5),
      c('b', 1000, 150),
      c('a', null, 150),
      c('a', null, 150),
    ],
    [{ clubId: 'a', at: 5000, carryM: 150.5 }],
  );
  assertEquals(r.duplicates, 1);
  assertEquals(r.keep.length, 5);
});

Deno.test('club resolver and hash', async () => {
  const clubs = [club(DR, 'Driver', 'driver', ['Big Dog'])];
  const resolve = clubResolver(clubs, { dr: DR });
  assertEquals(
    [resolve('driver'), resolve(' big  dog '), resolve('DR'), resolve('3w')],
    [DR, DR, DR, null],
  );
  assertEquals(await fileHash('a\r\nb\n'), await fileHash('a\nb'));
});

Deno.test('rejects bad requests', async () => {
  const { st, deps } = setup();
  const status = (body: unknown) =>
    handleImportSim(post(body), deps).then(
      (r) => r.status,
      (e: HttpError) => e.status,
    );
  assertEquals(await status({ source: 'trackman', csv: 'x' }), 400);
  assertEquals(await status({ source: 'gspro', csv: '' }), 400);
  assertEquals(await status({ source: 'gspro', csv: 'Club,Carry\n7i,150', clubAliases: [] }), 400);
  assertEquals(
    await status({ source: 'gspro', csv: 'Club,Carry\n7i,150', clubAliases: { x: 'y' } }),
    400,
  );
  assertEquals(
    await status({ source: 'gspro', csv: 'Club,Carry\n7i,150', clubAliases: { x: uuid(77) } }),
    400,
  );
  assertEquals(
    await status({ source: 'gspro', csv: 'Club,Carry\n7i,150', utcOffsetMinutes: 1.5 }),
    400,
  );
  assertEquals(await status({ source: 'gspro', csv: 'no,header\n1,2' }), 422);
  assertEquals(await status({ source: 'gspro', csv: 'x'.repeat(5_000_001) }), 413);
  assertEquals(st.sessions.length, 0);
});

Deno.test('a failed shot insert rolls the session back', async () => {
  const { st, deps } = setup();
  const store = fakeStore(st);
  store.insertShots = () => Promise.reject(new Error('boom'));
  const err = console.error;
  const res = await handleImportSim(post({ source: 'gspro', csv: 'Club,Carry\n7i,150' }), {
    ...deps,
    authenticate: () => Promise.resolve({ userId: USER, store, grants: PLAYER }),
  }).catch((e: Error) => e.message);
  console.error = err;
  assertEquals(res, 'boom');
  assertEquals(st.sessions.length, 0);
});

Deno.test('403 without import.write, before anything is written', async () => {
  const { st, deps } = setup();
  const grants = grantsForRole('player', { player: ['import.view'], curator: [], admin: [] });
  const err = await handleImportSim(post({ source: 'gspro', csv: 'Club,Carry\n7i,150' }), {
    ...deps,
    authenticate: () => Promise.resolve({ userId: USER, store: fakeStore(st), grants }),
  }).catch((e: HttpError) => e);
  assertEquals(err instanceof HttpError && [err.status, err.code], [403, 'forbidden']);
  assertEquals(st.sessions.length, 0);
});
