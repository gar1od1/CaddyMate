// Supabase Edge Function `elevation` — see ./handler.ts and ../README.md.
import { requireUser, serviceClient } from '../_shared/auth.ts';
import { HttpError, serveJson } from '../_shared/http.ts';
import { type ElevationGridRow, handleElevation } from './handler.ts';

const BUCKET = 'elevation';

Deno.serve(
  serveJson((req) =>
    handleElevation(req, {
      async authenticate(r) {
        const { client } = await requireUser(r);
        return {
          async courseExtent(courseId, version) {
            // Called as the user, so RLS decides whether the course is visible.
            const { data, error } = await client.rpc('course_elevation_extent', {
              p_course_id: courseId,
              p_version: version ?? null,
            });
            if (error) throw new HttpError(500, 'db_error', error.message);
            return data ?? null;
          },
        };
      },
      store: {
        async get(courseId, version) {
          const { data, error } = await serviceClient()
            .from('elevation_grids')
            .select('course_id, version, bbox, resolution_m, storage_path, min_m, max_m')
            .eq('course_id', courseId)
            .eq('version', version)
            .maybeSingle();
          if (error) throw new HttpError(500, 'db_error', error.message);
          return (data as ElevationGridRow | null) ?? null;
        },
        async put(row, raster) {
          const svc = serviceClient();
          const up = await svc.storage.from(BUCKET).upload(row.storage_path, raster, {
            contentType: 'application/octet-stream',
            upsert: true,
          });
          if (up.error) throw new HttpError(500, 'storage_error', up.error.message);
          const { error } = await svc.from('elevation_grids').upsert(row);
          if (error) throw new HttpError(500, 'db_error', error.message);
        },
      },
      mapboxToken: Deno.env.get('MAPBOX_TOKEN') || undefined,
      fetchImpl: fetch,
    }),
  ),
);
