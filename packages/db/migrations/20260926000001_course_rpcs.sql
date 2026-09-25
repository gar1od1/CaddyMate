-- Course editor RPCs (docs/SPEC.md §6.2, §13).
--
-- Versioning model
--   * Version 0 of every course is its working DRAFT. The web editor reads and
--     writes only version 0; rounds never pin it.
--   * course_publish() snapshots version 0 into the next version (1, 2, …),
--     bumps courses.current_version and marks the course published.
--   * courses.current_version = 0 means "never published".
--
-- Geometry crosses the API as GeoJSON (jsonb) in EPSG:4326: reads use
-- ST_AsGeoJSON, writes use ST_GeomFromGeoJSON. All functions are SECURITY
-- INVOKER, so the RLS policies of the underlying tables still apply; the
-- explicit can_write_course() checks only produce friendlier errors.

-- ---------------------------------------------------------------------------
-- Draft rows are private to the course's writers even once it is published.
-- (Child tables hole_features / tee_markers inherit through their EXISTS
-- subqueries, which are themselves subject to these policies.)
-- ---------------------------------------------------------------------------
drop policy "holes: read" on public.holes;
create policy "holes: read" on public.holes
  for select to authenticated
  using (public.can_read_course(course_id) and (version > 0 or public.can_write_course(course_id)));

