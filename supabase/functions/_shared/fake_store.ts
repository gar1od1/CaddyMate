/**
 * In-memory `FinaliseStore` / `SimStore` for the handler tests (test-only;
 * no function entrypoint imports it). Mimics RLS by holding one user's data.
 */
import type { LatLng } from './engine/index.ts';
import type { ClubPatternRow, ConditionPatternRow, PatternShotRow } from './patterns.ts';
import type { DerivedShotPatch } from './shots.ts';
import {
  pinsForRound,
  type ExistingSimShot,
  type FinaliseStore,
  type RoundPatch,
  type RoundRow,
  type SimSessionInsert,
  type SimShotInsert,
  type SimStore,
} from './store.ts';
import type { ClubRow, HoleScoreRow, ProfileRow, ShotRow } from './types.ts';

export const USER = '00000000-0000-4000-8000-000000000001';

export interface FakeState {
  profile: ProfileRow | null;
  clubs: ClubRow[];
  shots: ShotRow[];
  rounds: RoundRow[];
  greens: Map<string, Map<number, LatLng>>;
  patterns: Map<string, ClubPatternRow>;
  buckets: Map<string, ConditionPatternRow>;
  sessions: (SimSessionInsert & { session_id: string })[];
  log: string[];
}

let seq = 0;
export const uuid = (n?: number) =>
  `00000000-0000-4000-8000-${String(n ?? 1000 + ++seq).padStart(12, '0')}`;

export function fakeState(over: Partial<FakeState> = {}): FakeState {
  return {
    profile: { handedness: 'R', handicap_index_official: null, recency_half_life_days: 180 },
    clubs: [],
    shots: [],
    rounds: [],
    greens: new Map(),
    patterns: new Map(),
    buckets: new Map(),
    sessions: [],
    log: [],
    ...over,
  };
}

/** A `shots` row with defaults (course shot, nothing derived). */
export function shotRow(over: Partial<ShotRow> & { shot_id: string }): ShotRow {
  return {
    user_id: USER,
    round_id: null,
    hole_number: null,
    seq: null,
    source: 'course',
    club_id: null,
    played_at: '2026-09-20T10:00:00.000Z',
    start_position: null,
    start_accuracy_m: null,
    end_position: null,
    end_accuracy_m: null,
    holed: false,
    reconstructed: false,
    target_point: null,
    target_bearing_deg: null,
    target_ref: null,
    intended_shape: null,
    lie: null,
    slope_up: 'none',
    slope_down: 'none',
    slope_above: 'none',
    slope_below: 'none',
    slope_suggested: null,
    strike: 'good',
    penalty: 'none',
    stroke_count: 1,
    conditions: null,
    putt_distance_m: null,
    putt_remaining_m: null,
    recommendation: null,
    observed_distance_m: null,
    observed_lateral_m: null,
    neutral_distance_m: null,
    neutral_lateral_m: null,
    condition_model_version: null,
    result_surface: null,
    distance_to_pin_before_m: null,
    distance_to_pin_after_m: null,
    sim_session_id: null,
    sim_carry_m: null,
    sim_total_m: null,
    sim_offline_m: null,
    ...over,
  };
}

