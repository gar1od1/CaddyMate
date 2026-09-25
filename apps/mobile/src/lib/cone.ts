/**
 * The conditioned dispersion overlay for the selected club (docs/SPEC.md
 * §4, §8.5, §8.7). The club's neutral pattern (stored, or the seeded prior)
 * has the current conditions re-applied through the condition model's
 * affine map; when the current condition bucket has an empirical pattern
 * (n_effective ≥ 15) that observed pattern is drawn instead. Tee shots and
 * layups get the cone from the ball (80 % + 1σ core); once the conditioned
 * mean reaches the green (or the aim is on it) it switches to the
 * 1σ / 80 % / 95 % ellipses around the conditioned mean. Pure.
 */
import {
  EMPIRICAL_MIN_N,
  applyConditions,
  conditionBucketKey,
  conePolygon,
  ellipsePolygon,
  fromClubFrame,
  initialBearingDeg,
  pointInPolygon,
  predictEffects,
  windComponents,
  type ClubPattern,
  type ConditionContext,
  type Conditions,
  type FrameResult,
  type Handedness,
  type LatLng,
  type Lie,
  type PatternConfidence,
  type Polygon,
  type StanceSlope,
} from '@caddymate/engine';
import type { ClubProfile } from '@caddymate/api';

export type Ring = [number, number][];

/** along_c = along·F + E; lateral_c = lateral + along·L; plus the lie's extra σ. */
export interface ConditionMap {
  F: number;
  E: number;
  L: number;
  sigmaAlongM: number;
  sigmaLateralM: number;
}

/** Recover the condition model's affine map for a context (it is exact, see conditions/). */
export function conditionMap(ctx: ConditionContext, nominalDistanceM: number): ConditionMap {
  const o = applyConditions({ alongM: 0, lateralM: 0 }, ctx);
  const u = applyConditions({ alongM: 1, lateralM: 0 }, ctx);
  const eff = predictEffects({ ...ctx, nominalDistanceM });
  return {
    F: u.alongM - o.alongM,
    E: o.alongM,
    L: u.lateralM - o.lateralM,
    sigmaAlongM: eff.extraSigmaAlongM,
    sigmaLateralM: eff.extraSigmaLateralM,
  };
}

/**
 * Neutral pattern → conditioned pattern (what is drawn): means and quantiles
 * go through the affine map, SDs scale with F and widen by the lie's extra σ
 * (§7.4, added only when re-applying). Correlation and counts are kept.
 */
export function conditionPattern(pattern: ClubPattern, ctx: ConditionContext): ClubPattern {
  const m = conditionMap(ctx, pattern.distance.mean);
  const d = pattern.distance;
  const l = pattern.lateral;
  const along = (x: number) => x * m.F + m.E;
  const drift = d.mean * m.L;
  return {
    ...pattern,
    distance: {
      mean: along(d.mean),
      sd: Math.hypot(d.sd * m.F, m.sigmaAlongM),
      q10: along(d.q10),
      q50: along(d.q50),
      q90: along(d.q90),
    },
    lateral: {
      mean: l.mean + drift,
      sd_left: Math.hypot(l.sd_left, m.sigmaLateralM),
      sd_right: Math.hypot(l.sd_right, m.sigmaLateralM),
      q10: l.q10 + drift,
      q50: l.q50 + drift,
      q90: l.q90 + drift,
    },
  };
}

/** Condition bucket (§8.5) for a shot from here along `bearingDeg`. */
export function currentBucketKey(lie: Lie, conditions: Conditions, bearingDeg: number): string {
  const w = windComponents(conditions.windSpeedMps, conditions.windFromDeg, bearingDeg);
  return conditionBucketKey(lie, w.headMps, w.crossMps);
}

export interface EmpiricalPattern {
  params: ClubPattern;
  nEffective: number;
}

