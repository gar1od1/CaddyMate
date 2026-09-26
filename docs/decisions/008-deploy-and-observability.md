# 008 — Deploy automation and observability

Status: Accepted (workflows and Sentry wiring unverified against live services: no secrets or DSN
exist yet)
Date: 2026-09-26
Scope: SPEC §3.1 (CI/CD row), §3.3 (environments), §16 (observability). Code:
`.github/workflows/{deploy,mobile-build}.yml`, `apps/web/vercel.json`,
`apps/web/src/{instrumentation,instrumentation-client}.ts`, `apps/web/src/lib/{env,sentry}.ts`,
`apps/web/src/app/global-error.tsx`, `apps/web/next.config.ts`,
`apps/mobile/src/lib/{env,sentry}.ts`, `apps/mobile/src/app/_layout.tsx`,
`apps/mobile/{app.json,eas.json}`, `supabase/functions/_shared/{sentry,http}.ts`.

## Context

SPEC §3.3 says `main` deploys web to Vercel and applies migrations to prod via CI, and mobile
builds are cut from tags; §16 asks for Sentry on mobile and web. None of it was automated. The
SPEC leaves open how migrations reach prod (they live in `packages/db`, not `supabase/`), how to
keep all of this inert until accounts and secrets exist, and what Edge Functions report. Prod
(`mceverccxohligbwpdwd`) also still carries the v1 app's migration history (73 versions, none in
this repo), which `supabase db push` refuses to reconcile on its own.

## Decision

| Item                    | Value                                                                                                                                                                                                                       | Rationale                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Supabase deploy trigger | `deploy.yml` on `workflow_run` of CI (success, push to `main`) + manual                                                                                                                                                     | "`main` deploys" without letting a red commit reach prod                                               |
| Supabase deploy gate    | Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` **and** repo variable `SUPABASE_DEPLOY_ENABLED=true`; otherwise a notice and no-op                                                          | The v1 → v2 cutover of prod is a human decision; secrets alone must not trigger it                     |
| Migrations              | Copy `packages/db/migrations/*.sql` to `supabase/migrations/` in the job, `supabase link`, `db push --dry-run`, `db push --yes`                                                                                             | One source of migrations (CLAUDE.md §8); the dry run logs what will apply                              |
| Functions               | `supabase functions deploy weather elevation refit finalise-round import-sim` after migrations                                                                                                                              | Explicit list (skips `_shared`, `scripts`); CI's `vendor_test` already proves the engine copy is fresh |
| Web                     | Vercel Git integration; `apps/web/vercel.json` (Next.js, install at the workspace root, `pnpm run build`, `ignoreCommand` diffing `apps/web`, `packages`, root manifests)                                                   | Vercel already gives previews per PR (§3.1); `pnpm run build` avoids Turbo's strict env filtering      |
| Mobile                  | `mobile-build.yml` on tags `mobile-v*`: `eas build --platform android --profile preview --non-interactive --no-wait`, gated on `EXPO_TOKEN` and a non-empty EAS project id                                                  | "EAS Build on tag"; the id comes from `eas init`, never invented                                       |
| Sentry SDKs             | `@sentry/react-native` ~7.11.0 (Expo SDK 57's bundled pin) with the `@sentry/react-native/expo` plugin; `@sentry/nextjs` ^11                                                                                                | Official SDKs; versions from `bundledNativeModules.json` / Next 16 peer range                          |
| Sentry gating           | Init only when `EXPO_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is set; never throws                                                                                                                                     | CI, `expo export` and local dev run without an account (CLAUDE.md §5)                                  |
| Sentry data             | Errors only (`tracesSampleRate: 0`); user = id only (set on sign-in, cleared on sign-out); no cookies/headers/bodies/IP; tags `engine_version`, `strategy_engine_version`, `condition_model_version`, app version / runtime | Match derived-row versions (§7.6) without sending personal data                                        |
| Web env module          | `env` becomes getters (throw on first use); new `sentryConfig`, `nextRuntime` exports                                                                                                                                       | Sentry's edge-runtime init must import `lib/env.ts` without throwing beside the proxy                  |
| Edge Functions          | `_shared/sentry.ts`: dependency-free POST to the DSN's envelope endpoint when `SENTRY_DSN` is set; `serveJson` reports non-`HttpError`s and `HttpError`s ≥ 500, awaited with a 2 s cap                                      | No SDK in Deno bundles; 4xx are caller errors, not alerts; awaiting keeps the isolate alive to send    |
| Source maps             | Uploaded only when `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are in the build env (Vercel; EAS `production`); EAS `development`/`preview` set `SENTRY_DISABLE_AUTO_UPLOAD`                                      | Builds must not fail for want of a Sentry token                                                        |

## Alternatives considered

- **Deploy on `push` to `main` directly** — runs in parallel with CI, so a failing commit could
  migrate prod.
- **`supabase db push --db-url`** — needs the pooler URL with the password as a secret string;
  `link` + password env is the CLI's documented CI path and also serves `functions deploy`.
- **Deploying web from Actions (`vercel deploy`)** — duplicates Vercel's Git integration and needs
  another token.
- **`@sentry/deno` in Edge Functions** — an npm dependency in every function bundle for a single
  POST.

## Consequences

- Turning on prod deploys needs, in order: reconcile prod's migration history (§13 of
  ARCHITECTURE), add the three secrets, then set `SUPABASE_DEPLOY_ENABLED=true`.
- EAS `production` builds upload source maps and therefore need the three `SENTRY_*` EAS secrets
  (or `SENTRY_DISABLE_AUTO_UPLOAD=true`); `metro.config.js` does not yet use
  `getSentryExpoConfig`, so JS events have no debug IDs until it does.
- `_shared/sentry.ts` reads `SENTRY_DSN` / `SENTRY_ENVIRONMENT` itself: a second env reader beside
  `_shared/auth.ts` (reading them there would make an import cycle through `http.ts`).
- Server-rendered web errors carry no user id (only browser events do): the root layout does not
  load the user, and an extra `getUser()` per request was not worth it.
- Verified: `_shared/sentry_test.ts` (DSN parsing, envelope shape, timeout, no-DSN no-op, report
  only ≥ 500), web build, Expo export. Not verified: any workflow run, a real Sentry event from
  any surface, an EAS build, a Vercel deploy.
