-- Roles and permissions test (docs/standards/permissions.md §6). Run by
-- scripts/local-db.sh from packages/db, after all migrations.
--
--   1. Seeded means enforced / catalogue parity: the permission rows and the
--      default role grants equal tests/fixtures/permissions.json, which the
--      @caddymate/api vitest proves equal to the TypeScript catalogue.
--   2. Admin is complete; every page has a view key; keys are page.verb.
--   3. A curator can edit and publish another user's course; a player cannot.
--   4. Switching a page off revokes every action (and sub-page) beneath it.
--   5. Nobody can promote themselves or edit the catalogue.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\set catalogue `cat tests/fixtures/permissions.json`
begin;

create temp table catalogue as select :'catalogue'::jsonb as doc;

-- ---------------------------------------------------------------------------
-- 1–2. Catalogue parity and shape (as the database owner)
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
  extra text;
begin
  select string_agg(x ->> 'permission_key', ', ') into missing
  from catalogue, jsonb_array_elements(doc -> 'permissions') x
  where not exists (
    select 1 from public.permission p
    where p.permission_key = x ->> 'permission_key'
      and p.module_key = x ->> 'module_key'
      and p.page_key = x ->> 'page_key'
      and p.verb::text = x ->> 'verb'
      and p.description = x ->> 'description'
  );
  if missing is not null then
    raise exception 'TypeScript catalogue keys missing or different in permission: %', missing;
  end if;

  select string_agg(p.permission_key, ', ') into extra
  from public.permission p
  where not exists (
    select 1 from catalogue, jsonb_array_elements(doc -> 'permissions') x
    where x ->> 'permission_key' = p.permission_key
  );
  if extra is not null then
    raise exception 'permission rows not in the TypeScript catalogue (seeded but unchecked): %', extra;
  end if;

  -- Default grants per role, both directions.
  select string_agg(r.key || ' ' || g.k, ', ') into missing
  from catalogue, jsonb_each(doc -> 'role_permissions') r, jsonb_array_elements_text(r.value) g(k)
  where not exists (
    select 1 from public.role_permission rp where rp.role::text = r.key and rp.permission_key = g.k
  );
  select string_agg(rp.role || ' ' || rp.permission_key, ', ') into extra
  from public.role_permission rp
  where not exists (
    select 1 from catalogue, jsonb_array_elements_text(doc -> 'role_permissions' -> rp.role::text) g(k)
    where g.k = rp.permission_key
  );
  if missing is not null or extra is not null then
    raise exception 'role grants differ from the catalogue: missing [%] extra [%]', missing, extra;
  end if;

  if exists (
    select 1 from public.permission p
    where not exists (
      select 1 from public.role_effective_permission e
      where e.role = 'admin' and e.permission_key = p.permission_key
    )
  ) then
    raise exception 'admin does not hold every key';
  end if;

  if exists (
    select 1 from public.permission p
    where p.permission_key <> p.page_key || '.' || p.verb
       or not exists (select 1 from public.permission v where v.permission_key = p.page_key || '.view')
  ) then
    raise exception 'a key is not <page>.<verb> or its page has no view key';
  end if;

  -- Every sub-page's parent page exists.
  if exists (
    select 1 from public.permission p
    where p.page_key like '%.%'
      and not exists (
        select 1 from public.permission v
        where v.permission_key = split_part(p.page_key, '.', 1) || '.view'
      )
  ) then
    raise exception 'a sub-page has no parent page';
  end if;
end $$;

-- A key added by a later migration reaches admin automatically.
insert into public.permission (permission_key, page_key, verb, description)
values ('courses.write', 'courses', 'write', 'test-only key');
do $$ begin
  if not exists (
    select 1 from public.role_permission where role = 'admin' and permission_key = 'courses.write'
  ) then
    raise exception 'new permission was not granted to admin';
  end if;
end $$;
delete from public.permission where permission_key = 'courses.write';

-- ---------------------------------------------------------------------------
-- 3. Widening: curator vs player on someone else's course
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'player@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'curator@example.com');
update public.profiles set role = 'curator'
where user_id = '00000000-0000-0000-0000-00000000000c';

do $$ begin
  if (select count(*) from public.profiles
      where user_id::text like '00000000-0000-0000-0000-00000000000_' and role = 'player') <> 2 then
    raise exception 'new profiles should default to player';
  end if;
end $$;

set local role authenticated;

