/**
 * Neutral results (docs/SPEC.md §4, §7): strip the condition model's
 * predicted effects from a course shot's observed club-frame result with the
 * engine's `normaliseShot`. Pure, so `recomputeHoleShots` (device and server)
 * and `normaliseAndStoreShot` produce identical numbers.
 */
import {
  CONDITION_MODEL_VERSION,
  STANDARD_CONDITIONS,
  normaliseShot,
  type ClubKind,
  type ConditionModelV1,
  type Conditions,
  type FrameResult,
  type Handedness,
  type LatLng,
} from '@caddymate/engine';
import type { Shot, ShotConditions } from './types.js';

/** What the condition model needs about the club. */
export interface ClubProfile {
  kind: ClubKind;
  loftDeg?: number | null;
}

export interface NeutralContext {
  /** Club of the shot (null → no neutral result). */
  club: ClubProfile | null;
  handedness: Handedness;
  /** Terrain height (metres) from the course elevation grid, when one is loaded. */
  elevationAt?: ((p: LatLng) => number | null) | null;
  /** Condition-model coefficients; defaults to the engine's. */
  model?: ConditionModelV1;
}

export interface ResolvedElevations {
  startM: number;
  endM: number;
  source: 'grid' | 'gps' | 'none';
}

/**
 * Elevations for normalising a shot (§7.2): the course grid at start and end
 * when both are on it, else the stored snapshot (GPS altitude) when both
 * values exist, else flat. The two ends always come from the same source so
 * datums never mix.
 */
export function resolveElevations(
  shot: Pick<Shot, 'start' | 'end' | 'conditions'>,
  elevationAt?: ((p: LatLng) => number | null) | null,
): ResolvedElevations {
  if (elevationAt && shot.start && shot.end) {
    const a = elevationAt(shot.start);
    const b = elevationAt(shot.end);
    if (a !== null && b !== null) return { startM: a, endM: b, source: 'grid' };
  }
  const c = shot.conditions;
  if (c && c.elevation_start_m !== null && c.elevation_end_m !== null) {
    return { startM: c.elevation_start_m, endM: c.elevation_end_m, source: 'gps' };
  }
  return { startM: 0, endM: 0, source: 'none' };
}

/** `shots.conditions` (snake_case, nullable) → the engine's `Conditions`. */
export function toEngineConditions(
  c: ShotConditions | null,
  elevation: { startM: number; endM: number } = { startM: 0, endM: 0 },
): Conditions {
  const base: Conditions = c
    ? {
        windSpeedMps: c.wind_speed_ms,
        windFromDeg: c.wind_dir_deg,
        tempC: c.temp_c,
        pressureHpa: c.pressure_hpa,
        elevationStartM: 0,
        elevationEndM: 0,
        override: c.override,
      }
    : { ...STANDARD_CONDITIONS };
  if (c?.gust_ms != null) base.gustMps = c.gust_ms;
  return { ...base, elevationStartM: elevation.startM, elevationEndM: elevation.endM };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NeutralResult extends FrameResult {
  conditionModelVersion: number;
}

/**
 * Neutral result of a course shot, or null when it has none: penalty
 * records, putts (lie `green`), shots without an observed result, a line
 * bearing or a (non-putter) club.
 */
export function neutralResult(
  shot: Pick<
    Shot,
    | 'start'
    | 'end'
    | 'lie'
    | 'slope'
    | 'conditions'
    | 'observedDistanceM'
    | 'observedLateralM'
    | 'penalty'
    | 'clubId'
  >,
  lineBearingDeg: number | null,
  ctx: NeutralContext,
): NeutralResult | null {
  if (shot.observedDistanceM === null || shot.observedLateralM === null) return null;
  if (lineBearingDeg === null || shot.lie === 'green') return null;
  if (shot.clubId === null || !ctx.club || ctx.club.kind === 'putter') return null;
  const elevation = resolveElevations(shot, ctx.elevationAt);
  const club: { kind: ClubKind; loftDeg?: number } = { kind: ctx.club.kind };
  if (ctx.club.loftDeg != null) club.loftDeg = ctx.club.loftDeg;
  const n = normaliseShot(
    { alongM: shot.observedDistanceM, lateralM: shot.observedLateralM },
    {
      club,
      lineBearingDeg,
      conditions: toEngineConditions(shot.conditions, elevation),
      lie: shot.lie ?? 'fairway',
      slope: shot.slope,
      handedness: ctx.handedness,
      ...(ctx.model ? { model: ctx.model } : {}),
    },
  );
  if (!Number.isFinite(n.alongM) || !Number.isFinite(n.lateralM)) return null;
  return {
    alongM: round2(n.alongM),
    lateralM: round2(n.lateralM),
    conditionModelVersion: ctx.model?.version ?? CONDITION_MODEL_VERSION,
  };
}
