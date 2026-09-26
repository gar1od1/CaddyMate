# CLAUDE.md — CaddyMate standing instructions

Standing instructions for Claude and any other AI coding assistant (or human) working in this
repo. Read this file in full, then `docs/SPEC.md` (section numbers below refer to it), before
changing anything. Where this file and a nested file (e.g. `apps/mobile/AGENTS.md`) disagree,
this file wins.

---

## 1. Naming

| Context                                         | Use                                               |
| ----------------------------------------------- | ------------------------------------------------- |
| Product / display name (UI, docs, store copy)   | **CaddyMate** (one word, capital C and M)         |
| npm package scope                               | `@caddymate/*` (`engine`, `db`, `api`, `ui`, ...) |
| Expo slug / URL scheme / bundle id              | `caddymate` / `caddymate://` / `ie.caddymate.app` |
| Supabase projects                               | `caddymate-prod` (prod); local CLI `caddymate`    |
| Engine / schema version constants, SQL, columns | `snake_case` in SQL, `camelCase` in TS            |

- **Never hard-code the repository URL** in tracked files. Read it with `git remote get-url origin`
  when you need it.
- Don't invent new product names, abbreviations or package scopes.

## 2. Orientation

- **Map:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the apps, packages, Edge Functions,
  local store and database fit together, as built.
- **What to build:** [`docs/SPEC.md`](docs/SPEC.md). Do not modify it; deviations go in an ADR (§9).
- **Why it is the way it is:** [`docs/decisions/`](docs/decisions/README.md).

```
apps/mobile      Expo SDK 57 + expo-router (routes in src/app)     @caddymate/mobile
apps/web         Next.js 16 App Router                             @caddymate/web
apps/watch       Garmin Connect IQ (Monkey C, not pnpm)
packages/engine  pure TS golf maths — no React/RN/IO               @caddymate/engine
packages/db      migrations, generated types, RLS smoke test       @caddymate/db
packages/api     typed data-access layer over supabase-js          @caddymate/api
packages/ui      design tokens                                     @caddymate/ui
supabase/functions  Deno Edge Functions (+ vendored engine copy)
```

pnpm workspaces + Turborepo, hoisted `node_modules` (`.npmrc`). Node 22, pnpm 10.

## 3. Standards — read the one for your task first

| When the task is...                                                                    | Read first                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Any task: planning, asking, verifying, recording deviations, PR hygiene                | [`docs/standards/working-rules.md`](docs/standards/working-rules.md) |
| Getting oriented, or touching more than one package                                    | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                       |
| A web page, component, form, table, chart or layout                                    | [`docs/standards/web-ui.md`](docs/standards/web-ui.md)               |
| A table, RLS policy, RPC, Storage bucket, Edge Function auth, or anything service-role | [`docs/standards/permissions.md`](docs/standards/permissions.md)     |
| Engine maths (conditions, dispersion, strategy, scoring, terrain)                      | SPEC §4, §7–§10 and ADRs 002–004                                     |
| Local store / sync / pattern refit                                                     | SPEC §16 "Sync", ADR 005, `apps/mobile/src/data/sync.ts`             |
| Watch                                                                                  | SPEC §11, ADR 001, `apps/watch/README.md`                            |
| Edge Functions                                                                         | [`supabase/functions/README.md`](supabase/functions/README.md)       |

Apply this unprompted: a change that adds a table reads the permissions standard before writing the
migration.

## 4. Domain rules (non-negotiable)

- **Units:** SI inside the engine and DB (metres, m/s, °C, hPa). Yards/feet only at the UI edge via
  the `@caddymate/engine` unit helpers. Never store or pass yards between layers.
- **Club frame (§4):** `+along` down the intended line, `+lateral` to the player's **RIGHT**.
- **Engine purity:** `packages/engine` has zero React/RN/Node/network deps, no global state, and
  takes the player profile as an argument (§3.4). Coverage thresholds are 100 %
  (`packages/engine/vitest.config.ts`); use fast-check property tests for maths invariants.
- **Versioned derived data:** every derived row carries its engine/model version
  (`engine_version`, `condition_model_version`, §7.6). Changing a model's output means bumping its
  `*_VERSION` constant and saying so in an ADR.
- **One engine everywhere:** mobile, web and Edge Functions run the same engine code. After any
  engine change run `pnpm vendor:engine`; after changing an `@caddymate/api` function that
  `supabase/functions/_shared/` mirrors, change the api first, then the mirror (parity tests
  enforce both).
- **Secrets:** no service-role key in any client. Third-party keys live in Edge Function secrets
  (§16). `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` values are public by definition.
- **A shot is never lost:** mobile writes go to SQLite first and are pushed by the sync queue;
  pushes are idempotent (§16, ARCHITECTURE §8).

## 5. Config and boot validation

- Each app reads env vars in **one module**: `apps/mobile/src/lib/env.ts`, `apps/web/src/lib/env.ts`
  (plus `src/proxy.ts`, which must not throw), `supabase/functions/_shared/auth.ts` (`Deno.env`).
  Don't read `process.env` anywhere else.
- A new variable is added to that module **and** to the app's `.env.example` (or the Edge Function
  env table in `supabase/functions/README.md`) in the same change.
- **Mobile must not throw at import** — CI's `expo export` runs without a `.env`. Missing config is
  reported through `envProblem`, which the root layout renders instead of the app.
- **Web fails fast** — `lib/env.ts` throws a message naming the missing variable and the file to copy.
- Modules that touch native code (SQLite, location) open lazily so importing them is side-effect
  free (keeps `expo export` and vitest import-safe).

