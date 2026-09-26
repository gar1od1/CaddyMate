/**
 * Supabase implementation of the job stores. Reads and shot / round / sim
 * writes use the caller's client, so RLS scopes everything to the caller;
 * only the pattern tables are written with the service role (§8.8: the
 * authoritative refit), always filtered by the caller's user id.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { LatLng } from './engine/index.ts';
import { geographyToPoint } from './geography.ts';
import { HttpError } from './http.ts';
import { PATTERN_SHOT_COLUMNS, type PatternShotRow } from './patterns.ts';
import type { JobProfileRow, JobStore } from './refit.ts';
import type { ClubRow, HoleScoreRow, ShotRow } from './types.ts';

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

export function must<T>(res: Res<T>, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data;
}

export function check(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** PostgREST caps a response (1000 rows by default): page through with `range`. */
export const PAGE = 1000;
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<Res<T[]>>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await page(from, from + PAGE - 1), what);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export const CLUB_COLUMNS = 'club_id,name,kind,loft_deg,stock_total_m,sim_name_aliases';

/** Pattern refit + neutral recompute store. */
export function supabaseJobStore(
  caller: SupabaseClient,
  service: SupabaseClient,
  userId: string,
): JobStore {
  return {
    async profile(uid) {
      const res = await caller
        .from('profiles')
        .select('handedness, handicap_index_official, recency_half_life_days, condition_overrides')
        .eq('user_id', uid)
        .maybeSingle();
      if (res.error) throw new Error(`profile: ${res.error.message}`);
      return (res.data as JobProfileRow | null) ?? null;
    },
    async writeConditionOverrides(uid, overrides) {
      if (uid !== userId) throw new Error('writeConditionOverrides: foreign user');
      check(
        await caller.from('profiles').update({ condition_overrides: overrides }).eq('user_id', uid),
        'writeConditionOverrides',
      );
    },
    async clubs() {
      return must(await caller.from('clubs').select(CLUB_COLUMNS), 'clubs') as ClubRow[];
    },
    patternRows(clubId) {
      return selectAll<PatternShotRow>(
        (a, b) =>
          caller
            .from('shots')
            .select(PATTERN_SHOT_COLUMNS)
            .eq('club_id', clubId)
            .order('shot_id')
            .range(a, b) as unknown as PromiseLike<Res<PatternShotRow[]>>,
        'patternRows',
      );
    },
    async writePatterns(pattern, buckets) {
      if (pattern.user_id !== userId) throw new Error('writePatterns: foreign user');
      check(
        await service.from('club_patterns').upsert(pattern, { onConflict: 'user_id,club_id' }),
        'club_patterns',
      );
      const existing = must(
        await service
          .from('club_condition_patterns')
          .select('bucket_key')
          .eq('user_id', userId)
          .eq('club_id', pattern.club_id),
        'club_condition_patterns(existing)',
      ) as { bucket_key: string }[];
      const keep = new Set(buckets.map((b) => b.bucket_key));
      const stale = existing.map((r) => r.bucket_key).filter((k) => !keep.has(k));
      if (stale.length) {
        check(
          await service
            .from('club_condition_patterns')
            .delete()
            .eq('user_id', userId)
            .eq('club_id', pattern.club_id)
            .in('bucket_key', stale),
          'club_condition_patterns(stale)',
        );
      }
      if (buckets.length) {
        check(
          await service
            .from('club_condition_patterns')
            .upsert(buckets, { onConflict: 'user_id,club_id,bucket_key' }),
          'club_condition_patterns',
        );
      }
    },
    staleNeutralShots(clubIds, version) {
      return courseShotRows(caller, clubIds, version);
    },
    courseShots(clubIds) {
      return courseShotRows(caller, clubIds, null);
    },
    async pins(roundIds) {
      const out = new Map<string, Map<number, LatLng>>();
      if (!roundIds.length) return out;
      const rounds = must(
        await caller
          .from('rounds')
          .select('round_id, course_id, course_version, pin_overrides')
          .in('round_id', roundIds),
        'pins(rounds)',
      ) as RoundPinRow[];
      const greens = new Map<string, Map<number, LatLng>>();
      for (const r of rounds) {
        const key = `${r.course_id}/${r.course_version}`;
        if (!greens.has(key))
          greens.set(key, await greenCentres(caller, r.course_id, r.course_version));
        out.set(r.round_id, pinsForRound(r.pin_overrides, greens.get(key)!));
      }
      return out;
    },
    async updateShot(shotId, patch) {
      check(await caller.from('shots').update(patch).eq('shot_id', shotId), 'updateShot');
    },
  };
}

