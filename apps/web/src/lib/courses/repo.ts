/**
 * Typed wrappers around the course RPCs. Work with either the browser or the
 * server Supabase client; RLS decides what the caller can see and write.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Point, Polygon } from 'geojson';
import type { Database, Json } from '@caddymate/db';
import type { CourseDoc, CourseSource, CourseStatus, CourseVersionDoc } from './types';

export type Db = SupabaseClient<Database>;

export interface CourseListItem {
  course_id: string;
  name: string;
  country: string;
  status: CourseStatus;
  source: CourseSource;
  current_version: number;
  created_by_user_id: string | null;
  updated_at: string;
}

/** Published courses plus the caller's own drafts (that is exactly the RLS read policy). */
export async function listCourses(db: Db): Promise<CourseListItem[]> {
  const { data, error } = await db
    .from('courses')
    .select(
      'course_id, name, country, status, source, current_version, created_by_user_id, updated_at',
    )
    .order('name');
  if (error) throw new Error(error.message);
  return data;
}

export interface NewCourseInput {
  name: string;
  country: string;
  lat: number;
  lng: number;
  source?: CourseSource;
  osmRelationId?: string | null;
  boundary?: Polygon | null;
}

export async function createCourse(db: Db, input: NewCourseInput): Promise<string> {
  const { data, error } = await db.rpc('course_create', {
    p_name: input.name,
    p_country: input.country,
    p_lat: input.lat,
    p_lng: input.lng,
    p_source: input.source ?? 'editor',
    ...(input.osmRelationId ? { p_osm_relation_id: input.osmRelationId } : {}),
    ...(input.boundary ? { p_boundary: input.boundary as unknown as Json } : {}),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function ensureDraft(db: Db, courseId: string): Promise<void> {
  const { error } = await db.rpc('course_ensure_draft', { p_course_id: courseId });
  if (error) throw new Error(error.message);
}

/** `version` undefined = the draft for writers, the current published version for readers. */
export async function getCourse(
  db: Db,
  courseId: string,
  version?: number,
): Promise<CourseVersionDoc | null> {
  const { data, error } = await db.rpc('course_get', {
    p_course_id: courseId,
    ...(version != null ? { p_version: version } : {}),
  });
  if (error) throw new Error(error.message);
  return (data as unknown as CourseVersionDoc | null) ?? null;
}

export interface CourseMetaPatch {
  name?: string;
  country?: string;
  centroid?: Point;
}

export async function saveDraft(
  db: Db,
  courseId: string,
  doc: CourseDoc,
  meta?: CourseMetaPatch,
): Promise<void> {
  const payload = meta ? { ...doc, course: meta } : doc;
  const { error } = await db.rpc('course_save_draft', {
    p_course_id: courseId,
    p_doc: payload as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/** Returns the new published version number. */
export async function publishCourse(
  db: Db,
  courseId: string,
  changeReason?: string,
): Promise<number> {
  const { data, error } = await db.rpc('course_publish', {
    p_course_id: courseId,
    ...(changeReason ? { p_change_reason: changeReason } : {}),
  });
  if (error) throw new Error(error.message);
  return data;
}
