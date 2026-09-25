/**
 * The authoritative pattern refit (docs/SPEC.md §8.8, decision 005): every
 * requested club is refitted from ALL its shots with the same pure code the
 * device runs (`patterns.ts`, a mirror of @caddymate/api), and
 * `club_patterns` / `club_condition_patterns` are overwritten with a fresh
 * `fitted_at` — the Edge Function result wins by writing last. Optionally
 * first re-normalises course shots whose `condition_model_version` is behind
 * the engine's (§7.6). I/O goes through `JobStore` so the flow is testable.
 */
import {
  CONDITION_MODEL_VERSION,
  DEFAULT_DRIVER_DISTANCE_M,
  DEFAULT_HALF_LIFE_DAYS,
  toClubFrame,
  type LatLng,
  type PriorClub,
} from './engine/index.ts';
import { isPenaltyRecord, lineBearing } from './hole.ts';
import { neutralResult, type ClubProfile } from './neutral.ts';
import {
  fitClubFromRows,
  patternRows,
  round2,
  type ClubPatternRow,
  type ConditionPatternRow,
  type PatternShotRow,
} from './patterns.ts';
import type { DerivedShotPatch } from './shots.ts';
import { shotFromRow } from './shots.ts';
import {
  type ClubRow,
  type Handedness,
  num,
  type ProfileRow,
  type Shot,
  type ShotRow,
} from './types.ts';

/** Handicap index assumed when the profile has no official one (§2: a 13-handicap). */
export const DEFAULT_HANDICAP_INDEX = 13;

/**
 * Everything the jobs read and write. Reads run as the caller (RLS); pattern
 * writes as the service role.
 */
export interface JobStore {
  profile(userId: string): Promise<ProfileRow | null>;
  /** All of the caller's clubs. */
  clubs(): Promise<ClubRow[]>;
  /** Every shot (course + sim) of a club, pattern columns only. */
  patternRows(clubId: string): Promise<PatternShotRow[]>;
  /** Replace a club's pattern and its condition buckets (stale buckets deleted). */
  writePatterns(pattern: ClubPatternRow, buckets: ConditionPatternRow[]): Promise<void>;
  /** Course shots of these clubs with `condition_model_version` null or below `version`. */
  staleNeutralShots(clubIds: string[], version: number): Promise<ShotRow[]>;
  /** Pin per (round, hole): the round's override, else the green centre of its course version. */
  pins(roundIds: string[]): Promise<Map<string, Map<number, LatLng>>>;
  updateShot(shotId: string, patch: DerivedShotPatch): Promise<void>;
}

export interface ClubRefitResult {
  clubId: string;
  name: string;
  n_raw: number;
  n_effective: number;
  confidence: 'seeded' | 'forming' | 'established';
  buckets: number;
  fitted_at: string;
}

export interface RefitResult {
  clubs: ClubRefitResult[];
  /** Requested ids that are not the caller's clubs. */
  notFound: string[];
  /** Putters (no pattern) among the requested clubs. */
  skipped: string[];
  /** Shots whose neutral result was rewritten (recomputeNeutral only). */
  neutralUpdated: number;
}

export interface RefitOptions {
  /** Default: all the caller's clubs. */
  clubIds?: readonly string[];
  /** Re-run `normaliseShot` for course shots behind the current condition model first. */
  recomputeNeutral?: boolean;
  now?: Date;
}

export const clubProfile = (c: ClubRow): ClubProfile => ({
  kind: c.kind,
  loftDeg: num(c.loft_deg),
});
const priorClub = (c: ClubRow): PriorClub => ({
  kind: c.kind,
  loftDeg: num(c.loft_deg),
  stockTotalM: num(c.stock_total_m),
});

/** Driver distance for the loft table (§8.3): the driver's stock total, else the default. */
export function driverDistanceFor(clubs: readonly ClubRow[]): number {
  for (const c of clubs) {
    const d = c.kind === 'driver' ? num(c.stock_total_m) : null;
    if (d !== null && d > 0) return d;
  }
  return DEFAULT_DRIVER_DISTANCE_M;
}

/**
 * Re-derive one course shot's observed and neutral result (the pure half of
 * @caddymate/api `normaliseAndStoreShot`): observed from start/end in the
 * club frame when there is a line bearing, then `normaliseShot` with the
 * stored conditions snapshot (its elevations; no grid).
 */
