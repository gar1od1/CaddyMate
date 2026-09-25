/**
 * Condition-model coefficients (docs/SPEC.md §7). Every number the condition
 * model uses lives in one versioned object so it can be fitted per player
 * later (§8.6) and stored as a partial override in `profiles.condition_overrides`.
 * Changing any default here means bumping {@link CONDITION_MODEL_VERSION} (§7.6).
 */
import type { ClubKind, Lie, SlopeStrength, StanceSlope } from '../types/index.js';

export const CONDITION_MODEL_VERSION = 1;

/** Standard atmosphere the neutral pattern is referenced to (§4 "neutral result"). */
export const REFERENCE_TEMP_C = 20;
export const REFERENCE_PRESSURE_HPA = 1013.25;

export interface LieCoefficients {
  /** Multiplies the neutral along distance (divided out when normalising). */
  distanceFactor: number;
  /** Condition-specific spread added on re-application only, metres. */
  extraSigmaLateralM: number;
  extraSigmaDistanceM: number;
  /** Probability of a flyer; strategy models it as a mixture component. */
  flyerProbability: number;
}

export interface SlopeEffect {
  /** Fractional distance change, e.g. −0.03 = 3 % shorter. */
  distanceFrac: number;
  /** Lateral bias per 100 m of shot for a RIGHT-hander (+ = right); mirrored for left. */
  lateralPer100M: number;
}

export type SlopeToggle = keyof StanceSlope;

export interface ConditionModelV1 {
  version: typeof CONDITION_MODEL_VERSION;
  wind: {
    /** Fractional distance loss per m/s of headwind (§7.1 `k_head`). */
    headPerMps: number;
    /** Fractional distance gain per m/s of tailwind (§7.1 `k_tail`). */
    tailPerMps: number;
    /** Lateral metres per (m/s · m of shot), before hang (§7.1 `k_cross(kind)`). */
    crossPerMps: Record<ClubKind, number>;
    /** Relative time-in-air multiplier on crosswind drift; 7-iron-ish = 1. */
    hang: Record<ClubKind, number>;
    /**
     * Optional finer hang curve keyed by loft: `[loftDeg, hang]` pairs in
     * ascending loft order, linearly interpolated and clamped at the ends.
     * Used instead of `hang[kind]` when the club's loft is known.
     */
    hangByLoft: readonly (readonly [number, number])[];
  };
  elevation: {
    /** Metres of carry lost per metre of rise (§7.2 `k_elev(kind)`). */
    perMetre: Record<ClubKind, number>;
  };
  density: {
    /** `Δd = d · k · (1 − ρ/ρ₀)` (§7.3 `k_density`). */
    k: number;
  };
  /**
   * Floor on the combined wind × density distance multiplier so an absurd
   * wind (≳ 45 m/s) can't produce a zero or negative multiplier that would
   * make normalisation undefined.
   */
  minAirMultiplier: number;
  lie: Record<Lie, LieCoefficients>;
  /** Extra distance of a flyer, as a fraction (§7.4: +8 %). */
  flyerDistanceFrac: number;
  slope: Record<SlopeToggle, Record<Exclude<SlopeStrength, 'none'>, SlopeEffect>>;
}

const perKind = (
  driver: number,
  wood: number,
  hybrid: number,
  iron: number,
  wedge: number,
  putter: number,
): Record<ClubKind, number> => ({ driver, wood, hybrid, iron, wedge, putter });

const lie = (
  distanceFactor: number,
  extraSigmaLateralM: number,
  extraSigmaDistanceM: number,
  flyerProbability: number,
): LieCoefficients => ({
  distanceFactor,
  extraSigmaLateralM,
  extraSigmaDistanceM,
  flyerProbability,
});

export const DEFAULT_CONDITION_MODEL: ConditionModelV1 = {
  version: CONDITION_MODEL_VERSION,
  wind: {
    headPerMps: 0.021,
    tailPerMps: 0.011,
    // ≈ 8 m of drift for a 150 m 7-iron in a 10 mph (4.47 m/s) crosswind.
    // Putts are modelled separately (§5.5): no crosswind drift.
    crossPerMps: perKind(0.012, 0.012, 0.012, 0.012, 0.012, 0),
    hang: perKind(0.6, 0.7, 0.85, 1.0, 1.25, 0),
    hangByLoft: [
      [9, 0.6],
      [15, 0.7],
      [21, 0.85],
      [33, 1.0],
      [46, 1.15],
      [60, 1.35],
    ],
  },
  elevation: {
    // §7.2 gives irons 0.9, woods/driver 0.7, wedges 1.0; hybrids sit between
    // woods and irons. Putts roll: treat a rise 1 : 1.
    perMetre: perKind(0.7, 0.7, 0.8, 0.9, 1.0, 1.0),
  },
  density: { k: 0.55 },
  minAirMultiplier: 0.05,
  lie: {
    tee: lie(1.0, 0, 0, 0),
    fairway: lie(1.0, 0, 0, 0),
    first_cut: lie(0.98, 1.0, 2, 0.05),
    rough: lie(0.93, 3.0, 6, 0.15),
    deep_rough: lie(0.8, 6.0, 12, 0.05),
    sand: lie(0.9, 3.0, 8, 0),
    hardpan: lie(1.0, 2.0, 4, 0),
    pine_straw: lie(0.97, 2.0, 4, 0.05),
    // Not in the §7.4 table (putts use their own model); neutral here.
    green: lie(1.0, 0, 0, 0),
  },
  flyerDistanceFrac: 0.08,
  slope: {
    uphill: {
      mild: { distanceFrac: -0.03, lateralPer100M: 0 },
      severe: { distanceFrac: -0.07, lateralPer100M: -1 },
    },
    downhill: {
      mild: { distanceFrac: 0.02, lateralPer100M: 1 },
      severe: { distanceFrac: 0.04, lateralPer100M: 2 },
    },
    ballAboveFeet: {
      mild: { distanceFrac: -0.01, lateralPer100M: -4 },
      severe: { distanceFrac: -0.03, lateralPer100M: -9 },
    },
    ballBelowFeet: {
      mild: { distanceFrac: -0.01, lateralPer100M: 4 },
      severe: { distanceFrac: -0.03, lateralPer100M: 9 },
    },
  },
};

/** Recursive partial, with arrays replaced wholesale rather than merged. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Shape of `profiles.condition_overrides` (the version is never overridable). */
export type ConditionModelOverrides = DeepPartial<Omit<ConditionModelV1, 'version'>>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeInto(base: unknown, override: unknown): unknown {
  if (typeof base === 'number') {
    return typeof override === 'number' && Number.isFinite(override) ? override : base;
  }
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override : base;
  }
  // Everything else in the model is a plain object of the above.
  const obj = base as Record<string, unknown>;
  if (!isPlainObject(override)) return obj;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    out[key] = key in override ? mergeInto(obj[key], override[key]) : obj[key];
  }
  return out;
}

/**
 * Apply a player's partial overrides on top of a base model. Overrides arrive
 * as untrusted JSON from the DB, so only keys that exist in the base are
 * taken, a number is only replaced by a finite number, and `version` is fixed.
 */
export function resolveConditionModel(
  overrides?: ConditionModelOverrides | null,
  base: ConditionModelV1 = DEFAULT_CONDITION_MODEL,
): ConditionModelV1 {
  const merged = mergeInto(base, overrides ?? {}) as ConditionModelV1;
  return { ...merged, version: CONDITION_MODEL_VERSION };
}
