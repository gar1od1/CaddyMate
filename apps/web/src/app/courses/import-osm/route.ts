import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Db } from '@/lib/courses/repo';
import { ImportError, importOsmCourse, type ImportRequest } from '@/lib/osm/import';
import { createHttpOverpassClient } from '@/lib/osm/overpass';

/**
 * POST { area: {kind:'bbox',south,west,north,east} | {kind:'around',lat,lng,radiusM},
 *        country, name? }  — or { overpass: <Overpass JSON>, country, name? }
 * → 201 { courseId, name, warnings, stats }. Creates a draft course owned by the caller.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: ImportRequest;
  try {
    body = (await request.json()) as ImportRequest;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  try {
    const result = await importOsmCourse(
      supabase as unknown as Db,
      createHttpOverpassClient(),
      body,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const status = e instanceof ImportError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
