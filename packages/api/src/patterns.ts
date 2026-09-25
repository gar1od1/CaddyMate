/**
 * Dispersion patterns (docs/SPEC.md §8): map `shots` rows to the engine's
 * `PatternShot`, fit a club's neutral pattern with its prior plus the
 * empirical condition-bucket patterns, and store / read `club_patterns` and
 * `club_condition_patterns`. Also the write path for a single shot's neutral
 * result (§6.4: produced by `normaliseShot`, stamped with the model version).
 */
import {
  DISPERSION_ENGINE_VERSION,
  conditionBucketKey,
  fitConditionPatterns,
  fitPattern,
  handicapBandFor,
  priorFor,
  toClubFrame,
  windComponents,
  type ClubPattern,
  type LatLng,
  type PatternShot,
  type PriorClub,
  type SourceWeights,
} from '@caddymate/engine';
import type { Db } from './client.js';
import { check, must, mustMaybe, num } from './errors.js';
import { lineBearing } from './hole.js';
import { neutralResult, type NeutralContext } from './neutral.js';
import type {
  Json,
  Row,
  Shot,
  ShotConditions,
  StoredClubPattern,
  StoredConditionPattern,
  Tables,
} from './types.js';

// ---------------------------------------------------------------------------
// shots rows → PatternShot
// ---------------------------------------------------------------------------

export const PATTERN_SHOT_COLUMNS =
  'shot_id,club_id,source,lie,penalty,strike,reconstructed,end_accuracy_m,played_at,conditions,' +
  'target_bearing_deg,neutral_distance_m,neutral_lateral_m,observed_distance_m,observed_lateral_m,' +
  'sim_total_m,sim_offline_m';

export type PatternShotRow = Pick<
  Row<'shots'>,
  | 'shot_id'
  | 'club_id'
  | 'source'
  | 'lie'
  | 'penalty'
  | 'strike'
  | 'reconstructed'
  | 'end_accuracy_m'
  | 'played_at'
  | 'conditions'
  | 'target_bearing_deg'
  | 'neutral_distance_m'
  | 'neutral_lateral_m'
  | 'observed_distance_m'
  | 'observed_lateral_m'
  | 'sim_total_m'
  | 'sim_offline_m'
>;

/** Condition bucket (§8.5) of a stored shot. Sim shots are calm, off a mat ≈ fairway. */
export function bucketKeyForRow(r: PatternShotRow): string {
  if (r.source === 'sim') return conditionBucketKey('fairway', 0, 0);
  const c = r.conditions as unknown as ShotConditions | null;
  let head = c?.wind_head_ms ?? null;
  let cross = c?.wind_cross_ms ?? null;
  const bearing = num(r.target_bearing_deg);
  if ((head === null || cross === null) && c && bearing !== null) {
    const w = windComponents(c.wind_speed_ms, c.wind_dir_deg, bearing);
    head = w.headMps;
    cross = w.crossMps;
  }
  // Missing wind → NaN → the calm bin (conditionBucketKey is total).
  return conditionBucketKey(r.lie ?? 'fairway', head ?? Number.NaN, cross ?? Number.NaN);
}

/**
 * One row as a `PatternShot`. `kind = 'neutral'` feeds the club pattern
 * (course: `neutral_*`; sim: total/offline — already neutral, §8.1);
 * `kind = 'observed'` feeds the condition-bucket patterns (§8.5: empirical
 * observed dispersion). Returns null when the row has no usable result.
 */
export function patternShotFromRow(
  r: PatternShotRow,
  kind: 'neutral' | 'observed' = 'neutral',
): PatternShot | null {
  let along: number | null;
  let lateral: number | null;
  if (r.source === 'sim') {
    along = num(r.sim_total_m);
    lateral = num(r.sim_offline_m);
  } else if (kind === 'neutral') {
    along = num(r.neutral_distance_m);
    lateral = num(r.neutral_lateral_m);
  } else {
    along = num(r.observed_distance_m);
    lateral = num(r.observed_lateral_m);
  }
  const playedAt = Date.parse(r.played_at);
  if (along === null || lateral === null || Number.isNaN(playedAt)) return null;
  const shot: PatternShot = {
    alongM: along,
    lateralM: lateral,
    playedAt,
    source: r.source,
    strike: r.strike,
    penalty: r.penalty,
    isPutt: r.lie === 'green',
    reconstructed: r.reconstructed,
    bucketKey: bucketKeyForRow(r),
  };
  const acc = num(r.end_accuracy_m);
  if (acc !== null) shot.endAccuracyM = acc;
  return shot;
}

export function patternShotsFromRows(
  rows: readonly PatternShotRow[],
  kind: 'neutral' | 'observed' = 'neutral',
): PatternShot[] {
  return rows.flatMap((r) => patternShotFromRow(r, kind) ?? []);
}

