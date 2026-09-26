## Summary

<!-- What changed and why, in a few lines. Scope: which apps/packages. -->

- SPEC: §
- ADR: <!-- docs/decisions/NNN-... (required if this deviates from SPEC, picks an open default or bumps a *_VERSION) — or "n/a" -->

## Checks run

<!-- Tick only what you actually ran on this branch. Explain any unticked box. -->

- [ ] `pnpm format` (then `pnpm format:check` clean)
- [ ] `pnpm typecheck && pnpm lint && pnpm test`
- [ ] Engine coverage still 100 % (if `packages/engine` changed)
- [ ] `packages/db/scripts/local-db.sh` — migrations apply from empty, RLS smoke test passes
- [ ] Web build: `(cd apps/web && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x pnpm build)`
- [ ] Mobile bundle: `(cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=x npx expo export --platform android --output-dir /tmp/expo-export)`
- [ ] Edge Functions: `pnpm vendor:engine`, then `cd supabase/functions && deno task test && deno task check`

## Database

- [ ] No schema change
- [ ] New migration `packages/db/migrations/<timestamp>_<name>.sql` (no applied migration edited)
- [ ] RLS enabled + policies for every new table, with a case in `packages/db/tests/rls_smoke.sql`
- [ ] Types regenerated: `pnpm --filter @caddymate/db db:types`
- [ ] Deploy note: migration / Edge Functions must be applied to prod by hand (list them)

## Device / manual verification

<!-- Mobile: dev build on a physical phone? Which flow (start round, hit, ball here, sync, review)?
     Web: pages opened in `next dev`? Watch: Connect IQ build?
     If not done, say "Not verified on device" and why. -->

## Assumptions and follow-ups

<!-- Assumptions made without an answer; anything out of scope you noticed but did not change. -->

## Definition of done

- [ ] Behaviour matches the SPEC section, or an ADR records the deviation (and is in the ADR index)
- [ ] Tests added/updated for new logic
- [ ] New env vars in the app's env module and `.env.example`
- [ ] `docs/ARCHITECTURE.md` / package README updated if structure, data flow or usage changed
- [ ] No secrets, `.env` files, service-role keys in clients, or hard-coded repo URLs
