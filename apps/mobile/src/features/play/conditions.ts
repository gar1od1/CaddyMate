/**
 * The engine's `Conditions` for the current position (docs/SPEC.md §7):
 * forecast or manual wind, air from the weather snapshot, and elevations
 * from the course grid when both ends are on it (else flat — GPS altitude is
 * too noisy for a live plays-like number). Pure.
 */
import {
  STANDARD_CONDITIONS,
  playsLikeDistance,
  type ClubKind,
  type ConditionModelV1,
  type Conditions,
  type Handedness,
  type LatLng,
  type Lie,
  type StanceSlope,
} from '@caddymate/engine';
import type { WeatherSnapshot } from '@caddymate/api';
import type { WindOverride } from './shotOps';

export function currentConditions(
  weather: WeatherSnapshot | null,
  override: WindOverride | null,
  elevationStartM: number | null,
  elevationEndM: number | null,
): Conditions {
  const flat = elevationStartM === null || elevationEndM === null;
  return {
    windSpeedMps: override?.speedMps ?? weather?.windSpeedMps ?? 0,
    windFromDeg: override?.fromDeg ?? weather?.windFromDeg ?? 0,
    tempC: weather?.tempC ?? STANDARD_CONDITIONS.tempC,
    pressureHpa: weather?.pressureHpa ?? STANDARD_CONDITIONS.pressureHpa,
    elevationStartM: flat ? 0 : elevationStartM,
    elevationEndM: flat ? 0 : elevationEndM,
    override: override !== null,
  };
}

/**
 * "Plays like" (§17 Q4) for a raw distance on `bearingDeg`: elevation,
 * head/tail wind and air density only. Null without a distance or a club.
 */
export function playsLike(
  distanceM: number | null,
  args: {
    bearingDeg: number | null;
    club: { kind: ClubKind; loftDeg?: number | null } | null;
    conditions: Conditions;
    lie: Lie;
    slope: StanceSlope;
    handedness: Handedness;
    /** The player's condition model (decision 007); default the engine's. */
    model?: ConditionModelV1;
  },
): number | null {
  if (distanceM === null || args.bearingDeg === null || !args.club || args.club.kind === 'putter') {
    return null;
  }
  const club: { kind: ClubKind; loftDeg?: number } = { kind: args.club.kind };
  if (args.club.loftDeg != null) club.loftDeg = args.club.loftDeg;
  const v = playsLikeDistance(distanceM, {
    club,
    lineBearingDeg: args.bearingDeg,
    conditions: args.conditions,
    lie: args.lie,
    slope: args.slope,
    handedness: args.handedness,
    ...(args.model ? { model: args.model } : {}),
  });
  return Number.isFinite(v) ? v : null;
}

/** Same point within ~1 cm. */
export const samePoint = (a: LatLng | null | undefined, b: LatLng | null | undefined) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
