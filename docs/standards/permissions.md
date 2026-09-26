# CaddyMate Permissions Standard

- **Status:** Active (2026-09-26). Implements SPEC §3.4 ("courses … writable by their creator
  (admin role later for curation)") and prepares the consumer-SaaS path (SPEC §1.1 goal 4).
- **Adapted from:** the SCS OCC permissions standard (ADR 036). §9 lists what was adopted,
  adapted and rejected, and why.
- **Code:** `packages/api/src/permissions.ts` (catalogue + checks),
  `packages/db/migrations/20260928000000_roles_permissions.sql` (tables, seed, SQL checks, RLS),
  `supabase/functions/_shared/permissions.ts` (Edge Function mirror).

This is the single description of access control in CaddyMate. Module code, ADRs and the
web/mobile shells point here; when they disagree, this document wins.

---

## 1. The model in one page

```
User (auth.users → profiles)
 ├─ owns rows            user_id = auth.uid()  → RLS, the PRIMARY boundary (SPEC §3.4)
 └─ holds ONE role       profiles.role: player (default) | curator | admin
      └─ the role holds permission keys (role_permission), each pinned to one page:
           ├─ <page>.view   = the page itself (nav row + route)
           └─ <page>.<verb> = an action on that page (refit, publish, …)
```

| Layer              | Answers                                       | Stored in                                | Defined in code by            |
| ------------------ | --------------------------------------------- | ---------------------------------------- | ----------------------------- |
| **Ownership**      | Whose rows are these?                         | `user_id` columns + RLS policies         | the migrations                |
| **User → Role**    | Which role does this person hold?             | `profiles.role` (`app_role` enum)        | service role only (§2)        |
| **Role → Pages**   | Which screens can the role open?              | `role_permission` rows for `<page>.view` | `PAGES` + `PERMISSIONS` (api) |
| **Role → Actions** | Which operations can the role perform?        | `role_permission` rows for other verbs   | `PERMISSIONS` (api)           |
| **Effective**      | What is in force after the page cascade (§6)? | `role_effective_permission` view         | `effectiveKeys()` (api)       |

Four rules follow:

1. **Ownership first, roles only widen.** A key never narrows what RLS already allows a player
   to do with their own rows, and a player-held key never grants access to someone else's rows.
   Only explicitly _widening_ keys (today: `courses.publish`) appear in RLS.
2. **Page access equals nav access.** The same page key drives the nav row and the route guard.
3. **Every action belongs to exactly one page.** Structural: `permission_key = page_key || '.' || verb`.
4. **A page grants nothing but itself.** Holding `clubs.view` does not imply `clubs.refit`.

### Roles

| Role      | Who                         | Holds                                                                 |
| --------- | --------------------------- | --------------------------------------------------------------------- |
| `player`  | every account (the default) | every page and every player action; nothing that reaches others' rows |
| `curator` | trusted course editors      | `player` + `courses.publish` (read, edit and publish **any** course)  |
| `admin`   | operators                   | every key, always (a trigger grants each new key to `admin`; §6.5)    |

There is no super-admin bypass flag: `admin` is simply the role that holds every key, and
platform operators use the service role. Per-user overrides do not exist; access is always
explained by "which role does this person hold".

---

## 2. Where each part lives

| Part                        | Location                                                                         | Notes                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Catalogue (source of truth) | `packages/api/src/permissions.ts` — `PAGES`, `PERMISSIONS`, `ROLES`, `VERBS`     | Pages in nav order with route prefixes per surface; keys with page, verb, default roles |
| Seed                        | `packages/db/migrations/<ts>_*.sql` inserting `permission` + `role_permission`   | `ON CONFLICT (permission_key) DO UPDATE`; admin granted by trigger                      |
| Fixture                     | `packages/db/tests/fixtures/permissions.json` = `permissionCatalogue()`          | Bridges TS and SQL (§6.4)                                                               |
| Tables                      | `profiles.role`, `permission`, `role_permission`                                 | Catalogue readable by `authenticated`; written by the service role only                 |
| Cascade                     | view `role_effective_permission`                                                 | §6.3                                                                                    |
| SQL check                   | `public.has_permission(key)` (security definer, `auth.uid()`)                    | Use in RLS as `(select public.has_permission('…'))` so it is evaluated once             |
| Client read                 | view `my_permissions` (role + effective keys of the caller)                      | One query per session/request via `loadGrants(db)`                                      |
| Pure checks (api)           | `can`, `canSeeNavItem`, `pageKeyForPath`, `canOpenPath`, `firstAccessiblePath`   | Shared by web and mobile; no I/O                                                        |
| Server gate (api)           | `requirePermission(grants, key)` → `PermissionDeniedError` (`code: 'forbidden'`) | Server Components / Actions / route handlers                                            |
| Server gate (Edge)          | `_shared/permissions.ts` `loadGrants(client)` + `requirePermission` → 403        | Mirror of the api; parity-tested                                                        |
| Web nav tree                | `apps/web/src/lib/nav/tree.ts` — nav keys **equal** catalogue page keys          | The web shell's `canSeeNavItem(key)` seam calls the api helper                          |
| Role assignment             | service role (`update profiles set role = …`)                                    | Trigger `protect_profile_role` rejects changes made as `authenticated` / `anon`         |

The key list therefore exists in three places — TS catalogue, SQL seed, JSON fixture — and in
the Edge mirror. §6.4 is the test that keeps them equal.

---

## 3. Naming

### 3.1 Module key = first segment = prefix

The module key is the first segment of a page key, and therefore the prefix of every
permission key on that page (`courses` → `courses.view`, `courses.publish`). Nothing else may
be a prefix. `permission.module_key` is a generated column (`split_part(page_key, '.', 1)`), so
it cannot disagree.

Data domains that have no page of their own (**shots**, **patterns**) are not modules: their
server operations are keyed on the page where the user exercises them (`rounds.write` for
finalising a round's shots, `import.write` for simulator shots, `clubs.refit` for patterns).

### 3.2 Page keys (= nav keys)

```
<module>                 e.g. clubs
<module>.<sub_page>      e.g. rounds.trends      (two levels at most)
```

- Lower-case `snake_case` per segment (`^[a-z][a-z_]*(\.[a-z][a-z_]*)?$`), dots between levels.
- **The web LeftNav keys are the page keys.** A nav row that opens a catalogued page uses the
  page key verbatim (or names it as its `pageKey`, for replica children). Mobile has no
  LeftNav; its routes map onto the same pages (`/bag` → `clubs`).
- Keys are stable. A rename is a data migration on `permission` / `role_permission` (the FK
  cascades `on update`), plus the nav tree, plus the fixture.

### 3.3 Permission keys

```
<page_key>.<verb>        e.g. clubs.refit, rounds.trends.view      (three segments at most)
```

Enforced by a CHECK. The page is the entity: where the ERP writes `crm.quotes.approve`,
CaddyMate writes the page that holds the control. If one page ever needs two actions with the
same verb, split the page or amend the verb list — do not invent an entity segment.

### 3.4 Fixed verb list (`permission_verb` enum)

| Verb      | Meaning                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `view`    | Open the page (and see it in the nav). Exactly one per page; it _is_ the page grant. |
| `write`   | Run the page's server-side write (create/edit/delete of the caller's own records).   |
| `refit`   | Recompute derived engine state on the server (pattern refit).                        |
| `publish` | Make shared content current for everyone, including content the caller does not own. |

Adding a verb is an amendment to this document plus an `alter type permission_verb add value`
migration. Don't add verbs inside a module seed.

---

## 4. The catalogue today

| Key                  | Page            | Default roles          | Enforced by                                                             |
| -------------------- | --------------- | ---------------------- | ----------------------------------------------------------------------- |
| `dashboard.view`     | `dashboard`     | player, curator, admin | Gates 2–3 (web shell / mobile gate)                                     |
| `rounds.view`        | `rounds`        | player, curator, admin | Gates 2–3; parent of `rounds.review`, `rounds.trends`                   |
| `rounds.write`       | `rounds`        | player, curator, admin | Gate 4: `finalise-round`                                                |
| `rounds.review.view` | `rounds.review` | player, curator, admin | Gates 2–3                                                               |
| `rounds.trends.view` | `rounds.trends` | player, curator, admin | Gates 2–3                                                               |
| `clubs.view`         | `clubs`         | player, curator, admin | Gates 2–3                                                               |
| `clubs.refit`        | `clubs`         | player, curator, admin | Gate 4: `refit`                                                         |
| `courses.view`       | `courses`       | player, curator, admin | Gates 2–3                                                               |
| `courses.publish`    | `courses`       | curator, admin         | Gate 4 in RLS: `can_read_course`, `can_write_course`, 2 course policies |
| `import.view`        | `import`        | player, curator, admin | Gates 2–3                                                               |
| `import.write`       | `import`        | player, curator, admin | Gate 4: `import-sim`                                                    |

Routes per page (`PAGES`): `dashboard` web `/`, mobile `/`; `rounds` mobile `/round/*`;
`rounds.review` `/review/*`; `rounds.trends` `/review/trends`; `clubs` web `/clubs/*`, mobile
`/bag`, `/review/clubs/*`; `courses` web `/courses/*`; `import` web `/import`. Public:
`/sign-in`, `/auth/*` (web), `/sign-in` (mobile). Resolution is longest prefix at a segment
boundary; `/` matches the root only.

---

## 5. Enforcement: the four gates

Every page and action goes through all four. Missing one is non-compliant however good the
other three are.

### Gate 1: Signed in, on the right surface

CaddyMate is one app, so the ERP's "app visibility" becomes: no session, no app (web `proxy.ts`
redirects to `/sign-in`; mobile `_layout.tsx` `<Gate>` redirects to `/sign-in`). A page with no
route on a surface (e.g. `import` on mobile) simply does not exist there. When organisations
and plans arrive (§8) this is where "is this org / plan entitled to the product area" goes.

