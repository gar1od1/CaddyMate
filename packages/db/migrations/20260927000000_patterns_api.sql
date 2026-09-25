-- Pattern writes from the app (docs/SPEC.md §8.8).
--
-- Patterns refit incrementally on the device after every shot and
-- authoritatively by an Edge Function after each round/import (the Edge
-- Function result wins by writing last). Until now only the service role could
-- write `club_patterns` / `club_condition_patterns`; `@caddymate/api`'s
-- `fitAndStoreClubPattern` runs with the player's JWT, so owners may now
-- insert, update and delete their own rows — for their own clubs only.

create policy "club_patterns: owner write" on public.club_patterns
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.clubs c where c.club_id = club_patterns.club_id and c.user_id = auth.uid())
  );
create policy "club_patterns: owner update" on public.club_patterns
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.clubs c where c.club_id = club_patterns.club_id and c.user_id = auth.uid())
  );
create policy "club_patterns: owner delete" on public.club_patterns
  for delete to authenticated using (user_id = auth.uid());

create policy "club_condition_patterns: owner write" on public.club_condition_patterns
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.clubs c
      where c.club_id = club_condition_patterns.club_id and c.user_id = auth.uid()
    )
  );
create policy "club_condition_patterns: owner update" on public.club_condition_patterns
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.clubs c
      where c.club_id = club_condition_patterns.club_id and c.user_id = auth.uid()
    )
  );
create policy "club_condition_patterns: owner delete" on public.club_condition_patterns
  for delete to authenticated using (user_id = auth.uid());