drop policy "tee_sets: read" on public.tee_sets;
create policy "tee_sets: read" on public.tee_sets
  for select to authenticated
  using (public.can_read_course(course_id) and (version > 0 or public.can_write_course(course_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- GeoJSON geometry (jsonb) → geography, NULL-safe. Wrong geometry types are
-- rejected by the typed geography columns they are written into.
create or replace function public.course_geog(j jsonb)
returns geography language sql immutable set search_path = public, extensions as $$
  select case
    when j is null or jsonb_typeof(j) = 'null' then null
    else st_setsrid(st_geomfromgeojson(j::text), 4326)::geography
  end;
$$;

create or replace function public.course_geojson(g geography)
returns jsonb language sql immutable set search_path = public, extensions as $$
  select case when g is null then null else st_asgeojson(g)::jsonb end;
$$;

create or replace function public.course_assert_writer(p_course_id uuid)
returns void language plpgsql stable set search_path = public, extensions as $$
begin
  if not public.can_write_course(p_course_id) then
    raise exception 'course % not found or not writable', p_course_id using errcode = '42501';
  end if;
end $$;

-- Copy every row of version p_from into the (empty) version p_to, with new ids.
-- Children are re-linked by hole_number / tee-set name, which are unique per version.
create or replace function public.course_copy_version(p_course_id uuid, p_from integer, p_to integer)
returns void language plpgsql set search_path = public, extensions as $$
begin
  perform public.course_assert_writer(p_course_id);

  insert into public.holes (course_id, version, hole_number, par, line_of_play, green_polygon, green_centre)
  select course_id, p_to, hole_number, par, line_of_play, green_polygon, green_centre
  from public.holes where course_id = p_course_id and version = p_from;

  insert into public.hole_features (hole_id, kind, penalty, polygon, point, tree_radius_m, tree_height_m, notes)
  select nh.hole_id, f.kind, f.penalty, f.polygon, f.point, f.tree_radius_m, f.tree_height_m, f.notes
  from public.hole_features f
  join public.holes oh on oh.hole_id = f.hole_id and oh.course_id = p_course_id and oh.version = p_from
  join public.holes nh on nh.course_id = p_course_id and nh.version = p_to and nh.hole_number = oh.hole_number;

  insert into public.tee_sets (course_id, version, name, colour_hex, course_rating, slope_rating, bogey_rating, par)
  select course_id, p_to, name, colour_hex, course_rating, slope_rating, bogey_rating, par
  from public.tee_sets where course_id = p_course_id and version = p_from;

  insert into public.tee_markers (tee_set_id, hole_id, marker_point, stroke_index, yardage_m)
  select nt.tee_set_id, nh.hole_id, m.marker_point, m.stroke_index, m.yardage_m
  from public.tee_markers m
  join public.tee_sets ot on ot.tee_set_id = m.tee_set_id and ot.course_id = p_course_id and ot.version = p_from
  join public.tee_sets nt on nt.course_id = p_course_id and nt.version = p_to and nt.name = ot.name
  join public.holes oh on oh.hole_id = m.hole_id
  join public.holes nh on nh.course_id = p_course_id and nh.version = p_to and nh.hole_number = oh.hole_number;
end $$;

-- ---------------------------------------------------------------------------
-- course_create: a new draft course owned by the caller, with an empty version 0.
-- ---------------------------------------------------------------------------
create or replace function public.course_create(
  p_name text,
  p_country text,
  p_lng double precision,
  p_lat double precision,
  p_source course_source default 'editor',
  p_osm_relation_id text default null,
  p_boundary jsonb default null
)
returns uuid language plpgsql set search_path = public, extensions as $$
declare
  cid uuid;
  base text;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'course name is required' using errcode = '22023';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'centre out of range' using errcode = '22023';
  end if;
  base := trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));
  -- Drafts of other users are invisible under RLS, so a bare slug could collide
  -- with a row we cannot see: always add a short random suffix.
  insert into public.courses (
    name, slug, country, centroid, boundary_polygon, source, osm_relation_id,
    status, current_version, created_by_user_id
  ) values (
    trim(p_name),
    coalesce(nullif(base, ''), 'course') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
    upper(p_country),
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    public.course_geog(p_boundary),
    p_source,
    p_osm_relation_id,
    'draft',
    0,
    auth.uid()
  ) returning course_id into cid;

  insert into public.course_versions (course_id, version, change_reason, created_by_user_id)
  values (cid, 0, 'working draft', auth.uid());
  return cid;
end $$;

-- ---------------------------------------------------------------------------
-- course_ensure_draft: make sure version 0 exists; seed it from the current
-- published version when a course was created outside the editor.
-- ---------------------------------------------------------------------------
create or replace function public.course_ensure_draft(p_course_id uuid)
returns void language plpgsql set search_path = public, extensions as $$
declare
  cur integer;
begin
  perform public.course_assert_writer(p_course_id);
  if exists (select 1 from public.course_versions where course_id = p_course_id and version = 0) then
    return;
  end if;
  insert into public.course_versions (course_id, version, change_reason, created_by_user_id)
  values (p_course_id, 0, 'working draft', auth.uid());
  select current_version into cur from public.courses where course_id = p_course_id;
  if cur > 0 then
    perform public.course_copy_version(p_course_id, cur, 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- course_get: one version of a course as a JSON document with GeoJSON
-- geometries. p_version NULL = the draft for writers, current_version otherwise.
-- Returns NULL if the course is not visible to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.course_get(p_course_id uuid, p_version integer default null)
returns jsonb language plpgsql stable set search_path = public, extensions as $$
declare
  c public.courses%rowtype;
  v integer;
  writer boolean;
begin
  select * into c from public.courses where course_id = p_course_id;
  if not found then
    return null;
  end if;
  writer := public.can_write_course(p_course_id);
  v := coalesce(p_version, case when writer then 0 else c.current_version end);

  return jsonb_build_object(
    'course', jsonb_build_object(
      'course_id', c.course_id,
      'name', c.name,
      'slug', c.slug,
      'country', c.country,
      'status', c.status,
      'source', c.source,
      'osm_relation_id', c.osm_relation_id,
      'current_version', c.current_version,
      'centroid', public.course_geojson(c.centroid),
      'boundary_polygon', public.course_geojson(c.boundary_polygon),
      'updated_at', c.updated_at,
      'can_write', writer
    ),
    'version', v,
    'holes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hole_id', h.hole_id,
        'hole_number', h.hole_number,
        'par', h.par,
        'line_of_play', public.course_geojson(h.line_of_play),
        'green_polygon', public.course_geojson(h.green_polygon),
        'green_centre', public.course_geojson(h.green_centre)
      ) order by h.hole_number)
      from public.holes h where h.course_id = p_course_id and h.version = v
    ), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'feature_id', f.feature_id,
        'hole_id', f.hole_id,
        'kind', f.kind,
        'penalty', f.penalty,
        'polygon', public.course_geojson(f.polygon),
        'point', public.course_geojson(f.point),
        'tree_radius_m', f.tree_radius_m,
        'tree_height_m', f.tree_height_m,
        'notes', f.notes
      ) order by h.hole_number, f.kind, f.feature_id)
      from public.hole_features f
      join public.holes h on h.hole_id = f.hole_id
      where h.course_id = p_course_id and h.version = v
    ), '[]'::jsonb),
    'tee_sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tee_set_id', t.tee_set_id,
        'name', t.name,
        'colour_hex', t.colour_hex,
        'course_rating', t.course_rating,
        'slope_rating', t.slope_rating,
        'bogey_rating', t.bogey_rating,
        'par', t.par
      ) order by t.name)
      from public.tee_sets t where t.course_id = p_course_id and t.version = v
    ), '[]'::jsonb),
    'tee_markers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tee_id', m.tee_id,
        'tee_set_id', m.tee_set_id,
        'hole_id', m.hole_id,
        'marker_point', public.course_geojson(m.marker_point),
        'stroke_index', m.stroke_index,
        'yardage_m', m.yardage_m
      ) order by t.name, h.hole_number)
      from public.tee_markers m
      join public.tee_sets t on t.tee_set_id = m.tee_set_id
      join public.holes h on h.hole_id = m.hole_id
      where t.course_id = p_course_id and t.version = v
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- course_save_draft: atomically replace the draft (version 0) with p_doc.
--
--   p_doc = {
--     course?:      { name?, country?, centroid?: GeoJSON Point, boundary_polygon?: GeoJSON Polygon | null },
--     holes:        [{ hole_id?, hole_number, par, line_of_play?, green_polygon?, green_centre? }],
--     features:     [{ feature_id?, hole_id, kind, penalty?, polygon?, point?, tree_radius_m?, tree_height_m?, notes? }],
--     tee_sets:     [{ tee_set_id?, name, colour_hex?, course_rating?, slope_rating?, bogey_rating?, par? }],
--     tee_markers:  [{ tee_id?, tee_set_id, hole_id, marker_point, stroke_index?, yardage_m? }]
--   }
--
-- Client-supplied ids are kept so features/markers can reference holes and tee
-- sets inside the same document. yardage_m defaults to the geodesic distance
-- from the marker to the hole's green centre.
-- ---------------------------------------------------------------------------
create or replace function public.course_save_draft(p_course_id uuid, p_doc jsonb)
returns void language plpgsql set search_path = public, extensions as $$
declare
  meta jsonb := p_doc -> 'course';
  expected integer;
  written integer;