### Gate 2: Nav composition

Load grants once (`loadGrants(db)`) and keep a nav row only when `canSeeNavItem(pageKey,
grants)`. With the page cascade a visible sub-page implies a visible parent.

- **Web:** the shell composes `NAV_TREE` through its seam
  `apps/web/src/lib/nav/access.ts#canSeeNavItem(key)`; its body becomes
  `canSeeNavItem(key, grants)` from `@caddymate/api` with the request's grants.
- **Mobile:** the dashboard tiles / links are filtered the same way.

### Gate 3: Page guard

In order:

1. No session → `/sign-in` (Gate 1).
2. `grants = await loadGrants(db)`; on error use `grantsForRole('player')` (never grants more
   than a player; never locks a player out).
3. `if (!canOpenPath(path, surface, grants))` → redirect to
   `firstAccessiblePath(grants, surface) ?? '/sign-in'`.

- **Web:** `proxy.ts` stamps the pathname (e.g. `x-pathname`); the shell layout (a Server
  Component) runs the guard, deduped with `React.cache`. `redirect()` is called **outside** any
  `try/catch` (Next implements it by throwing).
- **Mobile:** `<Gate>` loads grants with the session (AuthProvider) and, from
  `useSegments()`, builds the path and renders `<Redirect>` when `canOpenPath` is false.
