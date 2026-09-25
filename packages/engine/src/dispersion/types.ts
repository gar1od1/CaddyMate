/**
 * Dispersion-engine types (docs/SPEC.md §8). `ClubPattern` is persisted
 * verbatim as `club_patterns.params` / `club_condition_patterns.params`, so
 * its keys are snake_case to match the stored JSON (§8.4) exactly.
 */
import type { Penalty, ShotSource, Strike } from '../types/index.js';

/** Bump when the fitted parameters would change for the same inputs. */
export const DISPERSION_ENGINE_VERSION = 1;

/**
 * One shot as the dispersion engine sees it (§8.1): a club-frame result
 * (+along down the intended line, +lateral to the player's right, metres)
 * that has already been normalised to neutral conditions — or, for
 * condition-matched patterns (§8.5), the observed result.
 */
export interface PatternShot {
  alongM: number;
  lateralM: number;
  /** When the shot was played: a `Date` or epoch milliseconds. */
  playedAt: Date | number;
  source: ShotSource;
  /** `good` feeds the main pattern; anything else feeds the miss pattern. */
  strike: Strike;
  /** Extra per-shot multiplier on top of source and recency weights. Default 1. */
  weight?: number;
  /** Opaque condition-bucket key (§8.5), as produced by the conditions module. */
  bucketKey?: string;
  // §8.1 exclusions — all optional so sim rows need not carry them.
  /** Penalty / relief records are excluded. */
  penalty?: Penalty;
  /** Putts are excluded. */
  isPutt?: boolean;
  /** Reconstructed shots are excluded when `endAccuracyM > 15`. */
  reconstructed?: boolean;
  endAccuracyM?: number;
}

export type PatternConfidence = 'seeded' | 'forming' | 'established';

export interface DistanceParams {
  mean: number;
  sd: number;
  q10: number;
  q50: number;
  q90: number;
}

export interface LateralParams {
  /** Bias, + right. */
  mean: number;
  /** Half-SD of the left side, measured from `mean`. */
  sd_left: number;
  /** Half-SD of the right side, measured from `mean`. */
  sd_right: number;
  q10: number;
  q50: number;
  q90: number;
}

export interface MeanSd {
  mean: number;
  sd: number;
}

export interface MissParams {
  /** Weighted share of non-excluded shots with `strike ≠ good`. */
  p_miss: number;
  distance: MeanSd;
  lateral: MeanSd;
}

/** `club_patterns.params` (§8.4). */
export interface ClubPattern {
  distance: DistanceParams;
  lateral: LateralParams;
  /** Weighted correlation between distance and lateral. */
  rho: number;
  /** Σ weights of the player's own shots in the main pattern (prior excluded). */
  n_effective: number;
  /** Count of shots in the main pattern (all sources). */
  n_raw: number;
  n_sim: number;
  n_course: number;
  miss: MissParams;
  confidence: PatternConfidence;
}

/** Cold-start prior expressed as `n0` pseudo-observations (§8.3). */
export interface PatternPrior {
  n0: number;
  distance: MeanSd;
  lateral: MeanSd;
}

/** Per-source multiplier (§8.1). Missing entries default to 1. */
export type SourceWeights = Partial<Record<ShotSource, number>>;

export interface FitOptions {
  /** Reference time for recency weighting. Defaults to the latest `playedAt` in the input. */
  now?: Date | number;
  /** Omit for a purely empirical fit (as for condition-matched patterns). */
  prior?: PatternPrior;
  /** Recency half-life, days (§8.2). Default 180. */
  halfLifeDays?: number;
  sourceWeights?: SourceWeights;
}

/** Contour level: `1` = 1σ, `0.8` / `0.95` = bivariate-normal 80 % / 95 %. */
export type DispersionLevel = 1 | 0.8 | 0.95;

/** A shot drawn from a pattern by {@link sampleShots}. */
export interface SampledShot {
  alongM: number;
  lateralM: number;
  /** True when drawn from the miss (disaster) component. */
  miss: boolean;
}
