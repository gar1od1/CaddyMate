/**
 * Pattern fitting (§8.3–§8.5). Weighted moments with the prior folded in as
 * `n0` pseudo-observations (the conjugate-normal shortcut):
 *
 *   μ  = (n0·μ0 + Σ wᵢxᵢ) / (n0 + Σ wᵢ)
 *   σ² = (n0·σ0² + Σ wᵢ(xᵢ − μ)²) / (n0 + Σ wᵢ)
 *
 * Lateral spread is split into left/right half-SDs: each side's squared
 * deviations about μ, doubled, over the same denominator, with the prior's
 * n0·σ0² shared equally. For symmetric data both converge on σ.
 *
 * The lateral model used for quantiles, rendering and sampling is the
 * equal-mass two-piece normal: half the probability left of `mean` with
 * scale `sd_left`, half right with `sd_right`.
 */
import type {
  ClubPattern,
  FitOptions,
  MeanSd,
  PatternConfidence,
  PatternPrior,
  PatternShot,
  SourceWeights,
} from './types.js';
import { DEFAULT_HALF_LIFE_DAYS, isExcludedShot, shotWeight, toEpochMs } from './weights.js';

/** Standard-normal 90th percentile. */
export const Z90 = 1.2815515655446004;

/** n_effective at or above which quantiles come from the data (§8.4, §8.5). */
export const EMPIRICAL_MIN_N = 15;

interface Weighted {
  x: number;
  w: number;
}

/**
 * Weighted empirical quantile. Each point sits at the midpoint of its
 * cumulative-weight interval; `q` is interpolated linearly between points and
 * clamped to the extremes. Monotone in `q`. `points` need not be sorted.
 */
export function weightedQuantile(points: readonly Weighted[], q: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, p) => s + p.w, 0);
  let cum = 0;
  let prevP = 0;
  let prevX = sorted[0]!.x;
  for (let i = 0; i < sorted.length; i++) {
    const { x, w } = sorted[i]!;
    const p = (cum + w / 2) / total;
    if (p >= q) {
      if (i === 0) return x;
      return prevX + ((q - prevP) / (p - prevP)) * (x - prevX);
    }
    cum += w;
    prevP = p;
    prevX = x;
  }
  return prevX;
}

export function confidenceFor(nEffective: number): PatternConfidence {
  if (nEffective < 12) return 'seeded';
  if (nEffective <= 30) return 'forming';
  return 'established';
}

function weightedMeanSd(points: readonly Weighted[]): MeanSd {
  const W = points.reduce((s, p) => s + p.w, 0);
  if (W <= 0) return { mean: 0, sd: 0 };
  const mean = points.reduce((s, p) => s + p.w * p.x, 0) / W;
  const v = points.reduce((s, p) => s + p.w * (p.x - mean) ** 2, 0) / W;
  return { mean, sd: Math.sqrt(v) };
}

interface Prepared {
  along: number;
  lateral: number;
  w: number;
  shot: PatternShot;
}

interface Resolved {
  now: Date | number;
  halfLife: number;
  sourceWeights: SourceWeights | undefined;
  prior: PatternPrior | undefined;
}

const latestPlayedAt = (shots: readonly PatternShot[]): number =>
  shots.reduce((m, s) => Math.max(m, toEpochMs(s.playedAt)), -Infinity);

function resolve(shots: readonly PatternShot[], opts: FitOptions): Resolved {
  return {
    now: opts.now ?? latestPlayedAt(shots),
    halfLife: opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    sourceWeights: opts.sourceWeights,
    prior: opts.prior,
  };
}

/**
 * Fit a club's pattern (§8.4) from neutral shots. Shots with `strike ≠ good`
 * form the miss component; §8.1 exclusions and non-positive weights are
 * dropped. Throws when there are no usable good shots and no prior.
 */
export function fitPattern(shots: readonly PatternShot[], opts: FitOptions = {}): ClubPattern {
  const pattern = fitCore(shots, resolve(shots, opts));
  if (pattern === null) throw new RangeError('fitPattern needs at least one good shot or a prior');
  return pattern;
}

