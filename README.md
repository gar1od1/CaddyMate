# CaddyMate

Shot-dispersion and DECADE-style course-strategy app. Android + iOS (Expo),
web (Next.js), Garmin Connect IQ watch companion, Supabase backend, and a
shared pure-TypeScript golf engine.

The product and technical specification lives in [`docs/SPEC.md`](docs/SPEC.md).
Architecture decisions that change the spec go in `docs/decisions/`.

## Layout

```
apps/mobile      Expo app (Android + iOS)
apps/web         Next.js: sim import, course editor, review dashboard
apps/watch       Garmin Connect IQ app (Monkey C) — Phase D
packages/engine  pure-TS golf maths: geo, conditions, dispersion, strategy, scoring
packages/db      Supabase migrations, generated types, RLS, seeds
packages/api     typed data-access layer over supabase-js
packages/ui      shared design tokens
supabase/        Supabase project config + Edge Functions
```

## Getting started

```sh
corepack enable            # provides pnpm at the pinned version
pnpm install
pnpm test                  # engine unit + property tests
pnpm typecheck
```

Mobile and web apps each have a README with their own run instructions.
