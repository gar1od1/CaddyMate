-- Security hardening from the Supabase advisor run after the v2 cutover of prod
-- (docs/standards/permissions.md §6 "deny on the server").
--
--   * Trigger functions get a fixed search_path (lint 0011).
--   * SECURITY DEFINER functions are not callable through PostgREST by anon
--     (lints 0028/0029). `authenticated` keeps EXECUTE on can_read_course /
--     can_write_course / has_permission because RLS policies and the course
--     RPCs evaluate them as the calling user; trigger functions need no EXECUTE
--     grant at all (Postgres checks it at trigger creation, not per row).

alter function public.set_updated_at() set search_path = public;
alter function public.protect_recommendation() set search_path = public;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.grant_new_permission_to_admin() from public, anon, authenticated;
revoke execute on function public.protect_profile_role() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.protect_recommendation() from public, anon, authenticated;

revoke execute on function public.can_read_course(uuid) from public, anon;
revoke execute on function public.can_write_course(uuid) from public, anon;
revoke execute on function public.has_permission(text) from public, anon;