function fitCore(shots: readonly PatternShot[], r: Resolved): ClubPattern | null {
  const { now, halfLife } = r;
  const good: Prepared[] = [];
  const miss: Prepared[] = [];
  for (const shot of shots) {
    if (isExcludedShot(shot)) continue;
    const w = shotWeight(shot, now, halfLife, r.sourceWeights);
    if (!(w > 0)) continue;
    (shot.strike === 'good' ? good : miss).push({
      along: shot.alongM,
      lateral: shot.lateralM,
      w,
      shot,
    });
  }

  const prior: PatternPrior = r.prior ?? {
    n0: 0,
    distance: { mean: 0, sd: 0 },
    lateral: { mean: 0, sd: 0 },
  };
  const W = good.reduce((s, p) => s + p.w, 0);
  const denom = prior.n0 + W;
  if (!(denom > 0)) return null;

  const meanD =
    (prior.n0 * prior.distance.mean + good.reduce((s, p) => s + p.w * p.along, 0)) / denom;
  const meanL =
    (prior.n0 * prior.lateral.mean + good.reduce((s, p) => s + p.w * p.lateral, 0)) / denom;

  const priorVarD = prior.n0 * prior.distance.sd ** 2;
  const priorVarL = prior.n0 * prior.lateral.sd ** 2;
  let ssD = 0;
  let ssLeft = 0;
  let ssRight = 0;
  let sxy = 0;
  for (const p of good) {
    const dd = p.along - meanD;
    const dl = p.lateral - meanL;
    ssD += p.w * dd * dd;
    if (dl < 0) ssLeft += p.w * dl * dl;
    else ssRight += p.w * dl * dl;
    sxy += p.w * dd * dl;
  }
  const sdD = Math.sqrt((priorVarD + ssD) / denom);
  const sdLeft = Math.sqrt((priorVarL + 2 * ssLeft) / denom);
  const sdRight = Math.sqrt((priorVarL + 2 * ssRight) / denom);
  const sdL = Math.sqrt((priorVarL + ssLeft + ssRight) / denom);
  const cov = sxy / denom;
  const rho = sdD > 0 && sdL > 0 ? Math.min(1, Math.max(-1, cov / (sdD * sdL))) : 0;

  let distance: ClubPattern['distance'];
  let lateral: ClubPattern['lateral'];
  if (W >= EMPIRICAL_MIN_N) {
    const d = good.map((p) => ({ x: p.along, w: p.w }));
    const l = good.map((p) => ({ x: p.lateral, w: p.w }));
    distance = {
      mean: meanD,
      sd: sdD,
      q10: weightedQuantile(d, 0.1),
      q50: weightedQuantile(d, 0.5),
      q90: weightedQuantile(d, 0.9),
    };
    lateral = {
      mean: meanL,
      sd_left: sdLeft,
      sd_right: sdRight,
      q10: weightedQuantile(l, 0.1),
      q50: weightedQuantile(l, 0.5),
      q90: weightedQuantile(l, 0.9),
    };
  } else {
    distance = { mean: meanD, sd: sdD, q10: meanD - Z90 * sdD, q50: meanD, q90: meanD + Z90 * sdD };
    lateral = {
      mean: meanL,
      sd_left: sdLeft,
      sd_right: sdRight,
      q10: meanL - Z90 * sdLeft,
      q50: meanL,
      q90: meanL + Z90 * sdRight,
    };
  }

  const Wm = miss.reduce((s, p) => s + p.w, 0);
  return {
    distance,
    lateral,
    rho,
    n_effective: W,
    n_raw: good.length,
    n_sim: good.filter((p) => p.shot.source === 'sim').length,
    n_course: good.filter((p) => p.shot.source === 'course').length,
    miss: {
      p_miss: Wm > 0 ? Wm / (Wm + W) : 0,
      distance: weightedMeanSd(miss.map((p) => ({ x: p.along, w: p.w }))),
      lateral: weightedMeanSd(miss.map((p) => ({ x: p.lateral, w: p.w }))),
    },
    confidence: confidenceFor(W),
  };
}

export interface ConditionPattern {
  params: ClubPattern;
  n_effective: number;
}

/**
 * Empirical (no prior) patterns per condition bucket (§8.5). Pass OBSERVED
 * club-frame results with `bucketKey` set; shots without a key are ignored.
 * Only buckets with `n_effective ≥ 15` are returned. `opts.prior` is ignored.
 */
export function fitConditionPatterns(
  shots: readonly PatternShot[],
  opts: Omit<FitOptions, 'prior'> = {},
): Map<string, ConditionPattern> {
  const r: Resolved = { ...resolve(shots, opts), prior: undefined };
  const byBucket = new Map<string, PatternShot[]>();
  for (const s of shots) {
    if (s.bucketKey === undefined) continue;
    const list = byBucket.get(s.bucketKey) ?? [];
    list.push(s);
    byBucket.set(s.bucketKey, list);
  }
  const out = new Map<string, ConditionPattern>();
  for (const [key, list] of byBucket) {
    const params = fitCore(list, r);
    if (params !== null && params.n_effective >= EMPIRICAL_MIN_N) {
      out.set(key, { params, n_effective: params.n_effective });
    }
  }
  return out;
}