## 6. Environment gotchas

- **No network docs access:** docs.expo.dev, supabase.com, maplibre.org are blocked. Read the
  installed package's `.d.ts` / README in `node_modules` instead of guessing APIs. (This overrides
  the "fetch the docs" advice in `apps/mobile/AGENTS.md`.)
- `npx expo install` cannot reach Expo's API — pin versions from
  `node_modules/expo/bundledNativeModules.json` and use `pnpm add`.
- **MapLibre RN v11 API:** `Map`, `Camera` (`initialViewState`, `center`), `GeoJSONSource`,
  `Layer type="fill|line|circle|symbol"`, `UserLocation`, `Marker`. See
  `node_modules/@maplibre/maplibre-react-native/lib/typescript/module/index.d.ts`.
- **Supabase clients:** mobile `apps/mobile/src/lib/supabase.ts`; web
  `apps/web/src/lib/supabase/{client,server}.ts`. Type them with `Database` from `@caddymate/db`.
  Shared queries go in `@caddymate/api` (functions take a `Db` client), not in app code.
- Web runs on **webpack**, not Turbopack (workspace `.js` → `.ts` specifiers; see `next.config.ts`).
- Deno is not installed in every environment; if you can't run `deno task test`, say so.

## 7. Commands — all must pass before you finish

Run from the repo root:

```
CI=true pnpm install --no-frozen-lockfile   # only if you add deps
pnpm format          # prettier --write
pnpm typecheck && pnpm lint && pnpm test
PGHOST=/tmp PGPORT=55432 PGUSER=postgres packages/db/scripts/local-db.sh   # migrations + RLS test (local Postgres is running)
(cd apps/web && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x pnpm build)
(cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=x npx expo export --platform android --output-dir /tmp/expo-export)
```

Plus, when you touched `supabase/functions` or the engine: `pnpm vendor:engine`, then
`cd supabase/functions && deno task test && deno task check`.

CI (`.github/workflows/ci.yml`) runs `format:check`, `typecheck`, `lint`, `test`, `local-db.sh`
and the Deno `test` + `check` tasks only — the web build, the Expo export and `pnpm vendor:engine`
are **your** job. Never skip a check, never use `--no-verify`, fix the root cause rather than the
symptom.

## 8. Migrations and generated types

- New file `packages/db/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. **Never edit an applied one**;
  never reorder.
- Every new table: `enable row level security` + policies in the same migration, and a case in
  `packages/db/tests/rls_smoke.sql` (see the permissions standard).
- After `local-db.sh`, regenerate types: `pnpm --filter @caddymate/db db:types`. Never hand-edit
  `packages/db/src/database.types.ts`.
- If an Edge Function depends on the migration, say so in the PR; migrations and functions are
  deployed by hand today (ARCHITECTURE §13).

## 9. Decisions (ADRs)

- Any deviation from SPEC, any "Decision" row you change, any default the spec left open that you
  had to pick, and any model/version bump → a short ADR in `docs/decisions/NNN-<slug>.md` in the
  **same change**. Copy `docs/decisions/000-template.md`; number = highest existing + 1; add it to
  the index in `docs/decisions/README.md`.
- Existing ADRs are amended by a new ADR that supersedes them, not rewritten.
- Cite ADRs and SPEC sections in code comments where the choice isn't obvious (existing style:
  `docs/SPEC.md §8.8`, `decision 005`).

## 10. Working rules (short form — full text in `docs/standards/working-rules.md`)

1. **Clarify, then play back.** If the request has two materially different readings, ask — one
   question at a time — and restate the plan before building. If nobody can answer (subagent,
   unattended run), list assumptions up front and in the PR body, then proceed.
2. **Do it yourself.** Don't hand the user a mechanical step you have tools for (running checks,
   regenerating types, vendoring the engine). Ask only for judgement, secrets or approval of
   destructive actions.
3. **Stay in scope.** Touch only the paths you were assigned. Things noticed in passing go in your
   report (or a suggested task), not into this change.
4. **Verified means run.** Don't claim done until the commands in §7 that cover your change have
   passed in this session. Say plainly what you could not verify (device, Deno, prod).
5. **Match the surroundings:** comment density, naming, Prettier (100 cols, single quotes).

## 11. Git and PRs

- Do not commit unless told to; in orchestrated runs the orchestrator commits.
- Short-lived branches → PR → `main` (SPEC §3.3). Conventional Commits with a scope:
  `feat(engine): ...`, `fix(mobile): ...`, `docs: ...`, `chore: ...`.
- PR body follows `.github/pull_request_template.md`: summary, SPEC/ADR links, checks run, device
  verification, migration/types, assumptions.

## 12. Definition of done

- [ ] Behaviour matches the SPEC section (or an ADR records the deviation).
- [ ] Tests added/updated; engine coverage still 100 %.
- [ ] Every command in §7 relevant to the change passed locally; `pnpm format` run last.
- [ ] Migration added (not edited) with RLS + smoke-test case; types regenerated.
- [ ] `pnpm vendor:engine` run after engine changes; api mirrors updated after api changes.
- [ ] New env vars in the env module and `.env.example`.
- [ ] Docs touched in the same change: ADR index, `docs/ARCHITECTURE.md` if a package, route group,
      function or data flow changed, package README if its usage changed.
- [ ] Anything not verified (physical device, prod deploy, Connect IQ build) stated explicitly.