export function renormaliseShot(
  shot: Shot,
  ctx: { club: ClubProfile | null; handedness: Handedness; pin: LatLng | null },
): Shot {
  const bearing = isPenaltyRecord(shot) ? null : lineBearing(shot, ctx.pin);
  let observed = shot;
  if (bearing !== null && shot.start && shot.end) {
    const r = toClubFrame(shot.start, bearing, shot.end);
    observed = {
      ...shot,
      observedDistanceM: round2(r.alongM),
      observedLateralM: round2(r.lateralM),
    };
  }
  const n = neutralResult(observed, bearing, { club: ctx.club, handedness: ctx.handedness });
  return {
    ...observed,
    neutralDistanceM: n?.alongM ?? null,
    neutralLateralM: n?.lateralM ?? null,
    conditionModelVersion: n?.conditionModelVersion ?? null,
  };
}

function neutralPatch(before: Shot, after: Shot): DerivedShotPatch | null {
  const p: DerivedShotPatch = {};
  if (before.observedDistanceM !== after.observedDistanceM)
    p.observed_distance_m = after.observedDistanceM;
  if (before.observedLateralM !== after.observedLateralM)
    p.observed_lateral_m = after.observedLateralM;
  if (before.neutralDistanceM !== after.neutralDistanceM)
    p.neutral_distance_m = after.neutralDistanceM;
  if (before.neutralLateralM !== after.neutralLateralM) p.neutral_lateral_m = after.neutralLateralM;
  if (before.conditionModelVersion !== after.conditionModelVersion) {
    p.condition_model_version = after.conditionModelVersion;
  }
  return Object.keys(p).length ? p : null;
}

async function recomputeNeutral(
  store: JobStore,
  clubs: readonly ClubRow[],
  handedness: Handedness,
): Promise<number> {
  const byId = new Map(clubs.map((c) => [c.club_id, c]));
  const rows = await store.staleNeutralShots([...byId.keys()], CONDITION_MODEL_VERSION);
  if (!rows.length) return 0;
  const pins = await store.pins([...new Set(rows.flatMap((r) => r.round_id ?? []))]);
  let updated = 0;
  for (const row of rows) {
    const shot = shotFromRow(row);
    const club = shot.clubId ? byId.get(shot.clubId) : undefined;
    const pin = pins.get(shot.roundId)?.get(shot.holeNumber) ?? null;
    const next = renormaliseShot(shot, {
      club: club ? clubProfile(club) : null,
      handedness,
      pin,
    });
    const patch = neutralPatch(shot, next);
    if (patch) {
      await store.updateShot(shot.id, patch);
      updated++;
    }
  }
  return updated;
}

/** Refit the caller's clubs and store the results (see module doc). */
export async function refitClubs(
  store: JobStore,
  userId: string,
  opts: RefitOptions = {},
): Promise<RefitResult> {
  const [profile, allClubs] = await Promise.all([store.profile(userId), store.clubs()]);
  const wanted = opts.clubIds ? new Set(opts.clubIds) : null;
  const clubs = wanted ? allClubs.filter((c) => wanted.has(c.club_id)) : allClubs;
  const notFound = wanted
    ? [...wanted].filter((id) => !allClubs.some((c) => c.club_id === id))
    : [];
  const fittable = clubs.filter((c) => c.kind !== 'putter');
  const skipped = clubs.filter((c) => c.kind === 'putter').map((c) => c.club_id);

  const handedness = profile?.handedness ?? 'R';
  const neutralUpdated = opts.recomputeNeutral
    ? await recomputeNeutral(store, fittable, handedness)
    : 0;

  const now = opts.now ?? new Date();
  const fitOpts = {
    now,
    handicapIndex: num(profile?.handicap_index_official) ?? DEFAULT_HANDICAP_INDEX,
    driverDistanceM: driverDistanceFor(allClubs),
    halfLifeDays: profile?.recency_half_life_days ?? DEFAULT_HALF_LIFE_DAYS,
  };
  const fittedAt = now.toISOString();
  const results: ClubRefitResult[] = [];
  for (const club of fittable) {
    const fit = fitClubFromRows(priorClub(club), await store.patternRows(club.club_id), fitOpts);
    if (!fit) continue;
    const rows = patternRows(userId, club.club_id, fit, fittedAt);
    await store.writePatterns(rows.pattern, rows.buckets);
    results.push({
      clubId: club.club_id,
      name: club.name,
      n_raw: rows.pattern.n_raw,
      n_effective: rows.pattern.n_effective,
      confidence: rows.pattern.confidence,
      buckets: rows.buckets.length,
      fitted_at: fittedAt,
    });
  }
  return { clubs: results, notFound, skipped, neutralUpdated };
}
