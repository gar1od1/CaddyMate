/**
 * Row and domain types the job functions share. The domain types mirror the
 * subset of packages/api/src/types.ts that the hole/pattern mirrors use (the
 * generated `Database` types are not bundled with the functions, so rows are
 * described by hand and loosely: numeric columns may arrive as strings).
 */
import type {
  ClubKind,
  Handedness,
  LatLng,
  Lie as LieKind,
  Penalty as PenaltyKind,
  RecommendationSnapshot,
  Shape as ShapeKind,
  ShotSource as ShotSourceKind,
  SlopeStrength,
  StanceSlope,
  Strike as StrikeKind,
} from './engine/index.ts';

export type {
  ClubKind,
  Handedness,
  LieKind,
  PenaltyKind,
  ShapeKind,
  ShotSourceKind,
  SlopeStrength,
  StrikeKind,
};

/** A numeric column as PostgREST may return it. */
export type Numeric = number | string | null;

/** `shots` row (select `*`). */
export interface ShotRow {
  shot_id: string;
  user_id: string;
  round_id: string | null;
  hole_number: number | null;
  seq: number | null;
  source: ShotSourceKind;
  club_id: string | null;
  played_at: string;
  start_position: unknown;
  start_accuracy_m: Numeric;
  end_position: unknown;
  end_accuracy_m: Numeric;
  holed: boolean;
  reconstructed: boolean;
  target_point: unknown;
  target_bearing_deg: Numeric;
  target_ref: unknown;
  intended_shape: ShapeKind | null;
  lie: LieKind | null;
  slope_up: SlopeStrength;
  slope_down: SlopeStrength;
  slope_above: SlopeStrength;
  slope_below: SlopeStrength;
  slope_suggested: unknown;
  strike: StrikeKind;
  penalty: PenaltyKind;
  stroke_count: number;
  conditions: unknown;
  putt_distance_m: Numeric;
  putt_remaining_m: Numeric;
  recommendation: unknown;
  observed_distance_m: Numeric;
  observed_lateral_m: Numeric;
  neutral_distance_m: Numeric;
  neutral_lateral_m: Numeric;
  condition_model_version: number | null;
  result_surface: LieKind | null;
  distance_to_pin_before_m: Numeric;
  distance_to_pin_after_m: Numeric;
  sim_session_id?: string | null;
  sim_carry_m?: Numeric;
  sim_total_m?: Numeric;
  sim_offline_m?: Numeric;
}

/** `clubs` row (the columns the jobs read). */
export interface ClubRow {
  club_id: string;
  name: string;
  kind: ClubKind;
  loft_deg: Numeric;
  stock_total_m: Numeric;
  sim_name_aliases: string[] | null;
}

/** `profiles` row (the columns the jobs read). */
export interface ProfileRow {
  handedness: Handedness;
  handicap_index_official: Numeric;
  recency_half_life_days: number | null;
}

/** `shots.conditions` jsonb (docs/SPEC.md §6.3), SI units, snake_case as stored. */
export interface ShotConditions {
  wind_speed_ms: number;
  wind_dir_deg: number;
  gust_ms: number | null;
  temp_c: number;
  pressure_hpa: number;
  elevation_start_m: number | null;
  elevation_end_m: number | null;
  wind_head_ms: number | null;
  wind_cross_ms: number | null;
  override: boolean;
}

/** Mirror of `@caddymate/api` `Shot`. */
export interface Shot {
  id: string;
  userId: string;
  roundId: string;
  holeNumber: number;
  seq: number;
  source: ShotSourceKind;
  clubId: string | null;
  playedAt: string;
  start: LatLng | null;
  startAccuracyM: number | null;
  end: LatLng | null;
  endAccuracyM: number | null;
  holed: boolean;
  reconstructed: boolean;
  target: LatLng | null;
  targetBearingDeg: number | null;
  targetRef: unknown;
  intendedShape: ShapeKind | null;
  lie: LieKind | null;
  slope: StanceSlope;
  strike: StrikeKind;
  penalty: PenaltyKind;
  strokeCount: number;
  conditions: ShotConditions | null;
  puttDistanceM: number | null;
  puttRemainingM: number | null;
  slopeSuggested: StanceSlope | null;
  recommendation: RecommendationSnapshot | null;
  observedDistanceM: number | null;
  observedLateralM: number | null;
  neutralDistanceM: number | null;
  neutralLateralM: number | null;
  conditionModelVersion: number | null;
  resultSurface: LieKind | null;
  distanceToPinBeforeM: number | null;
  distanceToPinAfterM: number | null;
}

/** Mirror of `@caddymate/api` `HoleScore`. */
export interface HoleScore {
  roundId: string;
  holeNumber: number;
  strokesLogged: number;
  strokesOverride: number | null;
  overrideReason: string | null;
  putts: number;
  penalties: number;
  points: number | null;
  netStrokes: number | null;
}

/** `hole_scores` row. */
export interface HoleScoreRow {
  round_id: string;
  hole_number: number;
  strokes_logged: number;
  strokes_override: number | null;
  override_reason: string | null;
  putts: number;
  penalties: number;
  points: number | null;
  net_strokes: number | null;
}

/** Mirror of `@caddymate/api` `num`: a finite number or null. */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