/** Course shots of these clubs; with `staleBelow`, only those behind that model version. */
async function courseShotRows(
  caller: SupabaseClient,
  clubIds: readonly string[],
  staleBelow: number | null,
): Promise<ShotRow[]> {
  const out: ShotRow[] = [];
  for (const ids of chunks(clubIds, 100)) {
    out.push(
      ...(await selectAll<ShotRow>(
        (a, b) => {
          let q = caller.from('shots').select('*').eq('source', 'course').in('club_id', ids);
          if (staleBelow !== null) {
            q = q.or(`condition_model_version.is.null,condition_model_version.lt.${staleBelow}`);
          }
          return q.order('shot_id').range(a, b) as unknown as PromiseLike<Res<ShotRow[]>>;
        },
        staleBelow === null ? 'courseShots' : 'staleNeutralShots',
      )),
    );
  }
  return out;
}

interface RoundPinRow {
  round_id: string;
  course_id: string;
  course_version: number;
  pin_overrides: unknown;
}

/** hole number → green centre of a course version (RLS: readable courses only). */
export async function greenCentres(
  caller: SupabaseClient,
  courseId: string,
  version: number,
): Promise<Map<number, LatLng>> {
  const rows = must(
    await caller
      .from('holes')
      .select('hole_number, green_centre')
      .eq('course_id', courseId)
      .eq('version', version),
    'greenCentres',
  ) as { hole_number: number; green_centre: unknown }[];
  const out = new Map<number, LatLng>();
  for (const h of rows) {
    const p = geographyToPoint(h.green_centre);
    if (p) out.set(h.hole_number, p);
  }
  return out;
}

