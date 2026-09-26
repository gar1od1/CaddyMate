-- Roles and permissions (docs/standards/permissions.md; SPEC §3.4 "admin role
-- later for curation").
--
-- Model
--   * Ownership (user_id + RLS) stays the primary boundary. Roles only WIDEN it:
--     no existing policy is narrowed, so the default `player` role behaves
--     exactly as before this migration.
--   * profiles.role: player (default) | curator | admin. Changed by the service
--     role only (trigger below); there is no role-management UI yet.
--   * permission: the catalogue. permission_key = page_key || '.' || verb; the
--     first segment of page_key is the module key. The TypeScript catalogue in
--     packages/api/src/permissions.ts is the source of truth and
--     packages/db/tests/fixtures/permissions.json (generated from it) is checked
--     against these rows by tests/permissions.sql.
--   * role_permission: role × permission_key. admin is kept complete by a
--     trigger on permission inserts.
--   * role_effective_permission applies the page cascade: an action is in force
--     only while its page and every ancestor page's `<page>.view` key are held,
--     so switching a page off revokes everything beneath it.
--   * has_permission(key) answers for auth.uid(); my_permissions lists the
--     caller's role and effective keys for the clients (loadGrants).
--
-- Widening policies (the only RLS changes): holders of `courses.publish`
-- (curator, admin) may read and write any course. can_read_course /
-- can_write_course gain the key, which widens every child-table policy
-- (course_versions, holes, hole_features, tee_sets, tee_markers), the course
-- RPCs (course_assert_writer) and the elevation Storage read policy; the
-- courses table gets two extra permissive policies. Course deletion stays
-- owner-only. sg_baselines / weather_cache are unchanged: readable by every
-- signed-in user, written by the service role only.

-- ---------------------------------------------------------------------------
-- Roles on profiles
-- ---------------------------------------------------------------------------
create type app_role as enum ('player', 'curator', 'admin');
create type permission_verb as enum ('view', 'write', 'refit', 'publish');

alter table public.profiles add column role app_role not null default 'player';

-- A player must not be able to promote themselves through the owner policy on
-- profiles: role changes are for the service role / database owner only.
create or replace function public.protect_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.role <> 'player')
          or (tg_op = 'UPDATE' and new.role is distinct from old.role)) then
    raise exception 'profiles.role can only be changed by the service role' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_protect_role before insert or update on public.profiles
  for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.permission (
  permission_key text primary key
    check (permission_key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*){1,2}$'),
  module_key text generated always as (split_part(page_key, '.', 1)) stored,
  page_key text not null check (page_key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)?$'),
  verb permission_verb not null,
  description text not null,
  -- Every page has a view key: that key IS the page grant.
  page_view_key text generated always as (page_key || '.view') stored,
  check (permission_key = page_key || '.' || verb::text),
  foreign key (page_view_key) references public.permission (permission_key)
    deferrable initially deferred
);
create index permission_page_idx on public.permission (page_key);

create table public.role_permission (
  role app_role not null,
  permission_key text not null references public.permission (permission_key)
    on update cascade on delete cascade,
  primary key (role, permission_key)
);

-- The catalogue is not secret: signed-in users read it; only the service role writes.
alter table public.permission enable row level security;
alter table public.role_permission enable row level security;
create policy "permission: read" on public.permission for select to authenticated using (true);
create policy "role_permission: read" on public.role_permission
  for select to authenticated using (true);

-- The admin role holds every key, including ones added by later migrations.
create or replace function public.grant_new_permission_to_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.role_permission (role, permission_key)
  values ('admin', new.permission_key)
  on conflict do nothing;
  return new;
end $$;
create trigger permission_grant_admin after insert on public.permission
  for each row execute function public.grant_new_permission_to_admin();

-- Seed: one row per key with the roles that hold it by default (admin is added
-- by the trigger). Keep in step with PERMISSIONS in packages/api/src/permissions.ts.
with seed (permission_key, page_key, verb, description, roles) as (
  values
    ('dashboard.view', 'dashboard', 'view',
      'Open the dashboard', '{player,curator}'),
    ('rounds.view', 'rounds', 'view',
      'Open the rounds section and the play screens (start, play, scorecard, summary)', '{player,curator}'),
    ('rounds.write', 'rounds', 'write',
      'Finalise a round on the server (finalise-round)', '{player,curator}'),
    ('rounds.review.view', 'rounds.review', 'view',
      'Open round review (replay, decisions, strokes gained)', '{player,curator}'),
    ('rounds.trends.view', 'rounds.trends', 'view',
      'Open trends (rolling SG, course view, WHS ledger)', '{player,curator}'),
    ('clubs.view', 'clubs', 'view',
      'Open the bag and club dispersion pages', '{player,curator}'),
    ('clubs.refit', 'clubs', 'refit',
      'Run the authoritative pattern refit (refit)', '{player,curator}'),
    ('courses.view', 'courses', 'view',
      'Open the course list, course pages and the editor for own courses', '{player,curator}'),
    ('courses.publish', 'courses', 'publish',
      'Read, edit and publish any user''s course (curation)', '{curator}'),
    ('import.view', 'import', 'view',
      'Open simulator import', '{player,curator}'),
    ('import.write', 'import', 'write',
      'Import a simulator session (import-sim)', '{player,curator}')
),
ins as (
  insert into public.permission (permission_key, page_key, verb, description)
  select permission_key, page_key, verb::permission_verb, description from seed
  on conflict (permission_key) do update
    set page_key = excluded.page_key, verb = excluded.verb, description = excluded.description
  returning permission_key
)
insert into public.role_permission (role, permission_key)
select r::app_role, s.permission_key
from seed s cross join lateral unnest(s.roles::text[]) r
on conflict do nothing;

-- Effective grants per role: the page cascade. A key is in force when every
-- page on its chain (the page itself and each catalogued ancestor page) has
-- its view key granted to the role.
create view public.role_effective_permission with (security_invoker = true) as
select rp.role, rp.permission_key
from public.role_permission rp
join public.permission p on p.permission_key = rp.permission_key
where not exists (
  select 1
  from public.permission pg
  where pg.verb = 'view'
    and (p.page_key = pg.page_key or p.page_key like pg.page_key || '.%')
    and not exists (
      select 1 from public.role_permission held
      where held.role = rp.role and held.permission_key = pg.permission_key
    )
);

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles pr
    join public.role_effective_permission e on e.role = pr.role
    where pr.user_id = auth.uid() and e.permission_key = p_key
  );
$$;
grant execute on function public.has_permission(text) to authenticated;

-- The caller's role and effective keys (one row with a null key if none).
create view public.my_permissions with (security_invoker = true) as
select pr.role, e.permission_key
from public.profiles pr
left join public.role_effective_permission e on e.role = pr.role
where pr.user_id = auth.uid();

-- ---------------------------------------------------------------------------
-- Widening: curators and admins may read and write any course
-- ---------------------------------------------------------------------------
create or replace function public.can_read_course(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses c
    where c.course_id = cid
      and (c.status = 'published' or c.created_by_user_id = auth.uid()
           or public.has_permission('courses.publish'))
  );
$$;
create or replace function public.can_write_course(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses c
    where c.course_id = cid
      and (c.created_by_user_id = auth.uid() or public.has_permission('courses.publish'))
  );
$$;

create policy "courses: read (curator)" on public.courses
  for select to authenticated using ((select public.has_permission('courses.publish')));
create policy "courses: update (curator)" on public.courses
  for update to authenticated
  using ((select public.has_permission('courses.publish')))
  with check ((select public.has_permission('courses.publish')));
