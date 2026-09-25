/**
 * Mirror of the pure half of packages/api/src/patterns.ts: `shots` rows →
 * the engine's `PatternShot`, the club prior, and the fit that
 * `fitAndStoreClubPattern` performs (neutral pattern with prior + recency,
 * empirical observed patterns per condition bucket). `mirror_parity_test.ts`
 * checks the mapping and fit against the api on a fixture. Change the api
 * first, then this copy.
 */
import {
  conditionBucketKey,
  DISPERSION_ENGINE_VERSION,
  fitConditionPatterns,
  fitPattern,
  handicapBandFor,
  priorFor,
  windComponents,
  type ClubPattern,
  type PatternShot,
  type PriorClub,
  type SourceWeights,
} from './engine/index.ts';
import { num, type ShotConditions, type ShotRow } from './types.ts';

export const PATTERN_SHOT_COLUMNS =
  'shot_id,club_id,source,lie,penalty,strike,reconstructed,end_accuracy_m,played_at,conditions,' +
  'target_bearing_deg,neutral_distance_m,neutral_lateral_m,observed_distance_m,observed_lateral_m,' +
  'sim_total_m,sim_offline_m';

export type PatternShotRow = Pick<
  ShotRow,
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
  const c = r.conditions as ShotConditions | null;
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

export interface FitClubOptions {
  /** Player's handicap index → prior spread band (§8.3). Default band 11–15. */
  handicapIndex?: number | null;
  /** Driver distance scaling the loft table for clubs without a stock distance. */
  driverDistanceM?: number;
  halfLifeDays?: number;
  /** Recency reference. Default: now. */
  now?: Date | number;
  sourceWeights?: SourceWeights;
}

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

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ClubFit {
  params: ClubPattern;
  /** bucket key → empirical observed pattern (n_effective ≥ 15 only). */
  buckets: Map<string, { params: ClubPattern; n_effective: number }>;
}

/**
 * The computation of `fitAndStoreClubPattern` without the I/O: the neutral
 * pattern (prior + recency) and the condition-bucket patterns of one club
 * from all its rows. Null for putters.
 */
export function fitClubFromRows(
  club: PriorClub,
  rows: readonly PatternShotRow[],
  opts: FitClubOptions = {},
): ClubFit | null {
  if (club.kind === 'putter') return null;
  const common = {
    now: opts.now ?? new Date(),
    ...(opts.halfLifeDays !== undefined ? { halfLifeDays: opts.halfLifeDays } : {}),
    ...(opts.sourceWeights !== undefined ? { sourceWeights: opts.sourceWeights } : {}),
  };
  const params = fitPattern(patternShotsFromRows(rows, 'neutral'), {
    ...common,
    prior: clubPrior(club, opts),
  });
  const buckets = fitConditionPatterns(patternShotsFromRows(rows, 'observed'), common);
  return { params, buckets };
}

export interface ClubPatternRow {
  user_id: string;
  club_id: string;
  params: ClubPattern;
  n_effective: number;
  n_raw: number;
  confidence: ClubPattern['confidence'];
  fitted_at: string;
  engine_version: number;
}

export interface ConditionPatternRow {
  user_id: string;
  club_id: string;
  bucket_key: string;
  params: ClubPattern;
  n_effective: number;
  fitted_at: string;
  engine_version: number;
}

/** The `club_patterns` / `club_condition_patterns` rows for a fit (as the api writes them). */
export function patternRows(
  userId: string,
  clubId: string,
  fit: ClubFit,
  fittedAt: string,
): { pattern: ClubPatternRow; buckets: ConditionPatternRow[] } {
  return {
    pattern: {
      user_id: userId,
      club_id: clubId,
      params: fit.params,
      n_effective: round2(fit.params.n_effective),
      n_raw: fit.params.n_raw,
      confidence: fit.params.confidence,
      fitted_at: fittedAt,
      engine_version: DISPERSION_ENGINE_VERSION,
    },
    buckets: [...fit.buckets].map(([bucketKey, b]) => ({
      user_id: userId,
      club_id: clubId,
      bucket_key: bucketKey,
      params: b.params,
      n_effective: round2(b.n_effective),
      fitted_at: fittedAt,
      engine_version: DISPERSION_ENGINE_VERSION,
    })),
  };
}
