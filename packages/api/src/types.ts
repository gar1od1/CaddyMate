/**
 * Domain types returned by the repository functions: camelCase, SI units,
 * geography already decoded to LatLng / Polygon. Engine-owned derived columns
 * (neutral_*, sg, grades, recommendation) are deliberately not part of `Shot`
 * so client upserts never overwrite them.
 */
import type { Database, Json } from '@caddymate/db';
import type { LatLng, Polygon, StanceSlope } from '@caddymate/engine';

type Enums = Database['public']['Enums'];
export type Tables = Database['public']['Tables'];
export type Row<T extends keyof Tables> = Tables[T]['Row'];

export type ClubKind = Enums['club_kind'];
export type LieKind = Enums['lie'];
export type FeatureKind = Enums['feature_kind'];
export type FeaturePenalty = Enums['feature_penalty'];
export type PenaltyKind = Enums['penalty'];
export type StrikeKind = Enums['strike'];
export type ShapeKind = Enums['shape'];
export type RoundStatus = Enums['round_status'];
export type ShotSourceKind = Enums['shot_source'];
export type { Json };

export interface Profile {
  userId: string;
  displayName: string | null;
  handedness: Enums['handedness'];
  units: string;
  handicapIndexOfficial: number | null;
  defaultShape: ShapeKind;
  homeCourseId: string | null;
}

export interface Club {
  id: string;
  name: string;
  kind: ClubKind;
  loftDeg: number | null;
  bagOrder: number;
  active: boolean;
  stockTotalM: number | null;
  stockCarryM: number | null;
  simNameAliases: string[];
}

export interface CourseSummary {
  id: string;
  name: string;
  slug: string;
  country: string;
  centroid: LatLng | null;
  currentVersion: number;
  status: Enums['course_status'];
}

export interface HoleFeature {
  id: string;
  holeId: string;
  kind: FeatureKind;
  penalty: FeaturePenalty;
  polygon: Polygon | null;
  point: LatLng | null;
  treeRadiusM: number | null;
  treeHeightM: number | null;
  notes: string | null;
}

export interface Hole {
  id: string;
  number: number;
  par: number;
  lineOfPlay: LatLng[] | null;
  green: Polygon | null;
  greenCentre: LatLng | null;
  features: HoleFeature[];
}

export interface TeeMarker {
  id: string;
  holeId: string;
  point: LatLng;
  strokeIndex: number | null;
  yardageM: number | null;
}

export interface TeeSet {
  id: string;
  name: string;
  colourHex: string | null;
  courseRating: number | null;
  slopeRating: number | null;
  bogeyRating: number | null;
  par: number | null;
  markers: TeeMarker[];
}

export interface CourseBundle {
  course: CourseSummary;
  version: number;
  holes: Hole[];
  teeSets: TeeSet[];
}

/** Weather snapshot in SI, as produced by the weather adapter. */
export interface WeatherSnapshot {
  windSpeedMps: number;
  /** Direction the wind blows FROM, degrees true. */
  windFromDeg: number;
  gustMps: number | null;
  tempC: number;
  pressureHpa: number;
  fetchedAt: string;
  source: string;
}

export interface Round {
  id: string;
  userId: string;
  courseId: string;
  courseVersion: number;
  teeSetId: string;
  startedAt: string;
  finishedAt: string | null;
  status: RoundStatus;
  weatherSnapshot: WeatherSnapshot | null;
  /** Keyed by hole number. */
  pinOverrides: Record<string, LatLng>;
  handicapIndexUsed: number | null;
  courseHandicap: number | null;
  playingHandicap: number | null;
  gross: number | null;
  adjustedGross: number | null;
  stableford: number | null;
  differential: number | null;
}

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

/** `shots.target_ref` jsonb: the feature-relative definition of the intended line. */
export interface TargetRef {
  kind: 'feature' | 'green_front' | 'green_centre' | 'green_back' | 'pin';
  featureId?: string;
  featureKind?: FeatureKind;
  anchor: LatLng;
  /** + right of the anchor, metres (club frame of ball → anchor). */
  offsetRightM: number;
  /** + beyond (long of) the anchor, metres. */
  offsetLongM: number;
}

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
  targetRef: TargetRef | null;
  intendedShape: ShapeKind | null;
  lie: LieKind | null;
  slope: StanceSlope;
  strike: StrikeKind;
  penalty: PenaltyKind;
  strokeCount: number;
  conditions: ShotConditions | null;
  puttDistanceM: number | null;
  puttRemainingM: number | null;
  // Derived by recomputeHole (client-side for Phase 1).
  observedDistanceM: number | null;
  observedLateralM: number | null;
  resultSurface: LieKind | null;
  distanceToPinBeforeM: number | null;
  distanceToPinAfterM: number | null;
}