-- The owner builds a draft course with one hole and one tee set.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
create temp table ids as
select public.course_create('Owner GC', 'IE', -6.9, 53.4) as course_id;
select public.course_save_draft(
  (select course_id from ids),
  '{"holes":[{"hole_id":"10000000-0000-4000-8000-000000000001","hole_number":1,"par":4,
     "green_centre":{"type":"Point","coordinates":[-6.899,53.401]}}],
    "tee_sets":[{"tee_set_id":"20000000-0000-4000-8000-000000000001","name":"White"}],
    "tee_markers":[{"tee_set_id":"20000000-0000-4000-8000-000000000001",
      "hole_id":"10000000-0000-4000-8000-000000000001",
      "marker_point":{"type":"Point","coordinates":[-6.9,53.4]}}]}'::jsonb
);

-- The player: no key, no draft, no write.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare n int;
begin
  if public.has_permission('courses.publish') then
    raise exception 'player holds courses.publish';
  end if;
  if not public.has_permission('clubs.refit') or not public.has_permission('import.write') then
    raise exception 'player lost a default key';
  end if;
  if (select count(*) from public.courses where name = 'Owner GC') <> 0 then
    raise exception 'player can see another user''s draft';
  end if;
  update public.courses set name = 'hacked' where name = 'Owner GC';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'player updated another user''s course'; end if;
  begin
    perform public.course_publish((select course_id from ids), 'nope');
    raise exception 'player published another user''s course';
  exception when insufficient_privilege then
    null; -- expected
  end;
  if (select role from public.my_permissions limit 1) <> 'player'
     or (select count(*) from public.my_permissions) <> 10 then
    raise exception 'my_permissions wrong for a player';
  end if;
end $$;

-- The curator: sees the draft, edits it and publishes it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare n int;
begin
  if not public.has_permission('courses.publish') then
    raise exception 'curator lacks courses.publish';
  end if;
  if (select count(*) from public.courses where name = 'Owner GC') <> 1 then
    raise exception 'curator cannot see the draft';
  end if;
  if (select count(*) from public.holes where course_id = (select course_id from ids)) <> 1 then
    raise exception 'curator cannot see draft holes';
  end if;
  update public.courses set name = 'Owner Golf Club' where course_id = (select course_id from ids);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'curator could not update the course'; end if;
  update public.hole_features set notes = notes; -- no rows, but must not error
  update public.tee_markers set stroke_index = 7
  where tee_set_id = '20000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'curator could not update a tee marker'; end if;
  if public.course_publish((select course_id from ids), 'curated') <> 1 then
    raise exception 'curator publish did not create version 1';
  end if;
  if not ((public.course_get((select course_id from ids)) -> 'course' ->> 'can_write')::boolean) then
    raise exception 'course_get should report can_write for a curator';
  end if;
  -- Deletion is not widened.
  delete from public.courses where course_id = (select course_id from ids);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'curator deleted another user''s course'; end if;
end $$;

-- The published course is now readable by the player (ownership rules, unchanged).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$ begin
  if (select name from public.courses where course_id = (select course_id from ids)) <> 'Owner Golf Club' then
    raise exception 'published course not visible to the player';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. No self-promotion, no catalogue edits
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    update public.profiles set role = 'admin' where user_id = auth.uid();
    raise exception 'player promoted themselves';
  exception when insufficient_privilege then
    null; -- expected: protect_profile_role
  end;
  begin
    insert into public.role_permission (role, permission_key) values ('player', 'courses.publish');
    raise exception 'player granted a key';
  exception when insufficient_privilege then
    null; -- expected: RLS has no write policy
  end;
end $$;
do $$ declare n int; begin
  delete from public.role_permission where role = 'player';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'player revoked grants'; end if;
  update public.permission set description = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'player edited the catalogue'; end if;
end $$;

-- Signed out: nothing.
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if public.has_permission('dashboard.view') or exists (select 1 from public.my_permissions) then
    raise exception 'anonymous caller holds a key';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Page cascade (as the database owner, then observed as the player)
-- ---------------------------------------------------------------------------
reset role;
delete from public.role_permission where role = 'player' and permission_key in ('clubs.view', 'rounds.view');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$ begin
  if public.has_permission('clubs.refit') then
    raise exception 'clubs page off but clubs.refit still in force';
  end if;
  if public.has_permission('rounds.trends.view') or public.has_permission('rounds.review.view')
     or public.has_permission('rounds.write') then
    raise exception 'rounds page off but its sub-pages or actions still in force';
  end if;
  if exists (select 1 from public.my_permissions where permission_key in ('clubs.refit', 'rounds.trends.view')) then
    raise exception 'my_permissions ignores the page cascade';
  end if;
  if not public.has_permission('import.write') then
    raise exception 'cascade revoked an unrelated key';
  end if;
end $$;

rollback;
select 'Permissions test passed' as result;
