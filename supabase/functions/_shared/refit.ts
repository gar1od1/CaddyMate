/**
 * The authoritative pattern refit (docs/SPEC.md §8.8, decision 005): every
 * requested club is refitted from ALL its shots with the same pure code the
 * device runs (`patterns.ts`, a mirror of @caddymate/api), and
 * `club_patterns` / `club_condition_patterns` are overwritten with a fresh
 * `fitted_at` — the Edge Function result wins by writing last. Optionally
 * first re-normalises course shots whose `condition_model_version` is behind
 * the engine's (§7.6), and optionally learns the player's condition
 * coefficients (§8.6, decision 007). I/O goes through `JobStore` so the flow
 * is testable.
 *
 * Order with `learnConditions` (decision 007):
 *  1. fit every club's current neutral pattern in memory (its mean is the
 *     baseline the residuals are taken against) and run
 *     `fitConditionCoefficients` over all the player's course shots;
 *  2. if the merged `profiles.condition_overrides` changed, write it FIRST;
 *  3. then re-normalise every course shot of every club with the new model
 *     (only changed values are written);
 *  4. then refit the patterns: the requested clubs plus every club whose
 *     neutral results moved.
 * The override is the source of truth, so it is written before anything
 * derived from it. If a run dies after step 2, `recomputeNeutral: true`
 * repairs it: with overrides present it re-derives every course shot, not
 * only those behind the version (the version cannot tell learned models apart).
 */
import {
  CONDITION_MODEL_VERSION,
  DEFAULT_DRIVER_DISTANCE_M,
  DEFAULT_HALF_LIFE_DAYS,
  fitConditionCoefficients,
  resolveConditionModel,
  toClubFrame,
  toConditionOverrides,
  type ConditionModelOverrides,
  type ConditionModelV1,
  type FrameResult,
  type KindConditionEstimate,
  type LatLng,
  type LearnShot,
  type PriorClub,
} from './engine/index.ts';
import { isPenaltyRecord, lineBearing } from './hole.ts';
import {
  neutralResult,
  resolveElevations,
  toEngineConditions,
  type ClubProfile,
} from './neutral.ts';
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

/** The profile columns the jobs read. `condition_overrides` is untrusted JSON. */
export type JobProfileRow = ProfileRow & { condition_overrides?: unknown };

/**
 * Everything the jobs read and write. Reads run as the caller (RLS); pattern
 * writes as the service role.
 */
