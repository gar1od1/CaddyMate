/**
 * OSM import orchestration: Overpass → mapper → new draft course. Used by the
 * /courses/import-osm route handler; the Overpass client is injected.
 */
import { createCourse, saveDraft, type Db } from '@/lib/courses/repo';
import { mapOverpassToCourse, type OsmImportStats } from './mapper';
import {
  buildGolfQuery,
  validateArea,
  type OverpassArea,
  type OverpassClient,
  type OverpassResponse,
} from './overpass';

export interface ImportRequest {
  /** Where to query Overpass… */
  area?: OverpassArea;
  /** …or an Overpass JSON response the user already has (`out geom`). */
  overpass?: OverpassResponse;
  /** Overrides the leisure=golf_course name. */
  name?: string | null;
  country: string;
}

export interface ImportResponse {
  courseId: string;
  name: string;
  warnings: string[];
  stats: OsmImportStats;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function areaCentre(area: OverpassArea | undefined): { lat: number; lng: number } | null {
  if (!area) return null;
  if (area.kind === 'around') return { lat: area.lat, lng: area.lng };
  return { lat: (area.south + area.north) / 2, lng: (area.west + area.east) / 2 };
}

export async function importOsmCourse(
  db: Db,
  overpass: OverpassClient,
  req: ImportRequest,
): Promise<ImportResponse> {
  const country = String(req.country ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new ImportError('country must be a 2-letter code', 400);

  let response: OverpassResponse;
  if (req.overpass) {
    if (!Array.isArray(req.overpass.elements)) {
      throw new ImportError('overpass JSON has no "elements" array', 400);
    }
    response = req.overpass;
  } else if (req.area) {
    let ql: string;
    try {
      ql = buildGolfQuery(validateArea(req.area));
    } catch (e) {
      throw new ImportError(e instanceof Error ? e.message : String(e), 400);
    }
    try {
      response = await overpass.query(ql);
    } catch (e) {
      throw new ImportError(
        `Could not reach Overpass (${e instanceof Error ? e.message : String(e)}). ` +
          'Try again later, or upload an Overpass JSON export instead.',
        502,
      );
    }
  } else {
    throw new ImportError('send either "area" or "overpass"', 400);
  }

  const mapped = mapOverpassToCourse(response);
  if (mapped.doc.holes.length === 0 && !mapped.course.boundary) {
    throw new ImportError('No golf holes or golf course found in that area.', 422);
  }
  const centre = mapped.course.centre ?? areaCentre(req.area);
  if (!centre) throw new ImportError('Could not work out the course centre.', 422);
  const name = req.name?.trim() || mapped.course.name || 'Imported course';

  const courseId = await createCourse(db, {
    name,
    country,
    lat: centre.lat,
    lng: centre.lng,
    source: 'osm',
    osmRelationId: mapped.course.osmRef,
    boundary: mapped.course.boundary,
  });
  try {
    await saveDraft(db, courseId, mapped.doc);
  } catch (e) {
    // Don't leave an empty course behind.
    await db.from('courses').delete().eq('course_id', courseId);
    throw e;
  }
  return { courseId, name, warnings: mapped.warnings, stats: mapped.stats };
}
