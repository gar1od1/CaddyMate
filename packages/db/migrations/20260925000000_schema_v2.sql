-- CaddyMate v2 — initial schema (docs/SPEC.md §6).
--
-- Conventions
--   * All geometry is geography(…, 4326); distances in metres.
--   * Every user-owned table carries user_id and is RLS owner-only.
--   * Courses are readable by all authenticated users, writable by their creator.
--   * Derived columns (neutral_*, sg, grades) are written by the engine only
--     (Edge Functions with the service role); clients get them via RLS reads.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (mirror packages/engine/src/types)
-- ---------------------------------------------------------------------------
create type handedness as enum ('R', 'L');
create type plan as enum ('free', 'pro');
create type club_kind as enum ('driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter');
create type lie as enum (
  'tee', 'fairway', 'first_cut', 'rough', 'deep_rough', 'sand', 'hardpan', 'pine_straw', 'green'
);
create type slope_strength as enum ('none', 'mild', 'severe');
create type strike as enum ('good', 'fat', 'thin', 'toe', 'heel', 'top', 'shank');
create type shape as enum ('straight', 'draw', 'fade');
create type shot_source as enum ('course', 'sim', 'manual');
create type penalty as enum ('none', 'lateral', 'yellow', 'ob', 'unplayable');
create type feature_kind as enum (
  'fairway', 'first_cut', 'rough', 'deep_rough', 'bunker', 'water', 'ob',
  'hardpan', 'pine_straw', 'tree', 'wooded', 'cart_path'
);
create type feature_penalty as enum ('none', 'lateral', 'yellow', 'ob');
create type course_source as enum ('osm', 'editor', 'igolf');
create type course_status as enum ('draft', 'published');
create type round_status as enum ('live', 'complete', 'abandoned');
create type sg_category as enum ('ott', 'app', 'arg', 'putt');
create type grade as enum ('good', 'poor');
create type pattern_confidence as enum ('seeded', 'forming', 'established');
create type sim_source as enum ('gspro', 'square');
create type device_kind as enum ('garmin_ciq');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity and equipment
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  handedness handedness not null default 'R',
  units text not null default 'yd' check (units in ('yd', 'm')),
  handicap_index_official numeric(4, 1),
  default_shape shape not null default 'straight',
  plan plan not null default 'free',
  home_course_id uuid,
  recency_half_life_days integer not null default 180 check (recency_half_life_days > 0),
  condition_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.clubs (
  club_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  name text not null,
  kind club_kind not null,
  loft_deg numeric(4, 1),
  bag_order integer not null default 0,
  active boolean not null default true,
  stock_total_m numeric(6, 1),
  stock_carry_m numeric(6, 1),
  sim_name_aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index clubs_user_idx on public.clubs (user_id, bag_order);
create trigger clubs_updated_at before update on public.clubs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Course model
-- ---------------------------------------------------------------------------
create table public.courses (
  course_id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country char(2) not null,
  centroid geography(point, 4326) not null,
  boundary_polygon geography(polygon, 4326),
  source course_source not null default 'editor',
  osm_relation_id text,
  status course_status not null default 'draft',
  current_version integer not null default 1,
  created_by_user_id uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_centroid_idx on public.courses using gist (centroid);
create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();

alter table public.profiles
  add constraint profiles_home_course_fk
  foreign key (home_course_id) references public.courses (course_id) on delete set null;

create table public.course_versions (
  course_id uuid not null references public.courses (course_id) on delete cascade,
  version integer not null,
  change_reason text,
  created_by_user_id uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, version)
);

create table public.holes (
  hole_id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  version integer not null,
  hole_number integer not null check (hole_number between 1 and 36),
  par integer not null check (par between 3 and 6),
  line_of_play geography(linestring, 4326),
  green_polygon geography(polygon, 4326),
  green_centre geography(point, 4326),
  created_at timestamptz not null default now(),
  foreign key (course_id, version) references public.course_versions (course_id, version) on delete cascade,
  unique (course_id, version, hole_number)
);

create table public.hole_features (
  feature_id uuid primary key default gen_random_uuid(),
  hole_id uuid not null references public.holes (hole_id) on delete cascade,
  kind feature_kind not null,
  penalty feature_penalty not null default 'none',
  polygon geography(polygon, 4326),
  point geography(point, 4326),
  tree_radius_m numeric(5, 1),
  tree_height_m numeric(5, 1),
  notes text,
  check (
    (kind = 'tree' and point is not null) or (kind <> 'tree' and polygon is not null)
  )
);
create index hole_features_hole_idx on public.hole_features (hole_id, kind);
create index hole_features_polygon_idx on public.hole_features using gist (polygon);

create table public.tee_sets (
  tee_set_id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  version integer not null,
  name text not null,
  colour_hex char(7),
  course_rating numeric(4, 1),
  slope_rating integer check (slope_rating between 55 and 155),
  bogey_rating numeric(4, 1),
  par integer,
  foreign key (course_id, version) references public.course_versions (course_id, version) on delete cascade,
  unique (course_id, version, name)
);

create table public.tee_markers (
  tee_id uuid primary key default gen_random_uuid(),
  tee_set_id uuid not null references public.tee_sets (tee_set_id) on delete cascade,
  hole_id uuid not null references public.holes (hole_id) on delete cascade,
  marker_point geography(point, 4326) not null,
  stroke_index integer check (stroke_index between 1 and 18),
  yardage_m numeric(6, 1),
  unique (tee_set_id, hole_id)
);

create table public.elevation_grids (
  course_id uuid not null,
  version integer not null,
  bbox jsonb not null,           -- { minLat, minLng, maxLat, maxLng }
  resolution_m numeric(5, 2) not null,
  storage_path text not null,    -- Float32 raster in Supabase Storage
  min_m numeric(7, 2),
  max_m numeric(7, 2),
  created_at timestamptz not null default now(),
  primary key (course_id, version),
  foreign key (course_id, version) references public.course_versions (course_id, version) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Rounds and shots
-- ---------------------------------------------------------------------------
create table public.rounds (
  round_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  course_id uuid not null references public.courses (course_id),
  course_version integer not null,
  tee_set_id uuid not null references public.tee_sets (tee_set_id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status round_status not null default 'live',
  weather_snapshot jsonb,
  pin_overrides jsonb not null default '{}'::jsonb,   -- { "<hole_number>": {lat,lng} }
  handicap_index_used numeric(4, 1),
  course_handicap integer,
  playing_handicap integer,
  gross integer,
  adjusted_gross integer,
  stableford integer,
  differential numeric(5, 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (course_id, course_version) references public.course_versions (course_id, version)
);
create index rounds_user_idx on public.rounds (user_id, started_at desc);
create trigger rounds_updated_at before update on public.rounds
  for each row execute function public.set_updated_at();

create table public.hole_scores (
  round_id uuid not null references public.rounds (round_id) on delete cascade,
  hole_number integer not null,
  strokes_logged integer not null default 0,
  strokes_override integer,
  override_reason text,
  putts integer not null default 0,
  penalties integer not null default 0,
  points integer,
  net_strokes integer,
  primary key (round_id, hole_number)
);

create table public.sim_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  imported_at timestamptz not null default now(),
  source sim_source not null,
  file_hash text not null,
  row_count integer not null default 0,
  ball_type text,
  notes text,
  raw_payload jsonb,
  unique (user_id, file_hash)
);

create table public.shots (
  shot_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  round_id uuid references public.rounds (round_id) on delete cascade,
  hole_number integer,
  seq integer,
  source shot_source not null default 'course',
  club_id uuid references public.clubs (club_id) on delete set null,
  played_at timestamptz not null default now(),
  -- geometry (course shots)
  start_position geography(point, 4326),
  start_accuracy_m numeric(5, 1),
  end_position geography(point, 4326),
  end_accuracy_m numeric(5, 1),
  holed boolean not null default false,
  reconstructed boolean not null default false,
  -- intent
  target_point geography(point, 4326),
  target_bearing_deg numeric(6, 2),
  target_ref jsonb,                 -- feature-relative definition
  intended_shape shape,
  -- inputs
  lie lie,
  slope_up slope_strength not null default 'none',
  slope_down slope_strength not null default 'none',
  slope_above slope_strength not null default 'none',
  slope_below slope_strength not null default 'none',
  slope_suggested jsonb,
  strike strike not null default 'good',
  penalty penalty not null default 'none',
  stroke_count integer not null default 1 check (stroke_count between 0 and 3),
  -- conditions snapshot (SI)
  conditions jsonb,
  -- putting
  putt_distance_m numeric(5, 2),
  putt_remaining_m numeric(5, 2),
  -- derived (engine-owned)
  observed_distance_m numeric(6, 2),
  observed_lateral_m numeric(6, 2),
  neutral_distance_m numeric(6, 2),
  neutral_lateral_m numeric(6, 2),
  condition_model_version integer,
  result_surface lie,
  distance_to_pin_before_m numeric(6, 2),
  distance_to_pin_after_m numeric(6, 2),
  -- sim
  sim_session_id uuid references public.sim_sessions (session_id) on delete cascade,
  sim_carry_m numeric(6, 2),
  sim_total_m numeric(6, 2),
  sim_offline_m numeric(6, 2),
  -- strategy snapshot (immutable once written)
  recommendation jsonb,
  -- grades (engine-owned)
  sg numeric(5, 3),
  sg_category sg_category,
  strategy_loss numeric(5, 3),
  execution_loss numeric(5, 3),
  decision_grade grade,
  execution_grade grade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'course' or (round_id is not null and hole_number is not null and seq is not null)),
  check (source <> 'sim' or sim_session_id is not null)
);
create unique index shots_round_seq_idx on public.shots (round_id, hole_number, seq) where round_id is not null;
create index shots_user_club_idx on public.shots (user_id, club_id, played_at desc);
create index shots_sim_session_idx on public.shots (sim_session_id) where sim_session_id is not null;
create trigger shots_updated_at before update on public.shots
  for each row execute function public.set_updated_at();

-- The recommendation snapshot is what the player saw; never rewrite it.
create or replace function public.protect_recommendation()
returns trigger language plpgsql as $$
begin
  if old.recommendation is not null and new.recommendation is distinct from old.recommendation then
    raise exception 'shots.recommendation is immutable once set';
  end if;
  return new;
end $$;
create trigger shots_protect_recommendation before update on public.shots
  for each row execute function public.protect_recommendation();

-- ---------------------------------------------------------------------------
-- Patterns, baselines, caches, devices
-- ---------------------------------------------------------------------------
create table public.club_patterns (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  club_id uuid not null references public.clubs (club_id) on delete cascade,
  params jsonb not null,
  n_effective numeric(7, 2) not null default 0,
  n_raw integer not null default 0,
  confidence pattern_confidence not null default 'seeded',
  fitted_at timestamptz not null default now(),
  engine_version integer not null,
  primary key (user_id, club_id)
);

create table public.club_condition_patterns (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  club_id uuid not null references public.clubs (club_id) on delete cascade,
  bucket_key text not null,      -- lie|head_bin|cross_bin
  params jsonb not null,
  n_effective numeric(7, 2) not null default 0,
  fitted_at timestamptz not null default now(),
  engine_version integer not null,
  primary key (user_id, club_id, bucket_key)
);

create table public.sg_baselines (
  baseline_id text not null,     -- 'scratch' | 'hcp10' | 'hcp15' | 'hcp20' | 'self:<user_id>'
  category text not null,        -- tee | fairway | rough | sand | recovery | green
  distance_m numeric(6, 1) not null,
  expected_strokes numeric(5, 3) not null,
  primary key (baseline_id, category, distance_m)
);

create table public.weather_cache (
  lat_r numeric(6, 3) not null,
  lng_r numeric(6, 3) not null,
  hour timestamptz not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (lat_r, lng_r, hour)
);

create table public.devices (
  device_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind device_kind not null,
  watch_model text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.courses enable row level security;
alter table public.course_versions enable row level security;
alter table public.holes enable row level security;
alter table public.hole_features enable row level security;
alter table public.tee_sets enable row level security;
alter table public.tee_markers enable row level security;
alter table public.elevation_grids enable row level security;
alter table public.rounds enable row level security;
alter table public.hole_scores enable row level security;
alter table public.sim_sessions enable row level security;
alter table public.shots enable row level security;
alter table public.club_patterns enable row level security;
alter table public.club_condition_patterns enable row level security;
alter table public.sg_baselines enable row level security;
alter table public.weather_cache enable row level security;
alter table public.devices enable row level security;

-- Owner-only tables.
create policy "profiles: owner" on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clubs: owner" on public.clubs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "rounds: owner" on public.rounds
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "hole_scores: owner via round" on public.hole_scores
  for all to authenticated
  using (exists (select 1 from public.rounds r where r.round_id = hole_scores.round_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.rounds r where r.round_id = hole_scores.round_id and r.user_id = auth.uid()));
create policy "sim_sessions: owner" on public.sim_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "shots: owner" on public.shots
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "club_patterns: owner read" on public.club_patterns
  for select to authenticated using (user_id = auth.uid());
create policy "club_condition_patterns: owner read" on public.club_condition_patterns
  for select to authenticated using (user_id = auth.uid());
create policy "devices: owner" on public.devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Courses: everyone signed in can read published courses (and their own drafts);
-- only the creator can write. Child tables inherit via the course row.
create or replace function public.can_read_course(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses c
    where c.course_id = cid and (c.status = 'published' or c.created_by_user_id = auth.uid())
  );
$$;
create or replace function public.can_write_course(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses c where c.course_id = cid and c.created_by_user_id = auth.uid()
  );
$$;

create policy "courses: read" on public.courses
  for select to authenticated using (status = 'published' or created_by_user_id = auth.uid());
create policy "courses: insert own" on public.courses
  for insert to authenticated with check (created_by_user_id = auth.uid());
create policy "courses: update own" on public.courses
  for update to authenticated using (created_by_user_id = auth.uid()) with check (created_by_user_id = auth.uid());
create policy "courses: delete own" on public.courses
  for delete to authenticated using (created_by_user_id = auth.uid());

create policy "course_versions: read" on public.course_versions
  for select to authenticated using (public.can_read_course(course_id));
create policy "course_versions: write" on public.course_versions
  for all to authenticated using (public.can_write_course(course_id)) with check (public.can_write_course(course_id));

create policy "holes: read" on public.holes
  for select to authenticated using (public.can_read_course(course_id));
create policy "holes: write" on public.holes
  for all to authenticated using (public.can_write_course(course_id)) with check (public.can_write_course(course_id));

create policy "hole_features: read" on public.hole_features
  for select to authenticated
  using (exists (select 1 from public.holes h where h.hole_id = hole_features.hole_id and public.can_read_course(h.course_id)));
create policy "hole_features: write" on public.hole_features
  for all to authenticated
  using (exists (select 1 from public.holes h where h.hole_id = hole_features.hole_id and public.can_write_course(h.course_id)))
  with check (exists (select 1 from public.holes h where h.hole_id = hole_features.hole_id and public.can_write_course(h.course_id)));

create policy "tee_sets: read" on public.tee_sets
  for select to authenticated using (public.can_read_course(course_id));
create policy "tee_sets: write" on public.tee_sets
  for all to authenticated using (public.can_write_course(course_id)) with check (public.can_write_course(course_id));

create policy "tee_markers: read" on public.tee_markers
  for select to authenticated
  using (exists (select 1 from public.tee_sets t where t.tee_set_id = tee_markers.tee_set_id and public.can_read_course(t.course_id)));
create policy "tee_markers: write" on public.tee_markers
  for all to authenticated
  using (exists (select 1 from public.tee_sets t where t.tee_set_id = tee_markers.tee_set_id and public.can_write_course(t.course_id)))
  with check (exists (select 1 from public.tee_sets t where t.tee_set_id = tee_markers.tee_set_id and public.can_write_course(t.course_id)));

create policy "elevation_grids: read" on public.elevation_grids
  for select to authenticated using (public.can_read_course(course_id));

-- Reference data: read-only for everyone signed in; written by the service role.
create policy "sg_baselines: read" on public.sg_baselines for select to authenticated using (true);
create policy "weather_cache: read" on public.weather_cache for select to authenticated using (true);