async function loadPatternRows(db: Db, clubId: string): Promise<PatternShotRow[]> {
  return must(
    await db.from('shots').select(PATTERN_SHOT_COLUMNS).eq('club_id', clubId),
    'loadPatternShots',
  ) as unknown as PatternShotRow[];
}

/** Every course and sim shot of a club as neutral `PatternShot`s (RLS: the signed-in user's). */
export async function loadPatternShots(db: Db, clubId: string): Promise<PatternShot[]> {
  return patternShotsFromRows(await loadPatternRows(db, clubId), 'neutral');
}

// ---------------------------------------------------------------------------
// Fit and store
// ---------------------------------------------------------------------------

export interface FitClubOptions {
  /** Club for the prior; defaults to the `clubs` row. */
  club?: PriorClub;
  /** Player's handicap index → prior spread band (§8.3). Default band 11–15. */
  handicapIndex?: number | null;
  /** Driver distance scaling the loft table for clubs without a stock distance. */
  driverDistanceM?: number;
  halfLifeDays?: number;
  /** Recency reference. Default: now. */
  now?: Date | number;
  sourceWeights?: SourceWeights;
}

export interface FittedClub {
  pattern: StoredClubPattern;
  conditionPatterns: StoredConditionPattern[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The prior (§8.3) for a club and handicap. Putters throw (no pattern). */
export function clubPrior(
  club: PriorClub,
  opts: Pick<FitClubOptions, 'handicapIndex' | 'driverDistanceM'> = {},
) {
  return priorFor(
    club,
    opts.driverDistanceM,
    opts.handicapIndex != null ? handicapBandFor(opts.handicapIndex) : undefined,
  );
}

/**
 * The pattern to use for a club: the stored one, else the seeded prior
 * (`fitPattern` of no shots — n_effective 0, confidence `seeded`).
 */
export function effectivePattern(
  club: PriorClub,
  stored: ClubPattern | null | undefined,
  opts: Pick<FitClubOptions, 'handicapIndex' | 'driverDistanceM'> = {},
): ClubPattern {
  return stored ?? fitPattern([], { prior: clubPrior(club, opts) });
}

/**
 * Refit one club from all its shots and store the result (§8.8): the neutral
 * pattern with prior + recency into `club_patterns`, and the empirical
 * observed pattern of every condition bucket with n_effective ≥ 15 into
 * `club_condition_patterns` (buckets that fell below the threshold are
 * removed). Returns null for putters.
 */
export async function fitAndStoreClubPattern(
  db: Db,
  userId: string,
  clubId: string,
  opts: FitClubOptions = {},
): Promise<FittedClub | null> {
  let club = opts.club;
  if (!club) {
    const row = must(
      await db.from('clubs').select('kind, loft_deg, stock_total_m').eq('club_id', clubId).single(),
      'fitAndStoreClubPattern(club)',
    );
    club = { kind: row.kind, loftDeg: num(row.loft_deg), stockTotalM: num(row.stock_total_m) };
  }
  if (club.kind === 'putter') return null;

  const rows = await loadPatternRows(db, clubId);
  const now = opts.now ?? new Date();
  const common = {
    now,
    ...(opts.halfLifeDays !== undefined ? { halfLifeDays: opts.halfLifeDays } : {}),
    ...(opts.sourceWeights !== undefined ? { sourceWeights: opts.sourceWeights } : {}),
  };
  const params = fitPattern(patternShotsFromRows(rows, 'neutral'), {
    ...common,
    prior: clubPrior(club, opts),
  });
  const buckets = fitConditionPatterns(patternShotsFromRows(rows, 'observed'), common);
  const fittedAt = new Date().toISOString();

  const patternRow: Tables['club_patterns']['Insert'] = {
    user_id: userId,
    club_id: clubId,
    params: params as unknown as NonNullable<Json>,
    n_effective: round2(params.n_effective),
    n_raw: params.n_raw,
    confidence: params.confidence,
    fitted_at: fittedAt,
    engine_version: DISPERSION_ENGINE_VERSION,
  };
  check(
    await db.from('club_patterns').upsert(patternRow, { onConflict: 'user_id,club_id' }),
    'fitAndStoreClubPattern(club_patterns)',
  );

  const bucketRows: Tables['club_condition_patterns']['Insert'][] = [...buckets].map(
    ([bucketKey, b]) => ({
      user_id: userId,
      club_id: clubId,
      bucket_key: bucketKey,
      params: b.params as unknown as NonNullable<Json>,
      n_effective: round2(b.n_effective),
      fitted_at: fittedAt,
      engine_version: DISPERSION_ENGINE_VERSION,
    }),
  );
  const existing = must(
    await db
      .from('club_condition_patterns')
      .select('bucket_key')
      .eq('user_id', userId)
      .eq('club_id', clubId),
    'fitAndStoreClubPattern(existing buckets)',
  );
  const stale = existing.map((r) => r.bucket_key).filter((k) => !buckets.has(k));
  if (stale.length) {
    check(
      await db
        .from('club_condition_patterns')
        .delete()
        .eq('user_id', userId)
        .eq('club_id', clubId)
        .in('bucket_key', stale),
      'fitAndStoreClubPattern(stale buckets)',
    );
  }
  if (bucketRows.length) {
    check(
      await db
        .from('club_condition_patterns')
        .upsert(bucketRows, { onConflict: 'user_id,club_id,bucket_key' }),
      'fitAndStoreClubPattern(club_condition_patterns)',
    );
  }

  return {
    pattern: {
      clubId,
      params,
      nEffective: patternRow.n_effective ?? 0,
      nRaw: params.n_raw,
      confidence: params.confidence,
      fittedAt,
      engineVersion: DISPERSION_ENGINE_VERSION,
    },
    conditionPatterns: bucketRows.map((r) => ({
      clubId,
      bucketKey: r.bucket_key,
      params: r.params as unknown as ClubPattern,
      nEffective: r.n_effective ?? 0,
      fittedAt,
      engineVersion: DISPERSION_ENGINE_VERSION,
    })),
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function storedClubPatternFromRow(r: Row<'club_patterns'>): StoredClubPattern {
  const params = r.params as unknown as ClubPattern;
  // The row's confidence column is authoritative (the Edge Function may refit).
  return {
    clubId: r.club_id,
    params: { ...params, confidence: r.confidence },
    nEffective: num(r.n_effective) ?? 0,
    nRaw: r.n_raw,
    confidence: r.confidence,
    fittedAt: r.fitted_at,
    engineVersion: r.engine_version,
  };
}

/** The signed-in user's stored club patterns (engine versions this build understands). */
export async function listClubPatterns(db: Db): Promise<StoredClubPattern[]> {
  const rows = must(await db.from('club_patterns').select('*'), 'listClubPatterns');
  return rows
    .filter((r) => r.engine_version <= DISPERSION_ENGINE_VERSION)
    .map(storedClubPatternFromRow);
}

/** clubId → neutral pattern (confidence from the row). Clubs without a row are absent. */
export async function getClubPatterns(db: Db): Promise<Map<string, ClubPattern>> {
  return new Map((await listClubPatterns(db)).map((p) => [p.clubId, p.params]));
}

/** The signed-in user's condition-bucket patterns (§8.5), optionally for one club. */
export async function listClubConditionPatterns(
  db: Db,
  clubId?: string,
): Promise<StoredConditionPattern[]> {
  let q = db.from('club_condition_patterns').select('*');
  if (clubId !== undefined) q = q.eq('club_id', clubId);
  const rows = must(await q, 'listClubConditionPatterns');
  return rows
    .filter((r) => r.engine_version <= DISPERSION_ENGINE_VERSION)
    .map((r) => ({
      clubId: r.club_id,
      bucketKey: r.bucket_key,
      params: r.params as unknown as ClubPattern,
      nEffective: num(r.n_effective) ?? 0,
      fittedAt: r.fitted_at,
      engineVersion: r.engine_version,
    }));
}

// ---------------------------------------------------------------------------
// One shot's neutral result
// ---------------------------------------------------------------------------

export interface NormaliseShotContext extends NeutralContext {
  /** Pin of the hole, for the intended line when the shot has no target. */
  pin?: LatLng | null;
}

/**
 * Compute a course shot's neutral result with `normaliseShot` and write
 * `neutral_distance_m`, `neutral_lateral_m`, `condition_model_version`
 * (null when the shot has none, e.g. putts). Returns the updated shot.
 */
export async function normaliseAndStoreShot(
  db: Db,
  shot: Shot,
  ctx: NormaliseShotContext,
): Promise<Shot> {
  const bearing =
    shot.penalty !== 'none' && shot.clubId === null ? null : lineBearing(shot, ctx.pin ?? null);
  let observed = shot;
  if (bearing !== null && shot.start && shot.end) {
    const r = toClubFrame(shot.start, bearing, shot.end);
    observed = {
      ...shot,
      observedDistanceM: round2(r.alongM),
      observedLateralM: round2(r.lateralM),
    };
  }
  const n = neutralResult(observed, bearing, ctx);
  const next: Shot = {
    ...observed,
    neutralDistanceM: n?.alongM ?? null,
    neutralLateralM: n?.lateralM ?? null,
    conditionModelVersion: n?.conditionModelVersion ?? null,
  };
  const row = mustMaybe(
    await db
      .from('shots')
      .update({
        neutral_distance_m: next.neutralDistanceM,
        neutral_lateral_m: next.neutralLateralM,
        condition_model_version: next.conditionModelVersion,
      })
      .eq('shot_id', shot.id)
      .select('shot_id')
      .maybeSingle(),
    'normaliseAndStoreShot',
  );
  if (!row) throw new Error('normaliseAndStoreShot: shot not found');
  return next;
}