export interface JobStore {
  profile(userId: string): Promise<JobProfileRow | null>;
  /** Replace `profiles.condition_overrides` of the caller (RLS: own row). */
  writeConditionOverrides(userId: string, overrides: ConditionModelOverrides): Promise<void>;
  /** All of the caller's clubs. */
  clubs(): Promise<ClubRow[]>;
  /** Every shot (course + sim) of a club, pattern columns only. */
  patternRows(clubId: string): Promise<PatternShotRow[]>;
  /** Replace a club's pattern and its condition buckets (stale buckets deleted). */
  writePatterns(pattern: ClubPatternRow, buckets: ConditionPatternRow[]): Promise<void>;
  /** Course shots of these clubs with `condition_model_version` null or below `version`. */
  staleNeutralShots(clubIds: string[], version: number): Promise<ShotRow[]>;
  /** Every course shot of these clubs (full rows). */
  courseShots(clubIds: string[]): Promise<ShotRow[]>;
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

/** What `learnConditions` did (§8.6, decision 007). */
export interface ConditionLearnResult {
  /** Per club kind with usable course shots; `fitted: false` below 60 shots. */
  estimates: KindConditionEstimate[];
  /** `profiles.condition_overrides` after the merge (what is now stored). */
  overrides: ConditionModelOverrides;
  /** True when the stored override changed (and shots were re-normalised). */
  changed: boolean;
}

export interface RefitResult {
  clubs: ClubRefitResult[];
  /** Requested ids that are not the caller's clubs. */
  notFound: string[];
  /** Putters (no pattern) among the requested clubs. */
  skipped: string[];
  /** Shots whose neutral result was rewritten (recomputeNeutral / a changed override). */
  neutralUpdated: number;
  /** Null unless `learnConditions`. */
  conditions: ConditionLearnResult | null;
}

export interface RefitOptions {
  /** Default: all the caller's clubs. */
  clubIds?: readonly string[];
  /** Re-run `normaliseShot` for course shots behind the current condition model first. */
  recomputeNeutral?: boolean;
  /**
   * Learn the condition coefficients from all the player's course shots
   * (§8.6) and store them in `profiles.condition_overrides`. Default false
   * here; the `refit` endpoint defaults it to true.
   */
  learnConditions?: boolean;
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
 * A course shot's line bearing (null for penalty records or without one) and
 * the shot with its observed result re-derived from start/end in the club
 * frame when both ends and a bearing exist.
 */
function observedShot(shot: Shot, pin: LatLng | null): { bearing: number | null; observed: Shot } {
  const bearing = isPenaltyRecord(shot) ? null : lineBearing(shot, pin);
  if (bearing === null || !shot.start || !shot.end) return { bearing, observed: shot };
  const r = toClubFrame(shot.start, bearing, shot.end);
  return {
    bearing,
    observed: {
      ...shot,
      observedDistanceM: round2(r.alongM),
      observedLateralM: round2(r.lateralM),
    },
  };
}

/**
 * Re-derive one course shot's observed and neutral result (the pure half of
 * @caddymate/api `normaliseAndStoreShot`): observed from start/end in the
 * club frame when there is a line bearing, then `normaliseShot` with the
 * stored conditions snapshot (its elevations; no grid).
 */
export function renormaliseShot(
  shot: Shot,
  ctx: {
    club: ClubProfile | null;
    handedness: Handedness;
    pin: LatLng | null;
    /** The player's resolved condition model; default the engine's. */
    model?: ConditionModelV1;
  },
): Shot {
  const { bearing, observed } = observedShot(shot, ctx.pin);
  const n = neutralResult(observed, bearing, {
    club: ctx.club,
    handedness: ctx.handedness,
    ...(ctx.model ? { model: ctx.model } : {}),
  });
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

type Pins = Map<string, Map<number, LatLng>>;

const pinsFor = (store: JobStore, rows: readonly ShotRow[]): Promise<Pins> =>
  store.pins([...new Set(rows.flatMap((r) => r.round_id ?? []))]);

const pinOf = (pins: Pins, shot: Shot): LatLng | null =>
  pins.get(shot.roundId)?.get(shot.holeNumber) ?? null;

/** Re-normalise `rows` with `model`; write changed values. Returns the clubs touched. */
async function recomputeNeutral(
  store: JobStore,
  clubs: readonly ClubRow[],
  handedness: Handedness,
  model: ConditionModelV1,
  rows: readonly ShotRow[],
  pins: Pins,
): Promise<{ updated: number; clubIds: Set<string> }> {
  const byId = new Map(clubs.map((c) => [c.club_id, c]));
  const clubIds = new Set<string>();
  let updated = 0;
  for (const row of rows) {
    const shot = shotFromRow(row);
    const club = shot.clubId ? byId.get(shot.clubId) : undefined;
    const next = renormaliseShot(shot, {
      club: club ? clubProfile(club) : null,
      handedness,
      pin: pinOf(pins, shot),
      model,
    });
    const patch = neutralPatch(shot, next);
    if (patch) {
      await store.updateShot(shot.id, patch);
      updated++;
      if (shot.clubId) clubIds.add(shot.clubId);
    }
  }
  return { updated, clubIds };
}

/**
 * A stored course shot as a `LearnShot`, or null when it cannot inform the
 * fit: no club / pattern mean, no conditions snapshot, no line bearing or no
 * observed result. Conditions and elevations as `neutralResult` uses them.
 */
export function learnShotFromRow(
  row: ShotRow,
  ctx: {
    club: ClubRow | undefined;
    mean: FrameResult | undefined;
    handedness: Handedness;
    pin: LatLng | null;
  },
): LearnShot | null {
  const shot = shotFromRow(row);
  if (!ctx.club || !ctx.mean || !shot.conditions) return null;
  const { bearing, observed } = observedShot(shot, ctx.pin);
  const { observedDistanceM: along, observedLateralM: lateral } = observed;
  if (bearing === null || along === null || lateral === null) return null;
  const club: LearnShot['club'] = { kind: ctx.club.kind };
  const loft = num(ctx.club.loft_deg);
  if (loft !== null) club.loftDeg = loft;
  const out: LearnShot = {
    observed: { alongM: along, lateralM: lateral },
    neutralMean: ctx.mean,
    club,
    lineBearingDeg: bearing,
    conditions: toEngineConditions(shot.conditions, resolveElevations(shot)),
    lie: shot.lie ?? 'fairway',
    slope: shot.slope,
    handedness: ctx.handedness,
    playedAt: Date.parse(shot.playedAt),
    source: shot.source,
    strike: shot.strike,
    penalty: shot.penalty,
    isPutt: shot.lie === 'green',
    reconstructed: shot.reconstructed,
  };
  if (shot.endAccuracyM !== null) out.endAccuracyM = shot.endAccuracyM;
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasOverrides = (v: unknown): boolean => isPlainObject(v) && Object.keys(v).length > 0;

/**
 * Deep-merge `learned` into the stored overrides: learned leaves win, every
 * other stored key (manual tweaks, kinds not fitted this time) is kept.
 */
export function mergeOverrides(
  stored: unknown,
  learned: ConditionModelOverrides,
): ConditionModelOverrides {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isPlainObject(b)) return b;
    const out: Record<string, unknown> = isPlainObject(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
    return out;
  };
  return merge(isPlainObject(stored) ? stored : {}, learned) as ConditionModelOverrides;
}

/** Structural equality of JSON values, ignoring key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  return a === b;
}

interface FitClubOpts {
  now: Date;
  handicapIndex: number;
  driverDistanceM: number;
  halfLifeDays: number;
}

/** Steps 1–3 of the module doc. Returns the learn result and what re-normalisation touched. */
async function learnConditions(
  store: JobStore,
  userId: string,
  profile: JobProfileRow | null,
  clubs: readonly ClubRow[],
  handedness: Handedness,
  fitOpts: FitClubOpts,
): Promise<{ result: ConditionLearnResult; updated: number; clubIds: Set<string> }> {
  const means = new Map<string, FrameResult>();
  for (const club of clubs) {
    const fit = fitClubFromRows(priorClub(club), await store.patternRows(club.club_id), fitOpts);
    if (fit) {
      means.set(club.club_id, {
        alongM: fit.params.distance.mean,
        lateralM: fit.params.lateral.mean,
      });
    }
  }
  const rows = clubs.length ? await store.courseShots(clubs.map((c) => c.club_id)) : [];
  const pins = await pinsFor(store, rows);
  const byId = new Map(clubs.map((c) => [c.club_id, c]));
  const shots = rows.flatMap((row) => {
    const shot = learnShotFromRow(row, {
      club: row.club_id ? byId.get(row.club_id) : undefined,
      mean: row.club_id ? means.get(row.club_id) : undefined,
      handedness,
      pin: pinOf(pins, shotFromRow(row)),
    });
    return shot ?? [];
  });
  const estimates = fitConditionCoefficients(shots, {
    now: fitOpts.now,
    halfLifeDays: fitOpts.halfLifeDays,
    model: resolveConditionModel(profile?.condition_overrides as ConditionModelOverrides | null),
  });
  const stored = profile?.condition_overrides ?? {};
  const overrides = mergeOverrides(stored, toConditionOverrides(estimates));
  const changed = !sameJson(stored, overrides);
  const result = { estimates, overrides, changed };
  if (!changed) return { result, updated: 0, clubIds: new Set() };
  await store.writeConditionOverrides(userId, overrides);
  const model = resolveConditionModel(overrides);
  return { result, ...(await recomputeNeutral(store, clubs, handedness, model, rows, pins)) };
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
  const stored = profile?.condition_overrides;
  let neutralUpdated = 0;
  if (opts.recomputeNeutral && fittable.length) {
    // With overrides in force the version cannot tell models apart: re-derive every course shot.
    const ids = fittable.map((c) => c.club_id);
    const rows = hasOverrides(stored)
      ? await store.courseShots(ids)
      : await store.staleNeutralShots(ids, CONDITION_MODEL_VERSION);
    const model = resolveConditionModel(stored as ConditionModelOverrides | null);
    const pins = rows.length ? await pinsFor(store, rows) : new Map();
    neutralUpdated = (await recomputeNeutral(store, fittable, handedness, model, rows, pins))
      .updated;
  }

  const now = opts.now ?? new Date();
  const fitOpts: FitClubOpts = {
    now,
    handicapIndex: num(profile?.handicap_index_official) ?? DEFAULT_HANDICAP_INDEX,
    driverDistanceM: driverDistanceFor(allClubs),
    halfLifeDays: profile?.recency_half_life_days ?? DEFAULT_HALF_LIFE_DAYS,
  };

  let conditions: ConditionLearnResult | null = null;
  const targets = new Set(fittable.map((c) => c.club_id));
  if (opts.learnConditions) {
    const allFittable = allClubs.filter((c) => c.kind !== 'putter');
    const learned = await learnConditions(store, userId, profile, allFittable, handedness, fitOpts);
    conditions = learned.result;
    neutralUpdated += learned.updated;
    for (const id of learned.clubIds) targets.add(id);
  }

  const fittedAt = now.toISOString();
  const results: ClubRefitResult[] = [];
  for (const club of allClubs.filter((c) => targets.has(c.club_id))) {
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
  return { clubs: results, notFound, skipped, neutralUpdated, conditions };
}
