# 006 — Roles: player, curator, admin

Status: Accepted
Date: 2026-09-26
Scope: SPEC §3.4 ("admin role later for curation"; this fills it in), §16 (RLS everywhere). Code: `packages/db/migrations/20260928000000_roles_permissions.sql`,
`packages/api/src/permissions.ts`, `supabase/functions/_shared/permissions.ts`,
`apps/web/src/app/layout.tsx`, `apps/mobile/src/app/_layout.tsx`. Standard:
`docs/standards/permissions.md`.

## Context

The SPEC scopes every private row to its owner (`user_id` + RLS) and says only that courses are
writable by their creator, with an "admin role later for curation" (§3.4). Published courses need someone other than the
creator to fix and publish them, and the app needs a single place to switch a page or server
action off (plans, moderation) without a code path per feature. The SPEC names no role model.

## Decision

| Item               | Value                                                                                                                                                            | Rationale                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Roles              | `player` (default), `curator`, `admin` — one per user, `profiles.role` (`app_role` enum)                                                                         | Three is enough for a consumer app; one role per user keeps access explainable.                     |
| `curator`          | `player` + `courses.publish`: read, edit and publish any user's course                                                                                           | Course curation is the only cross-user capability the product needs today.                          |
| `admin`            | Every key, always (a trigger grants each new key to `admin`)                                                                                                     | No super-admin bypass flag, so there is one code path; operators use the service role.              |
| Roles only widen   | Ownership RLS is the primary boundary; a key never narrows it and a player key never reaches others' rows. Only widening keys (`courses.publish`) appear in RLS. | A bug in the role model can then only fail to grant a widening, never expose another player's data. |
| Keys               | `<page>.<verb>`, pages are keys too (`<page>.view`); page keys equal the web nav keys                                                                            | The same key drives the nav row, the route guard and the server check (four gates).                 |
| Who changes a role | Service role / database owner only (`protect_profile_role` trigger); grants change by migration                                                                  | No role editor until there is more than one operator.                                               |
| Tenants            | None. No `org_id`; the organisation path is documented (permissions standard §8), not built                                                                      | Every private row belongs to one user; RLS on `user_id` already isolates users completely.          |

## Alternatives considered

- **Admin flag on `profiles`** — a second code path that bypasses checks; `admin` as "the role
  with every key" is simpler and tested.
- **Many-to-many user ↔ roles, per-user overrides** — more flexible than anything the product
  needs, and access stops being explainable by one role.
- **Tenants now (`org_id` on every table)** — no clubs, coaches or teams exist yet; it would add
  a join to every policy for no user-visible benefit.

## Consequences

- The catalogue exists in the TS source, the SQL seed and a JSON fixture; drift tests (vitest,
  SQL, Deno parity) keep them equal.
- Web: grants are loaded once per request (`lib/auth/grants.ts`), the shell hides rows the user
  cannot see and the root layout redirects denied pages. Mobile: `<Gate>` loads grants after
  sign-in and redirects denied routes home. Both fall back to player grants when the load fails.
- Adding tenants later moves the role onto an `org_members` row; `profiles.role` becomes the
  platform role.
