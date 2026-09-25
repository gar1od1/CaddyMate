/**
 * Shot weighting (§8.1, §8.2): `w = shot.weight · source_weight · 0.5^(age/H)`.
 */
import type { ShotSource } from '../types/index.js';
import type { PatternShot, SourceWeights } from './types.js';

export const DEFAULT_HALF_LIFE_DAYS = 180;

const MS_PER_DAY = 86_400_000;

export const toEpochMs = (t: Date | number): number => (typeof t === 'number' ? t : t.getTime());

/**
 * Recency weight in (0, 1]: 1 for a shot played now, ½ at one half-life.
 * Shots dated after `now` (clock skew) are treated as played now.
 */
export function recencyWeight(
  playedAt: Date | number,
  now: Date | number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  if (!(halfLifeDays > 0)) throw new RangeError('halfLifeDays must be > 0');
  const ageDays = Math.max(0, (toEpochMs(now) - toEpochMs(playedAt)) / MS_PER_DAY);
  return 0.5 ** (ageDays / halfLifeDays);
}

/** Source multiplier; 1.0 for every source unless overridden (§8.1 decision). */
export const sourceWeight = (source: ShotSource, weights?: SourceWeights): number =>
  weights?.[source] ?? 1;

/**
 * §8.1 exclusions: penalty/relief records, putts, reconstructed shots whose
 * end position is uncertain by more than 15 m, and non-finite results.
 * (Strike ≠ good is not an exclusion here — those shots feed the miss pattern.)
 */
export function isExcludedShot(s: PatternShot): boolean {
  if (!Number.isFinite(s.alongM) || !Number.isFinite(s.lateralM)) return true;
  if (s.penalty !== undefined && s.penalty !== 'none') return true;
  if (s.isPutt === true) return true;
  return s.reconstructed === true && (s.endAccuracyM ?? Infinity) > 15;
}

/** Full weight of a shot: per-shot × source × recency. */
export function shotWeight(
  s: PatternShot,
  now: Date | number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
  weights?: SourceWeights,
): number {
  return (
    (s.weight ?? 1) * sourceWeight(s.source, weights) * recencyWeight(s.playedAt, now, halfLifeDays)
  );
}