/** Geography as PostgREST returns it: hex EWKB (little-endian, SRID 4326). */
export function ewkbPoint(p: LatLng): string {
  const buf = new DataView(new ArrayBuffer(25));
  buf.setUint8(0, 1);
  buf.setUint32(1, 0x20000001, true);
  buf.setUint32(5, 4326, true);
  buf.setFloat64(9, p.lng, true);
  buf.setFloat64(17, p.lat, true);
  return [...new Uint8Array(buf.buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** EWKT written by a patch → hex EWKB as a later read would return it. */
function ewktToEwkb(v: string | null): string | null {
  if (v === null) return null;
  const m = /POINT\(([-\d.e]+) ([-\d.e]+)\)/.exec(v)!;
  return ewkbPoint({ lng: Number(m[1]), lat: Number(m[2]) });
}

export function fakeStore(st: FakeState): FinaliseStore & SimStore {
  const pattern = (r: ShotRow): PatternShotRow => r;
  return {
    profile: () => Promise.resolve(st.profile),
    clubs: () => Promise.resolve(st.clubs.map((c) => ({ ...c }))),
    patternRows: (clubId) =>
      Promise.resolve(st.shots.filter((s) => s.club_id === clubId).map(pattern)),
    writePatterns(p, buckets) {
      st.log.push(`writePatterns ${p.club_id}`);
      st.patterns.set(p.club_id, p);
      for (const k of [...st.buckets.keys()])
        if (k.startsWith(`${p.club_id}|`)) st.buckets.delete(k);
      for (const b of buckets) st.buckets.set(`${p.club_id}|${b.bucket_key}`, b);
      return Promise.resolve();
    },
    staleNeutralShots: (clubIds, version) =>
      Promise.resolve(
        st.shots.filter(
          (s) =>
            s.source === 'course' &&
            s.club_id !== null &&
            clubIds.includes(s.club_id) &&
            (s.condition_model_version === null || s.condition_model_version < version),
        ),
      ),
    pins(roundIds) {
      const out = new Map<string, Map<number, LatLng>>();
      for (const r of st.rounds.filter((r) => roundIds.includes(r.round_id))) {
        const greens = st.greens.get(`${r.course_id}/${r.course_version}`) ?? new Map();
        out.set(r.round_id, pinsForRound(r.pin_overrides, greens));
      }
      return Promise.resolve(out);
    },
    updateShot(shotId, patch: DerivedShotPatch) {
      const s = st.shots.find((x) => x.shot_id === shotId)!;
      if (patch.seq !== undefined && s.round_id) {
        const clash = st.shots.find(
          (x) =>
            x !== s &&
            x.round_id === s.round_id &&
            x.hole_number === s.hole_number &&
            x.seq === patch.seq,
        );
        if (clash)
          throw new Error('duplicate key value violates unique constraint shots_round_seq_idx');
      }
      st.log.push(`updateShot ${shotId} ${Object.keys(patch).join(',')}`);
      const { start_position, end_position, ...rest } = patch;
      Object.assign(s, rest);
      if (start_position !== undefined) s.start_position = ewktToEwkb(start_position);
      if (end_position !== undefined) s.end_position = ewktToEwkb(end_position);
      return Promise.resolve();
    },
    round: (id) => Promise.resolve(st.rounds.find((r) => r.round_id === id) ?? null),
    roundShots: (id) => Promise.resolve(st.shots.filter((s) => s.round_id === id)),
    greenCentres: (courseId, version) =>
      Promise.resolve(st.greens.get(`${courseId}/${version}`) ?? new Map()),
    upsertHoleScores(rows: HoleScoreRow[]) {
      for (const row of rows) {
        const r = st.rounds.find((x) => x.round_id === row.round_id)!;
        r.hole_scores = [...r.hole_scores.filter((h) => h.hole_number !== row.hole_number), row];
      }
      return Promise.resolve();
    },
    updateRound(id, patch: RoundPatch) {
      Object.assign(
        st.rounds.find((r) => r.round_id === id)!,
        patch,
      );
      return Promise.resolve();
    },
    sessionByHash: (hash) =>
      Promise.resolve(st.sessions.find((s) => s.file_hash === hash)?.session_id ?? null),
    simShotsBetween: (clubIds, from, to) =>
      Promise.resolve(
        st.shots
          .filter(
            (s) =>
              s.source === 'sim' &&
              s.club_id !== null &&
              clubIds.includes(s.club_id) &&
              s.played_at >= from &&
              s.played_at <= to,
          )
          .map((s): ExistingSimShot => ({
            club_id: s.club_id!,
            played_at: s.played_at,
            sim_carry_m: s.sim_carry_m ?? null,
          })),
      ),
    insertSession(row) {
      if (st.sessions.some((s) => s.file_hash === row.file_hash)) return Promise.resolve(null);
      const session_id = uuid();
      st.sessions.push({ ...row, session_id });
      return Promise.resolve(session_id);
    },
    insertShots(rows: SimShotInsert[]) {
      for (const r of rows) st.shots.push(shotRow({ shot_id: uuid(), ...r }));
      return Promise.resolve();
    },
    deleteSession(id) {
      st.sessions = st.sessions.filter((s) => s.session_id !== id);
      st.shots = st.shots.filter((s) => s.sim_session_id !== id);
      return Promise.resolve();
    },
    setClubAliases(clubId, aliases) {
      st.clubs.find((c) => c.club_id === clubId)!.sim_name_aliases = aliases;
      return Promise.resolve();
    },
  };
}