- **Fail-safe:** public and unresolved paths fall through (`canOpenPath` → `true`). The route
  drift test (§6.4) is what keeps "unresolved" empty.

A `can(grants, key)` check inside a page hides or disables a control; it never replaces the
guard.

### Gate 4: Action check (on the server)

Every Edge Function, Server Action, route handler and RPC that performs an action checks the
key **the user is exercising**, on the server, before doing anything:

```ts
// Edge Function handler — right after authenticate():
const { userId, store, grants } = await deps.authenticate(req); // grants = loadGrants(client)
requirePermission(grants, 'clubs.refit'); // HttpError 403 { code: 'forbidden' }

// Next.js Server Action / route handler:
requirePermission(await loadGrants(db), 'import.write'); // PermissionDeniedError
```

- Widening keys are enforced **in the database**: `has_permission('courses.publish')` inside
  the RLS helpers, so PostgREST and the security-invoker RPCs obey it whatever the client does.
- Never trust a key passed from the client; hidden buttons are UX, not security.
- Player-held keys at Gate 4 are feature gates: a no-op for default players today, the lever for
  plan gating and moderation later. They never replace ownership RLS.

---

## 6. Rules that keep the model honest

### 6.1 Seeded means enforced

A key may not be seeded unless code checks it (Gates 2–4). That is why there is no
`clubs.write` or `courses.write` yet: bag edits and own-course editing are ownership-only
(direct RLS writes) and nothing server-side would read such a key. Seed a key in the same change
that adds its check.