export interface OverlayInput {
  origin: LatLng;
  aim: LatLng;
  club: ClubProfile;
  /** Neutral pattern: the stored `club_patterns.params`, else the seeded prior. */
  pattern: ClubPattern;
  /** The club's `club_condition_patterns` row for the current bucket, if any. */
  empirical: EmpiricalPattern | null;
  conditions: Conditions;
  lie: Lie;
  slope: StanceSlope;
  handedness: Handedness;
  green: Polygon | null;
  /** Distance from the ball to the front edge of the green along the pin line. */
  greenFrontM: number | null;
}

export type OverlayKind = 'cone' | 'core' | 'e95' | 'e80' | 'e1';

export interface DispersionOverlay {
  mode: 'cone' | 'ellipse';
  /** Filled rings, widest first. */
  rings: { kind: OverlayKind; ring: Ring }[];
  /** Outline (80 % cone / 80 % ellipse), drawn dashed unless established. */
  edge: Ring;
  /** Conditioned mean landing point. */
  centre: LatLng;
  meanAlongM: number;
  confidence: PatternConfidence;
  dashed: boolean;
  /** True when drawing the empirical condition-bucket pattern. */
  empirical: boolean;
  /** "forming · 18 shots · estimated" / "established · 42 shots · from 23 similar shots". */
  label: string;
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

export function overlayLabel(
  confidence: PatternConfidence,
  nShots: number,
  empiricalN: number | null,
): string {
  const source =
    empiricalN === null ? 'estimated' : `from ${plural(Math.round(empiricalN), 'similar shot')}`;
  return `${confidence} · ${plural(nShots, 'shot')} · ${source}`;
}

export function buildDispersionOverlay(input: OverlayInput): DispersionOverlay | null {
  if (input.club.kind === 'putter') return null;
  const bearing = initialBearingDeg(input.origin, input.aim);
  const club: ConditionContext['club'] = { kind: input.club.kind };
  if (input.club.loftDeg != null) club.loftDeg = input.club.loftDeg;
  const ctx: ConditionContext = {
    club,
    lineBearingDeg: bearing,
    conditions: input.conditions,
    lie: input.lie,
    slope: input.slope,
    handedness: input.handedness,
  };
  const useEmpirical = !!input.empirical && input.empirical.nEffective >= EMPIRICAL_MIN_N;
  const drawn =
    useEmpirical && input.empirical ? input.empirical.params : conditionPattern(input.pattern, ctx);
  if (!(drawn.distance.mean > 0)) return null;

  const toRing = (pts: readonly FrameResult[]): Ring =>
    pts.map((r) => {
      const p = fromClubFrame(input.origin, bearing, r);
      return [p.lng, p.lat];
    });
  const centre = fromClubFrame(input.origin, bearing, {
    alongM: drawn.distance.mean,
    lateralM: drawn.lateral.mean,
  });
  const aimOnGreen = !!input.green && pointInPolygon(input.green, input.aim);
  const reaches = input.greenFrontM !== null && drawn.distance.mean >= input.greenFrontM;
  const mode = aimOnGreen || reaches ? 'ellipse' : 'cone';

  let rings: DispersionOverlay['rings'];
  let edge: Ring;
  if (mode === 'cone') {
    const outer = toRing(conePolygon(drawn, { quantile: 0.8 }));
    rings = [
      { kind: 'cone', ring: outer },
      { kind: 'core', ring: toRing(conePolygon(drawn, { quantile: 1 })) },
    ];
    edge = outer;
  } else {
    const e80 = toRing(ellipsePolygon(drawn, 0.8));
    rings = [
      { kind: 'e95', ring: toRing(ellipsePolygon(drawn, 0.95)) },
      { kind: 'e80', ring: e80 },
      { kind: 'e1', ring: toRing(ellipsePolygon(drawn, 1)) },
    ];
    edge = e80;
  }

  // Confidence and counts describe the club's data; the source says what is drawn.
  const confidence = input.pattern.confidence;
  return {
    mode,
    rings,
    edge,
    centre,
    meanAlongM: drawn.distance.mean,
    confidence,
    dashed: confidence !== 'established',
    empirical: useEmpirical,
    label: overlayLabel(
      confidence,
      input.pattern.n_raw,
      useEmpirical && input.empirical ? input.empirical.nEffective : null,
    ),
  };
}