begin
  perform public.course_assert_writer(p_course_id);

  insert into public.course_versions (course_id, version, change_reason, created_by_user_id)
  values (p_course_id, 0, 'working draft', auth.uid())
  on conflict (course_id, version) do nothing;

  if meta is not null and jsonb_typeof(meta) = 'object' then
    update public.courses set
      name = coalesce(nullif(trim(meta ->> 'name'), ''), name),
      country = coalesce(upper(meta ->> 'country'), country),
      centroid = coalesce(public.course_geog(meta -> 'centroid'), centroid),
      boundary_polygon = case
        when meta ? 'boundary_polygon' then public.course_geog(meta -> 'boundary_polygon')
        else boundary_polygon
      end
    where course_id = p_course_id;
  else
    update public.courses set updated_at = now() where course_id = p_course_id;
  end if;

  -- Cascades remove the draft's features and markers.
  delete from public.holes where course_id = p_course_id and version = 0;
  delete from public.tee_sets where course_id = p_course_id and version = 0;

  insert into public.holes (hole_id, course_id, version, hole_number, par, line_of_play, green_polygon, green_centre)
  select
    coalesce((h ->> 'hole_id')::uuid, gen_random_uuid()),
    p_course_id, 0,
    (h ->> 'hole_number')::integer,
    (h ->> 'par')::integer,
    public.course_geog(h -> 'line_of_play'),
    public.course_geog(h -> 'green_polygon'),
    public.course_geog(h -> 'green_centre')
  from jsonb_array_elements(coalesce(p_doc -> 'holes', '[]'::jsonb)) h;

  insert into public.tee_sets (tee_set_id, course_id, version, name, colour_hex, course_rating, slope_rating, bogey_rating, par)
  select
    coalesce((t ->> 'tee_set_id')::uuid, gen_random_uuid()),
    p_course_id, 0,
    t ->> 'name',
    nullif(t ->> 'colour_hex', ''),
    (t ->> 'course_rating')::numeric,
    (t ->> 'slope_rating')::integer,
    (t ->> 'bogey_rating')::numeric,
    (t ->> 'par')::integer
  from jsonb_array_elements(coalesce(p_doc -> 'tee_sets', '[]'::jsonb)) t;

  -- Features and markers may only reference rows of this draft.
  expected := jsonb_array_length(coalesce(p_doc -> 'features', '[]'::jsonb));
  insert into public.hole_features (feature_id, hole_id, kind, penalty, polygon, point, tree_radius_m, tree_height_m, notes)
  select
    coalesce((f ->> 'feature_id')::uuid, gen_random_uuid()),
    h.hole_id,
    (f ->> 'kind')::feature_kind,
    coalesce((f ->> 'penalty')::feature_penalty, 'none'),
    public.course_geog(f -> 'polygon'),
    public.course_geog(f -> 'point'),
    (f ->> 'tree_radius_m')::numeric,
    (f ->> 'tree_height_m')::numeric,
    nullif(f ->> 'notes', '')
  from jsonb_array_elements(coalesce(p_doc -> 'features', '[]'::jsonb)) f
  join public.holes h on h.hole_id = (f ->> 'hole_id')::uuid and h.course_id = p_course_id and h.version = 0;
  get diagnostics written = row_count;
  if written <> expected then
    raise exception 'features reference unknown holes (% of % written)', written, expected using errcode = '23503';
  end if;

  expected := jsonb_array_length(coalesce(p_doc -> 'tee_markers', '[]'::jsonb));
  insert into public.tee_markers (tee_id, tee_set_id, hole_id, marker_point, stroke_index, yardage_m)
  select
    coalesce((m ->> 'tee_id')::uuid, gen_random_uuid()),
    t.tee_set_id,
    h.hole_id,
    public.course_geog(m -> 'marker_point'),
    (m ->> 'stroke_index')::integer,
    coalesce(
      (m ->> 'yardage_m')::numeric,
      round(st_distance(public.course_geog(m -> 'marker_point'), h.green_centre)::numeric, 1)
    )
  from jsonb_array_elements(coalesce(p_doc -> 'tee_markers', '[]'::jsonb)) m
  join public.tee_sets t on t.tee_set_id = (m ->> 'tee_set_id')::uuid and t.course_id = p_course_id and t.version = 0
  join public.holes h on h.hole_id = (m ->> 'hole_id')::uuid and h.course_id = p_course_id and h.version = 0;
  get diagnostics written = row_count;
  if written <> expected then
    raise exception 'tee markers reference unknown holes or tee sets (% of % written)', written, expected
      using errcode = '23503';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- course_publish: snapshot the draft into the next version and make it current.
-- ---------------------------------------------------------------------------
create or replace function public.course_publish(p_course_id uuid, p_change_reason text default null)
returns integer language plpgsql set search_path = public, extensions as $$
declare
  next_version integer;
begin
  perform public.course_assert_writer(p_course_id);
  -- Serialise concurrent publishes of the same course.
  perform 1 from public.courses where course_id = p_course_id for update;

  if not exists (select 1 from public.holes where course_id = p_course_id and version = 0) then
    raise exception 'cannot publish: the draft has no holes' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tee_sets where course_id = p_course_id and version = 0) then
    raise exception 'cannot publish: the draft has no tee sets' using errcode = '22023';
  end if;

  select greatest(coalesce(max(v.version), 0), c.current_version) + 1 into next_version
  from public.courses c
  left join public.course_versions v on v.course_id = c.course_id
  where c.course_id = p_course_id
  group by c.current_version;

  insert into public.course_versions (course_id, version, change_reason, created_by_user_id)
  values (p_course_id, next_version, nullif(trim(p_change_reason), ''), auth.uid());
  perform public.course_copy_version(p_course_id, 0, next_version);

  update public.courses
  set current_version = next_version, status = 'published'
  where course_id = p_course_id;
  return next_version;
end $$;
