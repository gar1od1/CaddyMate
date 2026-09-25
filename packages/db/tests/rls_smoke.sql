-- RLS smoke test. Run against a database that has the migration applied and a
-- stub auth schema (see scripts/local-db.sh). Fails loudly on any leak.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com');

-- Profiles were auto-created by the trigger.
do $$ begin
  if (select count(*) from public.profiles) <> 2 then
    raise exception 'expected 2 auto-created profiles';
  end if;
end $$;

-- Act as Alice.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

insert into public.clubs (user_id, name, kind, loft_deg, stock_total_m)
values (auth.uid(), '7i', 'iron', 30.5, 146.3);

do $$ begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'alice should see exactly her own profile';
  end if;
  if (select count(*) from public.clubs) <> 1 then
    raise exception 'alice should see her club';
  end if;
end $$;

-- Alice cannot write a club for Bob.
do $$ begin
  begin
    insert into public.clubs (user_id, name, kind)
    values ('00000000-0000-0000-0000-000000000002', 'driver', 'driver');
    raise exception 'alice inserted a club for bob';
  exception when insufficient_privilege or check_violation then
    null; -- expected: RLS with-check rejects it
  end;
end $$;

-- Alice creates a draft course; Bob must not see it.
insert into public.courses (name, slug, country, centroid, created_by_user_id)
values ('Moyvalley', 'moyvalley', 'IE', ST_GeogFromText('POINT(-6.9165 53.4245)'), auth.uid());

-- Act as Bob.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

do $$ begin
  if (select count(*) from public.clubs) <> 0 then
    raise exception 'bob can see alice''s clubs';
  end if;
  if (select count(*) from public.courses) <> 0 then
    raise exception 'bob can see alice''s draft course';
  end if;
end $$;

-- Publish as Alice, then Bob can read but not write.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
update public.courses set status = 'published' where slug = 'moyvalley';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

do $$ begin
  if (select count(*) from public.courses) <> 1 then
    raise exception 'bob cannot see the published course';
  end if;
  if (select count(*) from public.courses where status = 'published') <> 1 then
    raise exception 'published flag not visible';
  end if;
end $$;

do $$ declare n int; begin
  update public.courses set name = 'hacked' where slug = 'moyvalley';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'bob updated alice''s course'; end if;
end $$;

-- Recommendation immutability.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
insert into public.shots (user_id, source, recommendation) values (auth.uid(), 'manual', '{"v":1}');
do $$ begin
  begin
    update public.shots set recommendation = '{"v":2}' where user_id = auth.uid();
    raise exception 'recommendation was rewritten';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
end $$;

rollback;
select 'RLS smoke test passed' as result;
