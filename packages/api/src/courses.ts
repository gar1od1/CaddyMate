import type { Db } from './client.js';
import { must, num } from './errors.js';
import { geographyToLine, geographyToPoint, geographyToPolygon } from './geography.js';
import type { CourseBundle, CourseSummary, Hole, HoleFeature, Row, TeeSet } from './types.js';

const COURSE_COLUMNS = 'course_id,name,slug,country,centroid,current_version,status';

function courseFromRow(
  r: Pick<
    Row<'courses'>,
    'course_id' | 'name' | 'slug' | 'country' | 'centroid' | 'current_version' | 'status'
  >,
): CourseSummary {
  return {
    id: r.course_id,
    name: r.name,
    slug: r.slug,
    country: r.country,
    centroid: geographyToPoint(r.centroid),
    currentVersion: r.current_version,
    status: r.status,
  };
}

function featureFromRow(r: Row<'hole_features'>): HoleFeature {
  return {
    id: r.feature_id,
    holeId: r.hole_id,
    kind: r.kind,
    penalty: r.penalty,
    polygon: geographyToPolygon(r.polygon),
    point: geographyToPoint(r.point),
    treeRadiusM: num(r.tree_radius_m),
    treeHeightM: num(r.tree_height_m),
    notes: r.notes,
  };
}

/** Published courses (plus the user's own drafts, per RLS), by name. */
export async function listPublishedCourses(db: Db): Promise<CourseSummary[]> {
  const rows = must(
    await db.from('courses').select(COURSE_COLUMNS).eq('status', 'published').order('name'),
    'listPublishedCourses',
  );
  return rows.map(courseFromRow);
}

/**
 * Everything the play view needs for one course version: holes (with line of
 * play, green, features) and tee sets (with per-hole markers). `version`
 * defaults to the course's current version.
 */
export async function getCourseBundle(
  db: Db,
  courseId: string,
  version?: number,
): Promise<CourseBundle> {
  const courseRow = must(
    await db.from('courses').select(COURSE_COLUMNS).eq('course_id', courseId).single(),
    'getCourseBundle(course)',
  );
  const course = courseFromRow(courseRow);
  const v = version ?? course.currentVersion;

  const [holeRows, teeRows] = await Promise.all([
    db
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .eq('version', v)
      .order('hole_number')
      .then((r) => must(r, 'getCourseBundle(holes)')),
    db
      .from('tee_sets')
      .select('*')
      .eq('course_id', courseId)
      .eq('version', v)
      .order('name')
      .then((r) => must(r, 'getCourseBundle(tee_sets)')),
  ]);

  const holeIds = holeRows.map((h) => h.hole_id);
  const teeIds = teeRows.map((t) => t.tee_set_id);
  const [featureRows, markerRows] = await Promise.all([
    holeIds.length
      ? db
          .from('hole_features')
          .select('*')
          .in('hole_id', holeIds)
          .then((r) => must(r, 'getCourseBundle(features)'))
      : Promise.resolve([] as Row<'hole_features'>[]),
    teeIds.length
      ? db
          .from('tee_markers')
          .select('*')
          .in('tee_set_id', teeIds)
          .then((r) => must(r, 'getCourseBundle(markers)'))
      : Promise.resolve([] as Row<'tee_markers'>[]),
  ]);

  const holes: Hole[] = holeRows.map((h) => ({
    id: h.hole_id,
    number: h.hole_number,
    par: h.par,
    lineOfPlay: geographyToLine(h.line_of_play),
    green: geographyToPolygon(h.green_polygon),
    greenCentre: geographyToPoint(h.green_centre),
    features: featureRows.filter((f) => f.hole_id === h.hole_id).map(featureFromRow),
  }));

  const teeSets: TeeSet[] = teeRows.map((t) => ({
    id: t.tee_set_id,
    name: t.name,
    colourHex: t.colour_hex,
    courseRating: num(t.course_rating),
    slopeRating: t.slope_rating,
    bogeyRating: num(t.bogey_rating),
    par: t.par,
    markers: markerRows
      .filter((m) => m.tee_set_id === t.tee_set_id)
      .flatMap((m) => {
        const point = geographyToPoint(m.marker_point);
        return point
          ? [
              {
                id: m.tee_id,
                holeId: m.hole_id,
                point,
                strokeIndex: m.stroke_index,
                yardageM: num(m.yardage_m),
              },
            ]
          : [];
      }),
  }));

  return { course, version: v, holes, teeSets };
}
