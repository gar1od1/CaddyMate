/**
 * The course document exchanged with the `course_get` / `course_save_draft`
 * RPCs (packages/db/migrations/20260926000001_course_rpcs.sql). Field names are
 * the DB column names; geometries are GeoJSON in EPSG:4326 ([lng, lat]).
 */
import type { LineString, Point, Polygon } from 'geojson';
import type { Database } from '@caddymate/db';

export type FeatureKind = Database['public']['Enums']['feature_kind'];
export type FeaturePenalty = Database['public']['Enums']['feature_penalty'];
export type CourseStatus = Database['public']['Enums']['course_status'];
export type CourseSource = Database['public']['Enums']['course_source'];

export const FEATURE_KINDS: readonly FeatureKind[] = [
  'fairway',
  'first_cut',
  'rough',
  'deep_rough',
  'bunker',
  'water',
  'ob',
  'hardpan',
  'pine_straw',
  'tree',
  'wooded',
  'cart_path',
];

export const FEATURE_PENALTIES: readonly FeaturePenalty[] = ['none', 'lateral', 'yellow', 'ob'];

/** The working draft is always version 0; published versions are 1, 2, … */
export const DRAFT_VERSION = 0;

export interface CourseMeta {
  course_id: string;
  name: string;
  slug: string;
  country: string;
  status: CourseStatus;
  source: CourseSource;
  osm_relation_id: string | null;
  current_version: number;
  centroid: Point;
  boundary_polygon: Polygon | null;
  updated_at: string;
  can_write: boolean;
}

export interface HoleRow {
  hole_id: string;
  hole_number: number;
  par: number;
  line_of_play: LineString | null;
  green_polygon: Polygon | null;
  green_centre: Point | null;
}

export interface FeatureRow {
  feature_id: string;
  hole_id: string;
  kind: FeatureKind;
  penalty: FeaturePenalty;
  polygon: Polygon | null;
  /** Trees only. */
  point: Point | null;
  tree_radius_m: number | null;
  tree_height_m: number | null;
  notes: string | null;
}

export interface TeeSetRow {
  tee_set_id: string;
  name: string;
  colour_hex: string | null;
  course_rating: number | null;
  slope_rating: number | null;
  bogey_rating: number | null;
  par: number | null;
}

export interface TeeMarkerRow {
  tee_id: string;
  tee_set_id: string;
  hole_id: string;
  marker_point: Point;
  stroke_index: number | null;
  yardage_m: number | null;
}

/** Everything that belongs to one course version. */
export interface CourseDoc {
  holes: HoleRow[];
  features: FeatureRow[];
  tee_sets: TeeSetRow[];
  tee_markers: TeeMarkerRow[];
}

/** `course_get` result. */
export interface CourseVersionDoc extends CourseDoc {
  course: CourseMeta;
  version: number;
}

export const emptyDoc = (): CourseDoc => ({
  holes: [],
  features: [],
  tee_sets: [],
  tee_markers: [],
});

/** Penalty a newly created feature of `kind` starts with. */
export function defaultPenalty(kind: FeatureKind): FeaturePenalty {
  if (kind === 'water') return 'lateral';
  if (kind === 'ob') return 'ob';
  return 'none';
}

/** Trees are points; every other kind is a polygon (see the hole_features check). */
export const isPointKind = (kind: FeatureKind): boolean => kind === 'tree';