### 6.2 Every action sits under one page

Structural: the key is `<page>.<verb>`, and the generated `page_view_key` has a (deferred) FK to
the page's `view` row, so a key cannot exist without its page.

### 6.3 Switching a page off revokes everything beneath it

`role_effective_permission` keeps a grant only while the role holds the `view` key of its page
**and of every ancestor page**. Removing `rounds.view` revokes `rounds.write`,
`rounds.review.view` and `rounds.trends.view`; `has_permission`, `my_permissions` and
`effectiveKeys()` all see the cascaded set.

### 6.4 Two tests (shared by every module)

1. **Drift** — fails when the catalogue copies or the routes disagree:
   - `packages/api/src/permissions.test.ts`: `permissionCatalogue()` equals the JSON fixture;
     keys are `<page>.<verb>`; every page has one view key; admin holds everything; route table.
   - `packages/db/tests/permissions.sql` (via `local-db.sh`): the `permission` rows and default
     grants equal the fixture in both directions (a seeded key missing from TS fails as "seeded
     but unchecked"); admin complete; cascade; curator vs player on another user's course; no
     self-promotion; no catalogue writes.
   - `supabase/functions/_shared/permissions_test.ts`: the Edge mirror equals the api; **every
     route file** under `apps/web/src/app` and `apps/mobile/src/app` resolves to a page or is
     public.
2. **Guards** — `supabase/functions/_shared/permissions_test.ts` fails when an Edge Function
   `handler.ts` does not call `requirePermission(grants, '<key>')`, unless it is on the
   `UNGUARDED` allowlist with a reason; a stale allowlist entry fails too. When Server Actions
   start performing actions, add the same scan for `'use server'` files.

### 6.5 Admin stays complete

A trigger on `permission` insert grants the new key to `admin`; the SQL and vitest suites assert
admin holds every key. `DEFAULT_ROLE_PERMISSIONS` is derived from `PERMISSIONS`, never
hand-listed.

### 6.6 Deny on the server, explain in the UI

Denied actions return an error (`403 { error: { code: 'forbidden' } }` from functions,
`PermissionDeniedError` in server code, `42501` from SQL); where a user could plausibly reach
the control, the UI hides or disables it with a short reason (`can(grants, key)`, or
`course_get(...).course.can_write` for the editor). Denied pages redirect to the first page the
user can see — no generic "access denied" dead end.

### 6.7 Roles are not self-service

`profiles.role` changes only as the service role / database owner (trigger
`protect_profile_role`). There is no role editor; grants change by migration.

---

## 7. Checklists

### 7.1 Adding a module

1. Add its page(s) to `PAGES` in nav order, with route prefixes per surface, and a `<page>.view`
   key in `PERMISSIONS` with default roles.
2. Add the nav row to `apps/web/src/lib/nav/tree.ts` with the **same key** (mobile: its routes).
3. Write a migration seeding the rows (copy the `with seed … insert` block;
   `on conflict (permission_key) do update`). Admin is granted automatically.
4. Regenerate the fixture (§7.3 step 3) and mirror the keys in `_shared/permissions.ts`.
5. Wire Gates 2–4. Run `local-db.sh`, `pnpm test`, `deno task test`.
6. Update the snapshot in §10.

### 7.2 Adding a page or sub-page

1. Add it to `PAGES` (≤ two levels; a sub-page's key extends its parent's) and its `view` key.
2. Add the nav row with the same key; the route drift test tells you if a route is unresolved.
3. Seed the `view` row and decide which roles get it (existing roles do **not** get new pages
   unless the seed grants them; admin always does).

### 7.3 Adding an action

1. Pick the page and a verb from §3.4. The key is `<page>.<verb>`.
2. Add it to `PERMISSIONS` (and the Edge mirror if a function checks it).
3. Regenerate the fixture from the repo root:
   ```
   node --input-type=module -e "import { permissionCatalogue } from './packages/api/src/permissions.ts'; console.log(JSON.stringify(permissionCatalogue(), null, 2))" > packages/db/tests/fixtures/permissions.json && pnpm format
   ```
4. Seed it in a **new** migration with its default roles.
5. Check it on the server (Gate 4) in the same change — and in RLS if it widens access.
6. Hide/disable the control with `can()` where users could reach it.

### 7.4 Reviewing a change that touches access

- Does every new key follow §3, appear in TS, seed, fixture (and mirror), and have a server
  check?
- Does any RLS change **narrow** ownership access? (Not allowed: roles only widen.)
- Is any check client-side only?
- Does any route resolve to no page (route drift test)?
- Does any function handler skip `requirePermission` without an allowlist reason?

---

## 8. Planned: organisations (`org_id`) — documented, not built

CaddyMate has no tenants: every private row belongs to one user, and RLS on `user_id` already
isolates users completely. When clubs, coaches or teams arrive:

1. `orgs (org_id)` and `org_members (org_id, user_id, role app_role)`; a personal org per user.
   The role moves from `profiles.role` to the membership; `profiles.role` becomes the platform
   role (operators).
2. `has_permission(key, org_id uuid default null)`; `my_permissions` gains `org_id`;
   `Grants` becomes per-org.
3. Shared resources (courses first) get a nullable `org_id`; RLS adds
   `org_id is not null and is_member(org_id)` beside the existing ownership rules. Private
   player data (shots, rounds, patterns) stays user-owned; sharing it with a coach is an
   explicit, per-row grant, not a role.
4. `profiles.plan` (free | pro) becomes Gate 1 / a key filter: effective keys = role keys ∩
   plan keys. Build it only with billing (SPEC §3.4).

---

## 9. Adoption versus the SCS OCC standard

| ERP rule                                                   | Here         | Why                                                                                                                             |
| ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Three layers: user → roles → menu keys + action keys       | **Adapted**  | One role per user (enum), and pages are keys too (`<page>.view`) — one table instead of `role_menu_access` + `role_permission`. |
| Roles per app and per tenant                               | **Rejected** | One app, no tenants yet; the `org_id` path is §8.                                                                               |
| Built-in Admin role holds everything; back-filled          | **Adopted**  | Trigger grants every new key to `admin`; tested.                                                                                |
| Tenant-created roles, archived not deleted, role editor UI | **Rejected** | Three fixed roles are enough for a consumer app today; grants change by migration.                                              |
| Super-admin flag that bypasses every check                 | **Rejected** | `admin` is just the role with every key — no second code path. Operators use the service role.                                  |
| Per-user overrides out of scope                            | **Adopted**  | Same reason: access must be explained by the role. No override table exists at all.                                             |
| App id = module key = key prefix                           | **Adapted**  | No app ids: module key = first segment of the page key = prefix of every key (generated column).                                |
| Action key `<app>.<entity>.<verb>`                         | **Adapted**  | `<page>.<verb>` (CHECK): the page is the entity, which makes "one page per action" structural.                                  |
| Fixed verb list of 13                                      | **Adapted**  | Four verbs (enum). Ownership already scopes CRUD, so `write` covers create/edit/delete; no ledger verbs (post/reverse) needed.  |
| Menu keys mirror the LeftNav exactly                       | **Adopted**  | Page keys equal the web nav keys; mobile routes map onto the same pages.                                                        |
| Settings → Permissions (Users, User roles) in every module | **Rejected** | No role management UI until there is more than one operator (§6.7).                                                             |
| `menuKeyForPath`, `matchPrefixes`, `matchPatterns`         | **Adapted**  | `pageKeyForPath`: per-surface prefixes, longest wins, root exact. No patterns: every id route sits under a list prefix.         |
| Four gates                                                 | **Adapted**  | Gate 1 is "signed in on this surface" (one app); gates 2–4 as in the ERP, on web and mobile.                                    |
| Guard fail-safe ("golden rule")                            | **Adopted**  | Unresolved paths fall through; a grants-load error falls back to player grants (never more than a player).                      |
| Gate 4 in every Server Action (`userHasPermission`)        | **Adapted**  | `requirePermission` in Edge Functions and server code, **plus** RLS for widening keys — the DB is the last line, not app code.  |
| Tenant isolation in app code (service key bypasses RLS)    | **Rejected** | CaddyMate runs on the user's JWT with RLS everywhere (SPEC §16); the service role is confined to caches and pattern writes.     |
| Seeded means enforced                                      | **Adopted**  | Hence no `clubs.write` / `courses.write`.                                                                                       |
| Every action sits under one page                           | **Adopted**  | Enforced by CHECK + FK rather than by a catalogue review.                                                                       |
| Toggling a page off revokes descendants                    | **Adopted**  | In the database (`role_effective_permission`), not in an editor cascade — there is no editor, and the DB cannot be bypassed.    |
| Two tests per module                                       | **Adapted**  | One shared drift suite and one shared guard suite cover all modules (§6.4); the module count is small.                          |
| `ALL_<APP>_PERMS` super-admin constant kept complete       | **Adapted**  | `DEFAULT_ROLE_PERMISSIONS` is derived from the catalogue, so it cannot go stale.                                                |
| Deny on the server, explain in the UI                      | **Adopted**  | §6.6.                                                                                                                           |
| Audience function for notifications                        | **Rejected** | No notifications.                                                                                                               |
| Confidentiality tiers inside DB helpers (HR)               | **Adapted**  | Ownership RLS plays that role and is primary rather than additional.                                                            |

---

## 10. Compliance snapshot (2026-09-26)

| Module / area                                                       | Keys                                                                      | Gate 2 nav                          | Gate 3 guard           | Gate 4 server                                                        | Status / gaps                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- | ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| dashboard                                                           | `dashboard.view`                                                          | web seam present, body returns true | pending (web + mobile) | n/a (read-only)                                                      | Wire the seam and the guards to the api helpers.                                                                         |
| rounds (play, review, trends)                                       | `rounds.view`, `rounds.write`, `rounds.review.view`, `rounds.trends.view` | as above                            | pending                | `finalise-round` ✓; direct round/hole-score writes are ownership-RLS | Mobile play screens need the mobile gate.                                                                                |
| shots (data, no page)                                               | —                                                                         | —                                   | —                      | ownership RLS; server paths under `rounds.write` / `import.write` ✓  | Compliant by §3.1.                                                                                                       |
| clubs                                                               | `clubs.view`, `clubs.refit`                                               | as above                            | pending                | `refit` ✓; bag edits ownership-RLS                                   | Web refit button should hide/disable via `can(grants, 'clubs.refit')`.                                                   |
| patterns (data, no page)                                            | —                                                                         | —                                   | —                      | owner RLS (device refit); authoritative refit under `clubs.refit` ✓  | Compliant by §3.1.                                                                                                       |
| courses                                                             | `courses.view`, `courses.publish`                                         | as above                            | pending                | RLS + RPCs via `can_write_course` ✓; `courses/new` action ownership  | Curators have no UI entry point for others' drafts yet (the list only shows what RLS returns — which now includes them). |
| import                                                              | `import.view`, `import.write`                                             | as above                            | pending                | `import-sim` ✓                                                       | Hide the import form without `import.write`.                                                                             |
| Edge Functions                                                      | —                                                                         | —                                   | —                      | refit, import-sim, finalise-round ✓; weather, elevation allowlisted  | Guard test enforces it for new functions.                                                                                |
| Reference data (`sg_baselines`, `weather_cache`, `elevation_grids`) | —                                                                         | —                                   | —                      | read: any signed-in user; write: service role                        | Unchanged; no key needed while nobody but the service role writes.                                                       |

The view keys are seeded ahead of their Gate 2/3 wiring because the web shell's seam and the
mobile gate are being built in parallel; wiring them closes the only open "seeded means
enforced" gap.
