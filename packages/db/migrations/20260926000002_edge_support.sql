-- Edge Function support (docs/SPEC.md §6.2 elevation_grids, §16).
--
--   * course_elevation_extent(): the lat/lng extent of a course version, used by
--     the `elevation` Edge Function to size the course elevation grid (the
--     function adds the 100 m buffer). SECURITY INVOKER: it is called with the
--     caller's JWT, so RLS decides whether the course is visible at all.
--   * Storage bucket `elevation` for the Float32 rasters. Supabase-only: the
--     plain-Postgres test harness (scripts/local-db.sh) has no `storage` schema,
--     so that part is skipped there.
--
-- weather_cache and elevation_grids keep their existing RLS: authenticated
-- users read, only the service role (which bypasses RLS) writes.

-- Extent of the course boundary if it has one, else of all hole geometry of the
-- version (line of play, greens, features, tee markers). Defaults to the
-- course's current version. NULL when the course is not visible or has no
-- geometry.
create or replace function public.course_elevation_extent(p_course_id uuid, p_version integer default null)
returns jsonb language sql stable security invoker set search_path = public, extensions as $$
  with c as (
    select course_id, coalesce(p_version, current_version) as version, boundary_polygon
    from public.courses where course_id = p_course_id
  ),
  h as (
    select h.* from public.holes h join c on h.course_id = c.course_id and h.version = c.version
  ),
  geoms as (
    select c.boundary_polygon::geometry as g from c where c.boundary_polygon is not null
    union all
    select x.g from (
      select line_of_play::geometry from h
      union all select green_polygon::geometry from h
      union all select green_centre::geometry from h
      union all select coalesce(f.polygon, f.point)::geometry
        from public.hole_features f join h on h.hole_id = f.hole_id
      union all select m.marker_point::geometry
        from public.tee_markers m join h on h.hole_id = m.hole_id
    ) x(g)
    where not exists (select 1 from c where c.boundary_polygon is not null)
  ),
  e as (select st_extent(g) as b from geoms)
  select jsonb_build_object(
    'version', c.version,
    'minLat', st_ymin(e.b), 'minLng', st_xmin(e.b),
    'maxLat', st_ymax(e.b), 'maxLng', st_xmax(e.b)
  )
  from c, e
  where e.b is not null;
$$;
grant execute on function public.course_elevation_extent(uuid, integer) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('elevation', 'elevation', false)
    on conflict (id) do nothing;
    -- Objects are written by the service role only; readers need the course.
    -- Paths are `<course_id>/v<version>.cmeg`.
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'elevation: read'
    ) then
      create policy "elevation: read" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'elevation'
          and public.can_read_course(nullif(split_part(name, '/', 1), '')::uuid)
        );
    end if;
  end if;
end $$;