/** `rounds.pin_overrides` ({ "<hole>": {lat,lng} }) over the green centres. */
export function pinsForRound(overrides: unknown, greens: Map<number, LatLng>): Map<number, LatLng> {
  const out = new Map(greens);
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      const p = v as Partial<LatLng> | null;
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
        out.set(Number(k), { lat: p.lat, lng: p.lng });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// finalise-round
// ---------------------------------------------------------------------------

export interface RoundRow {
  round_id: string;
  user_id: string;
  course_id: string;
  course_version: number;
  status: 'live' | 'complete' | 'abandoned';
  finished_at: string | null;
  pin_overrides: unknown;
  hole_scores: HoleScoreRow[];
}

export interface RoundPatch {
  gross: number | null;
  status?: 'complete';
  finished_at?: string;
}

export interface FinaliseStore extends JobStore {
  round(roundId: string): Promise<RoundRow | null>;
  roundShots(roundId: string): Promise<ShotRow[]>;
  greenCentres(courseId: string, version: number): Promise<Map<number, LatLng>>;
  upsertHoleScores(rows: HoleScoreRow[]): Promise<void>;
  updateRound(roundId: string, patch: RoundPatch): Promise<void>;
}

export function supabaseFinaliseStore(
  caller: SupabaseClient,
  service: SupabaseClient,
  userId: string,
): FinaliseStore {
  return {
    ...supabaseJobStore(caller, service, userId),
    async round(roundId) {
      const res = await caller
        .from('rounds')
        .select(
          'round_id, user_id, course_id, course_version, status, finished_at, pin_overrides, hole_scores(*)',
        )
        .eq('round_id', roundId)
        .maybeSingle();
      if (res.error) throw new Error(`round: ${res.error.message}`);
      return (res.data as RoundRow | null) ?? null;
    },
    roundShots(roundId) {
      return selectAll<ShotRow>(
        (a, b) =>
          caller
            .from('shots')
            .select('*')
            .eq('round_id', roundId)
            .order('hole_number')
            .order('seq')
            .range(a, b) as unknown as PromiseLike<Res<ShotRow[]>>,
        'roundShots',
      );
    },
    greenCentres: (courseId, version) => greenCentres(caller, courseId, version),
    async upsertHoleScores(rows) {
      if (!rows.length) return;
      check(
        await caller.from('hole_scores').upsert(rows, { onConflict: 'round_id,hole_number' }),
        'upsertHoleScores',
      );
    },
    async updateRound(roundId, patch) {
      check(await caller.from('rounds').update(patch).eq('round_id', roundId), 'updateRound');
    },
  };
}

// ---------------------------------------------------------------------------
// import-sim
// ---------------------------------------------------------------------------

export interface SimSessionInsert {
  user_id: string;
  source: 'gspro' | 'square';
  file_hash: string;
  row_count: number;
  raw_payload: unknown;
  notes?: string | null;
}

export interface SimShotInsert {
  user_id: string;
  source: 'sim';
  club_id: string;
  played_at: string;
  sim_session_id: string;
  sim_carry_m: number;
  sim_total_m: number | null;
  sim_offline_m: number | null;
  strike: 'good';
}

export interface ExistingSimShot {
  club_id: string;
  played_at: string;
  sim_carry_m: number | string | null;
}

export interface SimStore extends JobStore {
  sessionByHash(hash: string): Promise<string | null>;
  /** Existing sim shots of these clubs played within [fromIso, toIso]. */
  simShotsBetween(clubIds: string[], fromIso: string, toIso: string): Promise<ExistingSimShot[]>;
  /** Insert the session; null when (user, file_hash) already exists (unique violation). */
  insertSession(row: SimSessionInsert): Promise<string | null>;
  insertShots(rows: SimShotInsert[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setClubAliases(clubId: string, aliases: string[]): Promise<void>;
}

export function supabaseSimStore(
  caller: SupabaseClient,
  service: SupabaseClient,
  userId: string,
): SimStore {
  return {
    ...supabaseJobStore(caller, service, userId),
    async sessionByHash(hash) {
      const res = await caller
        .from('sim_sessions')
        .select('session_id')
        .eq('user_id', userId)
        .eq('file_hash', hash)
        .maybeSingle();
      if (res.error) throw new Error(`sessionByHash: ${res.error.message}`);
      return (res.data as { session_id: string } | null)?.session_id ?? null;
    },
    async simShotsBetween(clubIds, fromIso, toIso) {
      if (!clubIds.length) return [];
      return await selectAll<ExistingSimShot>(
        (a, b) =>
          caller
            .from('shots')
            .select('club_id, played_at, sim_carry_m')
            .eq('source', 'sim')
            .in('club_id', clubIds)
            .gte('played_at', fromIso)
            .lte('played_at', toIso)
            .order('shot_id')
            .range(a, b) as unknown as PromiseLike<Res<ExistingSimShot[]>>,
        'simShotsBetween',
      );
    },
    async insertSession(row) {
      const res = await caller.from('sim_sessions').insert(row).select('session_id').single();
      if (res.error?.code === '23505') return null;
      return (must(res, 'insertSession') as { session_id: string }).session_id;
    },
    async insertShots(rows) {
      for (const part of chunks(rows, 500)) {
        check(await caller.from('shots').insert(part), 'insertShots');
      }
    },
    async deleteSession(sessionId) {
      check(
        await caller.from('sim_sessions').delete().eq('session_id', sessionId),
        'deleteSession',
      );
    },
    async setClubAliases(clubId, aliases) {
      check(
        await caller.from('clubs').update({ sim_name_aliases: aliases }).eq('club_id', clubId),
        'setClubAliases',
      );
    },
  };
}

/** Parse a JSON request body or throw 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'bad_request', 'Body must be JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'bad_request', 'Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
