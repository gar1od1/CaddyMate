#!/usr/bin/env bash
# Apply migrations + run the RLS smoke test against a plain Postgres+PostGIS
# (no Supabase CLI needed). Creates a throwaway database and a stub `auth`
# schema that mimics the parts of Supabase the policies rely on.
#
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres packages/db/scripts/local-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${CADDYMATE_TEST_DB:-caddymate_test}"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
SQL
psql -v ON_ERROR_STOP=1 -q -d postgres -c "alter database $DB set search_path = public, extensions"

for f in migrations/*.sql; do
  echo "applying $f"
  psql -v ON_ERROR_STOP=1 -q --single-transaction -d "$DB" -f "$f"
done

# Supabase grants these to `authenticated` by default; mimic that here.
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
grant usage on schema public, auth, extensions to authenticated, anon;
grant all on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to authenticated, anon;
grant select on auth.users to authenticated;
SQL

for t in tests/*.sql; do
  echo "running $t"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$t"
done
