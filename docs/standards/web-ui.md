# CaddyMate web UI standard

- **Status:** Active from 2026-09-26.
- **Applies to:** `apps/web` (Next.js). Notes for `apps/mobile` are marked **Mobile** and are
  guidance only; the Expo app keeps its own navigation (expo-router tabs and stacks).
- **Source:** adapted from the SCS OCC ERP's navigation, responsive, tables, dropdowns and
  primitive-registry standards and the UI sections of its `CLAUDE.md` / `architecture.md`. Every
  rule taken from there is tagged **Adopted** (taken as written), **Adapted** (kept in spirit,
  changed to fit) or **Rejected** (not taken), with the reason. The summary is in §1; the tags in
  the body say the same thing where the rule lives.
- **Companions:** `docs/SPEC.md` §14 (visual direction, tokens in `packages/ui`),
  `docs/standards/permissions.md` (who may see a page; plugs into the nav seam in §2.6).

CaddyMate is one app for one golfer. The ERP standards were written for a multi-module,
multi-role business suite used by office staff and field engineers, so the parts about app
switching, company branding, notifications, form action bars and installable-PWA field use do
not carry over. What does carry over is the discipline: one navigation tree, menus that are only
places, tables you narrow from the headers, dropdowns you type into, layout by tier through
classes, and a small registry of shared primitives that pages compose instead of re-inventing.

---

## 1. Adoption summary

| ERP rule                                                                            | Decision | Why                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell of TopBar / LeftNav / SubNav, each with one job                               | Adopted  | Same problem: orientation, sections, views.                                                                                                                                            |
| AppChooser in the TopBar                                                            | Rejected | One app. There is nothing to choose between.                                                                                                                                           |
| NotificationBell, BottomStatusBar, HelpDrawer                                       | Rejected | No notifications or environment health on web; nothing to show.                                                                                                                        |
| Logo is the only home link; "Home" never appears in a menu                          | Adopted  | Logo links to the dashboard at `/`. The old "← Home" page links were removed.                                                                                                          |
| Dashboard as a SubNav "home segment"                                                | Adapted  | With one app the logo already is the dashboard link; a second home affordance would be the duplicate the ERP rule forbids.                                                             |
| Breadcrumb derived from the URL; pages never render their own                       | Adopted  | `breadcrumbFor()` in `lib/nav/tree.ts`. The "← Rounds" / "← Clubs" back links were removed.                                                                                            |
| Breadcrumb shows leaf on phone, last two on tablet, up to five on desktop           | Adopted  | CSS on `data-from-end`.                                                                                                                                                                |
| "The test before adding anything" (own URL → section; same URL → view)              | Adopted  | §2.1.                                                                                                                                                                                  |
| LeftNav up to three levels, chevrons open a branch without navigating               | Adopted  | §2.3.                                                                                                                                                                                  |
| Replica-child rule                                                                  | Adopted  | Rounds → **Review** (the list, same URL) and Trends.                                                                                                                                   |
| Row order by usage, Settings last                                                   | Adopted  | Rounds, Clubs, Courses, Import, Settings.                                                                                                                                              |
| Settings tail: My settings, module pages, Permissions → Users / User roles          | Adapted  | Settings → My settings only, locked ("Soon") until a settings page exists. No role editor on web yet; the permissions standard owns that.                                              |
| `locked` rows at most one release                                                   | Adopted  | Settings is the only locked row; remove the lock when `/settings` ships.                                                                                                               |
| Collapsible rail 220 → 52px, persisted                                              | Adapted  | 220 → 56px (a 44px target plus padding), persisted in `localStorage`, in-memory fallback.                                                                                              |
| SubNav shows views of the deepest active section; never other sections              | Adopted  | Only Trends has views today (Strokes gained / Course view / Handicap, `?view=`). The bar is not drawn when there are no views.                                                         |
| SubNav right-hand page actions (`SubNavActions`, Cancel/Save triplet)               | Adapted  | Page actions sit in `PageHeader`'s `actions` slot. No SubNav is drawn on most pages, and CaddyMate has almost no multi-field forms.                                                    |
| Record-detail tabs (`?tab=`)                                                        | Deferred | Supported by the standard; no page needs it yet (the round review is one scrolling page). Add with `detail` on a node when one does.                                                   |
| One tree, three consumers (nav, role editor, page guard)                            | Adapted  | One tree (`NAV_TREE`) feeds LeftNav, SubNav, breadcrumb and the permission seam (`canSeeNavItem`, `menuKeyForPath`). No role editor.                                                   |
| Menu keys: kebab-case, dotted, no app id; key is stable, route may redirect         | Adopted  | Keys equal the permission catalogue's page keys (`review`, `review.trends`, …).                                                                                                        |
| Labels: sentence case, plural for lists                                             | Adopted  | Enforced by `tree.test.ts`.                                                                                                                                                            |
| Icons: named, monochrome, single-weight, `currentColor`, never emoji                | Adopted  | `components/shell/Icon.tsx`.                                                                                                                                                           |
| SCS brand (logo SVGs, Oxford Blue / Apiro Green palette, Ubuntu / Open Sans)        | Rejected | Another company's brand. CaddyMate's tokens are the dark green set in `packages/ui` mirrored in `globals.css`.                                                                         |
| Never hard-code hex in components; tokens in `globals.css` first                    | Adopted  | New code uses tokens. Chart palettes in `components/charts/palette.ts` are the one documented exception (validated categorical colours).                                               |
| Glassmorphism card spec                                                             | Rejected | SPEC §14: TheGrint-like solid dark cards.                                                                                                                                              |
| Three tiers 767 / 1023, a unit test keeps CSS and TS equal                          | Adopted  | `viewport.ts` + `viewport.test.ts`; they equal Tailwind `md` / `lg`.                                                                                                                   |
| Classes, not inline breakpoints; `useViewportTier()` only when the tree must differ | Adapted  | Tailwind `md:` / `lg:` are allowed (they are classes on the same tiers); `sm:` / `xl:` / `2xl:` are removed from the theme.                                                            |
| Responsive toolkit classes                                                          | Adopted  | §3.3, in `globals.css`.                                                                                                                                                                |
| Page classes: phone-first / tablet-capable / desktop-only                           | Adapted  | No web page is phone-first: **the phone experience is the Expo app.** Web pages are tablet-capable or desktop-only; a few tables use the card layout so a quick look on a phone works. |
| Phone action bar, field-engineer audiences                                          | Rejected | No forms that need it; the on-course user is on the mobile app.                                                                                                                        |
| Touch targets 44px under coarse pointers, 24px minimum everywhere                   | Adopted  | `--tap` token.                                                                                                                                                                         |
| Inputs 16px on a phone                                                              | Adopted  | Global rule.                                                                                                                                                                           |
| WCAG 2.2 AA list (focus, keyboard, semantics, motion, labels, reflow, …)            | Adopted  | §3.5.                                                                                                                                                                                  |
| Playwright e2e at three tiers, axe in CI, Lighthouse gates                          | Deferred | No browser runner in this repo yet. Checklists (§7) require a manual three-tier pass until one is added.                                                                               |
| PWA (manifest, service worker, install hint), location, camera rules                | Rejected | The installable, on-course, GPS-and-camera client is the Expo app (SPEC §3). The web app is online-only and is not made installable.                                                   |
| Every table of records filterable from its headers; no filter bar                   | Adopted  | `FilterableTable`, §4.                                                                                                                                                                 |
| Filter state in the URL; read at render, never in a mount effect                    | Adopted  | Written with `history.replaceState`, so filtering does not re-run the server page.                                                                                                     |
| Tick list + find box per column; date From/To                                       | Adapted  | Plus a contains-text filter and a numeric range, because CaddyMate tables are mostly numbers (yards, strokes gained, differentials).                                                   |
| Scroll layout by default; card layout on phone-first pages                          | Adopted  | Cards are opt-in (`phoneLayout="cards"`).                                                                                                                                              |
| Dropdowns type-to-filter; native `<select>` for ≤ 4-item vocabularies               | Adapted  | `Select` is the default for every dropdown. Native stays only for ≤ 5 fixed values in a dense inline editor row (Par, Penalty).                                                        |
| Primitive registry, owner-edit-only                                                 | Adopted  | §6. Owner is the repository owner.                                                                                                                                                     |
| Lock-managed shared files, checkout CLI                                             | Rejected | One owner and orchestrated agents; git review is the control.                                                                                                                          |

---

## 2. The shell

Every signed-in page renders inside `AppShell` (mounted once in `app/layout.tsx`). `/sign-in` and
`/auth/*` render bare (`isShellless()` in `lib/nav/tree.ts`).

```
┌───────────────────────────────────────────────────────────────────────┐
│ TopBar  [≡ phone] [⚑ CaddyMate → /]  Rounds / Trends          [Account ▾] │
├─────────────┬─────────────────────────────────────────────────────────┤
│ LeftNav     │ SubNav: Strokes gained │ Course view │ Handicap  (only   │
│ ⚑ Rounds  ˅ │                                     when views exist)   │
│   ▤ Review  ├─────────────────────────────────────────────────────────┤
│   ↗ Trends  │                                                         │
│ ╱ Clubs     │    <main id="workspace">  Page → PageHeader → Cards     │
│ ▭ Courses   │                                                         │
│ ⇩ Import    │                                                         │
│ ⚙ Settings  │                                                         │
│      ‹      │                                                         │
└─────────────┴─────────────────────────────────────────────────────────┘
```

| Surface        | Job                                              | Content comes from                               |
| -------------- | ------------------------------------------------ | ------------------------------------------------ |
| **TopBar**     | Global orientation: home, where you are, account | Fixed: menu button, logo, breadcrumb, `UserMenu` |
| **Breadcrumb** | Where you are; jump up the path                  | Derived from the URL and the nav tree            |
| **LeftNav**    | The app's sections                               | `NAV_TREE`, filtered by `canSeeNavItem`          |
| **SubNav**     | Views of the deepest active section's data       | The same node's `views`                          |
| **PageHeader** | The page's title and its own actions             | The page                                         |

Three rules follow (**Adopted**):

1. **The LeftNav is the app.** Its rows are CaddyMate's sections and nothing else.
2. **The SubNav is not navigation.** It shows other views of the page you are on. It never links
   to another section.
3. **Everything global is in the TopBar.** The only home link is the logo; the only way up a path
   is the breadcrumb. Pages do not render back links.

### 2.1 The test before adding anything (**Adopted**)

Ask: **does it have its own URL?**

| You want to add…                                                           | It goes in…                                          | Because…                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| A new area with its own data (Practice, Bag)                               | LeftNav top-level row                                | It is a section                                 |
| A page with its own URL under a section (Rounds → Trends)                  | LeftNav child row                                    | Its own URL makes it a place                    |
| The parent's own page when the parent has other children (Rounds → Review) | LeftNav replica child, parent's URL                  | A parent with children reads as a folder        |
| The same URL shown differently (`/review/trends?view=handicap`)            | SubNav view (`views` on the node)                    | Only the query string changes                   |
| A record's detail, create or edit page (`/clubs/{id}`, `/courses/new`)     | Nowhere in the menus; `matchPrefixes` on the section | It belongs to its list; the breadcrumb shows it |
| A button that acts on this page (Refit all, New course, Publish)           | `PageHeader` actions                                 | An action, not a place                          |
| A shortcut to another section or "Home"                                    | **Nowhere in the menus**                             | That is the section's own row, or the logo      |
| A filter, sort, search, window or course picker                            | In the page (table headers, `Select`)                | Page state, not navigation                      |

Page content may still link to other sections when it is contextual ("Import sim session" on the
clubs page); the rule is about the menus.

### 2.2 TopBar (**Adopted**, minus the AppChooser / bell)

Left to right: menu button (phone only; opens the drawer), logo + "CaddyMate" (links to `/`, the
dashboard; the word is hidden on a phone), breadcrumb, spacer, `UserMenu` (email on desktop, sign
out). Nothing else is added by a page.

### 2.3 LeftNav (**Adopted**)

- Up to **three levels** (row, child, grandchild). A fourth is a modelling error.
- **Order** is usage order: the round loop (Rounds), the bag (Clubs), Courses, data in (Import),
  **Settings last**.
- Every row has an **icon name** and a **label**. A row with children has a chevron at its right:
  it opens the branch in place without navigating; the label navigates. The active branch is open
  by default; the **deepest match is lit** (`/review/trends` lights Trends, not Rounds).
- **Replica child:** a parent that is a page and has other children gets a child with the parent's
  URL naming the page. Rounds (`/review`) → Review (`/review`), Trends (`/review/trends`).
- `locked: true` draws "Soon" with no link and never matches a path. Settings is locked until a
  settings page exists.
- **Collapse:** desktop rail 220 → 56px, remembered per browser. Collapsed rows show icons only,
  with the label as `title` and as a visible tooltip on keyboard focus; children and chevrons hide.

### 2.4 SubNav (**Adopted**, drawn only when there are views)

The bar under the TopBar lists the **views of the deepest active section** — the same path with a
different query value (`node.viewParam`, `node.views`). Switching view keeps the page's other
parameters (`viewHref`). Views may be label-only. When the active section has no views the bar is
not rendered at all. Today: Trends → Strokes gained (default) · Course view (`?view=course`) ·
Handicap (`?view=handicap`), and each view loads only its own data.

### 2.5 One tree, three consumers (**Adapted**)

`apps/web/src/lib/nav/tree.ts` exports `NAV_TREE` and the pure helpers every consumer uses:

```
NAV_TREE ─┬─► LeftNav rows            (visibleTree → rows; activeTrail → lit row, open branch)
          ├─► SubNav views            (activeTrail leaf → activeView / viewHref)
          ├─► TopBar breadcrumb       (breadcrumbFor)
          └─► permission seam         (permissionKey / menuKeyForPath → canSeeNavItem)
```

- `activeTrail(tree, path)`: the longest `route` or `matchPrefixes` match wins; on a tie the deeper
  node wins (the replica child). Detail routes resolve through `matchPrefixes` (`/clubs/`).
- `menuKeyForPath(tree, path)`: every page route resolves to exactly one key (`dashboard` for `/`).
  `tree.test.ts` walks `src/app/**/page.tsx` and fails if a page resolves to nothing, or to a
  different page than the guard's `pageKeyForPath` (`@caddymate/api`).
- `breadcrumbFor(tree, path)`: trail labels (a replica folded into its parent), then one crumb per
  segment below the matched route (`new` → New, `edit` → Edit, otherwise the node's `detailLabel`).

### 2.6 The gating seam

`apps/web/src/lib/nav/access.ts` exports **`canSeeNavItem(key, grants)`** (the `@caddymate/api`
helper) and **`decidePage(path, grants)`** (the page guard's open / redirect / denied decision).
The root layout loads the request's grants once (`lib/auth/grants.ts#getGrants`, `React.cache`,
player fallback on error), runs `decidePage` on `x-pathname` (stamped by `proxy.ts`) and passes
the grants to `AppShell`, which builds `visibleTree(NAV_TREE, k => canSeeNavItem(k, grants))`
with each row's **permission key** (`permissionKey(node)` = `node.pageKey ?? node.key`); a parent
stays visible while any child is visible, and locked rows are shown to everyone. Layouts do not
re-render on client navigation, so `AppShell` re-runs `decidePage` on every pathname: a denied
page is replaced with `<first page>?denied=<page>` (`DeniedNotice` explains it), or with
`NoAccess` when nothing is open. See docs/standards/permissions.md §5.

Nav keys **are** the catalogue's page keys (`dashboard`, `rounds`, `rounds.review`,
`rounds.trends`, `clubs`, `courses`, `import`); `tree.test.ts` enforces it. `rounds` has no web
page of its own, so its row lands on `/review`, whose replica child is the `rounds.review` page.
Hiding a row is a courtesy, not a security boundary: RLS and gate 4 guard the data.

### 2.7 Vocabulary: labels, keys, routes, icons (**Adopted**)

- **Labels:** sentence case; plural nouns for lists (Rounds, Clubs, Courses), singular for
  singletons (Trends, Import). A view label names the slice, not an action. "Home" appears in no
  menu; "Dashboard" is the `/` breadcrumb.
- **Keys:** the permission catalogue's page key for any row that opens a page (lower-case, one dot
  per level, a child key extends its parent's: `rounds.trends`); locked rows use kebab-case until
  their page is catalogued. The key is the stable identifier; if a route moves, redirect the route
  and keep the key.
- **Routes:** a key and route should read the same way; where they differ (`rounds.review` ↔
  `/review`) the key wins.
- **Icons:** names from `components/shell/Icon.tsx` — single-weight 1.75 line glyphs on 24×24,
  `currentColor`, never emoji. Reuse a name for the same concept. Add a missing icon to the set, in
  its style, rather than inline.

**Mobile:** the Expo tabs should use the same labels and the same order (Play, Rounds, Clubs, …)
and the same permission keys; icons there come from the RN icon set in the same line style.

---

## 3. Responsive

### 3.1 Tiers (**Adopted**)

| Tier    | Width      | CSS                                                 | Tailwind prefix |
| ------- | ---------- | --------------------------------------------------- | --------------- |
| Phone   | ≤ 767px    | `@media (max-width: 767px)`                         | (none)          |
| Tablet  | 768–1023px | `@media (min-width: 768px) and (max-width: 1023px)` | `md:`           |
| Desktop | ≥ 1024px   | `@media (min-width: 1024px)` / default              | `lg:`           |

`PHONE_MAX` / `TABLET_MAX` in `components/shell/viewport.ts` hold the numbers; `viewport.test.ts`
fails if any `min-width` / `max-width` query in `globals.css` uses another number, or if the
Tailwind `sm` / `xl` / `2xl` breakpoints come back. Touch and hover rules key on the pointer
(`(pointer: coarse)`, `(hover: hover)`), not the width.

**CaddyMate's phone experience is the Expo app.** The web app must not break on a phone (no
horizontal page scroll, readable, navigable), but no web page is designed phone-first.

### 3.2 The shell at each tier

- **Desktop:** full rail (220px, collapsible to 56px), breadcrumb up to five crumbs.
- **Tablet:** 56px icon rail; the collapse tab expands it **over** the page (it does not push
  content) and any navigation collapses it. Breadcrumb shows the last two crumbs.
- **Phone:** the rail is an off-canvas drawer (280px, max 85vw) opened by the TopBar menu button.
  Escape, the backdrop, the button again or any navigation closes it; focus is trapped inside while
  open and returns to the menu button; the page behind is scroll-locked (position-fixed technique,
  `components/shell/scroll-lock.ts`). Breadcrumb shows the leaf only; page padding is 12px.

### 3.3 Classes, not inline breakpoints; the toolkit (**Adapted**)

Layout that changes by tier uses a class: a toolkit class from `globals.css` or a Tailwind `md:` /
`lg:` prefix. Never an inline `style` for it, never an `@media` block inside a component or a
per-page CSS module, never `window.innerWidth` in a page. `useViewportTier()` exists for the rare
component whose _tree_ must differ; it renders "desktop" on the server, so what it controls must be
safe to flash.

| Class             | Effect                                                           | Typical use                                 |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `.stack-sm`       | `flex-direction: column` under 768px                             | A row of fields                             |
| `.stack-md`       | `flex-direction: column` under 1024px                            | Map beside a panel                          |
| `.grid-2/3/4`     | Column grids; one column under 768px; `3/4` are two under 1024px | Tiles, field pairs                          |
| `.two-col`        | `auto-fit, minmax(280px, 1fr)` grid                              | Reference-plus-detail                       |
| `.hide-sm`        | Hidden under 768px                                               | The course editor on a phone                |
| `.hide-md-down`   | Hidden under 1024px                                              | The e-mail in the user menu                 |
| `.show-sm-only`   | Hidden from 768px                                                | `DesktopOnlyNotice`, "Filter and sort"      |
| `.full-sm`        | `width: 100%` under 768px                                        | A `Select` in a header row                  |
| `.wrap-sm`        | `flex-wrap: wrap` under 768px                                    | Chip rows                                   |
| `.scroll-x`       | Horizontal scroll with momentum                                  | The SubNav view strip                       |
| `.table-scroll`   | Sideways-scrolling frame, never widens the page                  | Every table that is not a `FilterableTable` |
| `.workspace-fill` | Height of the viewport below the TopBar                          | Full-bleed tools (course editor)            |

Rules of thumb: a form is one column on a phone; fixed pixel widths on containers are a smell
(`max-width` + `width: 100%`); maps and charts set a height, never a width.

### 3.4 Page classes (**Adapted**)

| Class              | Must do                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Tablet-capable** | No horizontal page scroll at 768px or at 375px; tables in `FilterableTable` or `.table-scroll`. |
| **Desktop-only**   | Under 768px renders `DesktopOnlyNotice` instead of the tool (`.hide-sm` on the tool).           |

Phone-first is **Rejected** for web (see §3.1). A new page states its class in its PR.

### 3.5 Touch, input and accessibility — WCAG 2.2 AA (**Adopted**)

1. **Targets:** 24px minimum everywhere, 44px under `(pointer: coarse)` — use `var(--tap)` or a
   `::before` hit area so a small icon can stay small.
2. **Inputs are 16px on a phone** (global rule), or iOS zooms on focus.
3. **No hover-only affordances;** hover styling lives under `@media (hover: hover)`.
4. **Outside-click closes on `pointerdown`** (a touch counts).
5. **Focus visible** everywhere from the global `:focus-visible` ring; never `outline: none`
   without a replacement.
6. **Keyboard:** every menu, drawer, popover and dialog opens and closes from the keyboard, closes
   on Escape and restores focus. Listboxes use `aria-activedescendant`.
7. **Semantics:** one `header`, `nav[aria-label]`, `main` per page — the shell renders `<main>`, so
   pages and components never do. Icon-only buttons have `aria-label`; an accessible name contains
   the visible label.
8. **Labels:** every input has a `<label>` or `aria-label`; hints and errors are linked with
   `aria-describedby`; required is said in text (`Input` does this).
9. **Status messages** use `role="status"` / `aria-live="polite"`; blocking errors `role="alert"`.
10. **Motion:** the global `prefers-reduced-motion` rule disables transitions; animate with CSS so it
    applies.
11. **Reflow:** no horizontal page scroll at 320px CSS width (1.4.10). Wide tables scroll inside
    their own focusable, labelled frame.
12. **Contrast:** 4.5:1 text, 3:1 large text and UI boundaries. The token set passes for
    `--color-text` / `--color-muted` on `--color-bg` and `--color-surface`; `--color-faint` is for
    non-essential text only.

A skip link ("Skip to content") is the first focusable element of the shell.

### 3.6 PWA (**Rejected**)

No manifest, service worker or install prompt for web. The installable, offline-capable, on-course
client with GPS and camera is the Expo app (SPEC §3). **Mobile:** the ERP's location and photo
rules (read location only when needed, one disclosure, never block on a denied fix; downscale and
strip EXIF before upload) are good defaults for the Expo app and are worth adopting there.

---

## 4. Tables

### 4.1 The rule (**Adopted**)

**Every table of records is filterable, by default, from its headers.** A table of records is any
list where each row is a thing: a round, a club, a course, a session, a ledger entry, a bucket.
Each header carries a sort button (its label) and a filter button (a funnel, filled when on). There
is **no filter bar above the table**; above it is only the count line ("_n_ of _m_ rows", "Clear
all filters", and an optional `controls` slot). The state is mirrored in the URL.

**Exempt** (not records, laid out rather than listed): key/value panels, fixed summary grids (the
rolling-SG "Latest" grid, the scorecard with its out/in/total), a line-item form (the sim-club →
bag-club mapping), a parser report (detected columns), charts. Exempt tables still sit in a
labelled `.table-scroll` region.

### 4.2 `FilterableTable`

`apps/web/src/components/primitives/FilterableTable.tsx`; pure rules in
`filterable-table-logic.ts` (unit-tested).

```tsx
const columns: FilterableColumn[] = [
  { key: 'date', label: 'Date', filter: 'date', phone: 'title' },
  { key: 'course', label: 'Course' }, // tick list (the default)
  { key: 'gross', label: 'Gross', filter: 'number', align: 'right' },
  { key: 'notes', label: 'Notes', filter: 'text' },
  { key: 'open', label: '', filter: false, sort: false, phone: 'actions' },
];
const rows: FilterableRow[] = rounds.map((r) => ({
  key: r.round_id,
  cells: {
    date: { text: fmtDate(r.started_at), href: `/review/${r.round_id}`, sortValue: r.started_at },
    course: { text: r.courses?.name ?? '—' },
    gross: { text: String(r.gross ?? '—'), sortValue: r.gross },
    notes: { text: r.notes ?? '—', tone: 'muted' },
    open: { text: 'Open', node: <Link href={`/review/${r.round_id}`}>Open</Link> },
  },
}));
<FilterableTable label="Rounds" columns={columns} rows={rows} emptyMessage="No rounds yet." />;
```

- **Rows are plain data built on the server.** A cell is `{ text, href?, node?, sortValue?, tone? }`.
  What is shown is what is filtered; `node` (JSX is fine from a server page, functions are not)
  replaces the rendering but `text` still names it. Never pass `''` as text — use `—`.
- **Filter kinds** (`filter`): `'enum'` (default: find box + tick list of the values present, with
  counts, Select all / Only these / Select none), `'text'` (contains, accent- and case-blind),
  `'number'` (at least / at most on the numeric `sortValue`), `'date'` (from / to on an ISO
  `sortValue`). `filter: false` only on action columns.
- **Units:** range filters compare `sortValue`, so give it **in the unit shown** — yards for yards
  columns (`metresToYards`), percent for percentages, signed yards for bias (negative = left).
- **Sorting:** clicking a header label cycles ascending → descending → the page's order; the panel
  has worded sort buttons (A to Z, Smallest to largest, Oldest to newest). Blank values sort last
  both ways. Hand rows over in the order they should read.
- **URL:** `f.<col>` (repeated), `q.<col>`, `min.<col>` / `max.<col>`, `sort=<col>:asc|desc`, each
  prefixed by `paramPrefix` when a page has several tables (the tee-strategy tables use `p4.`,
  `h7.`, …). State is read at render (`useSearchParams`) and written with `history.replaceState`,
  which Next syncs without re-running the server page.
- **`label` is required:** it names the scroll frame (`role="region"`, focusable) for screen
  readers; use the section heading's words.
- **Panel behaviour:** Escape and Done close it and return focus to the funnel; a press elsewhere
  closes it; it is positioned `fixed` next to its header so the scroll frame cannot clip it, kept
  in the viewport, and opens above when there is more room there.
- Need something it does not do (column hiding, sticky first column)? **Extend the component**;
  do not fork a private table.

### 4.3 Scroll layout and card layout

- **Scroll (default, every table):** the table scrolls sideways inside its frame and never widens
  the page. Under 768px the filter panel becomes a bottom sheet over a scrim (16px find box, 44px
  rows).
- **Cards (`phoneLayout="cards"`):** under 768px each row is a card: header row visually hidden,
  each cell a label/value line, `phone: 'title'` (exactly one) drawn bold at the top with its link
  stretched over the card, `phone: 'hide'` dropped, `phone: 'actions'` as a right-aligned row of
  44px targets. The count line gains a "Filter and sort" button that opens the sheet with the list
  of columns, then the chosen column's panel. From 768px up nothing changes. Used on the Rounds and
  Courses lists.

**Mobile:** lists in the Expo app are cards already; the same "narrow from the list itself, no
separate filter screen" principle applies (a filter chip row on the list header).

---

## 5. Dropdowns (**Adapted**: type-to-filter is the default)

`apps/web/src/components/primitives/Select.tsx`, pure matching in `select-logic.ts`.

- **Every dropdown is a `Select`**: click or focus, type, the options narrow live on **label and
  hint** (every word, any order, case- and accent-blind; label-prefix matches first). Arrows,
  Home/End, Enter to choose, Escape to close, Tab to leave. It is an ARIA 1.2 combobox with a
  listbox and `aria-activedescendant`; `name` adds a hidden input for plain form posts.
- **Pair coded lists with a `hint`** so both match: clubs show loft (`7 iron · 31°`), courses show
  round counts, feature kinds show point/area.
- **Exception:** a fixed vocabulary of **≤ 5 values inside a dense inline editor row** may stay a
  native `<select>` (the course editor's Par and Penalty). Anything longer, or any list of clubs,
  courses, holes or rounds, is a `Select`. (ERP set the line at 10+ options; CaddyMate lists are
  short, so the line moves down and the default flips.)
- The list is `position: fixed` and flips above the field when there is more room there, so it is
  never clipped by a table frame or the editor's side panel.
- When touching a native `<select>` that does not meet the exception, convert it in the same
  change.

**Mobile:** use a searchable bottom-sheet picker for clubs and courses; small enums stay segmented
controls.

---

## 6. Primitive registry (**Adopted**)

The shared primitives are the files in **`apps/web/src/components/shell/`** and
**`apps/web/src/components/primitives/`**, the nav tree in **`apps/web/src/lib/nav/`**, and the
shell, component and toolkit blocks of **`apps/web/src/app/globals.css`**. They are
**owner-edit-only**: only the repository owner edits them, or directs an agent to. Everyone else
(people and agents) composes with them from page and feature code and raises a change request
saying what is needed and why. Look here before building any shell, menu, dropdown, table, popover
or page wrapper; do not fork a private copy.

| Primitive                         | File                                          | Use                                      |
| --------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `AppShell`                        | `components/shell/AppShell.tsx`               | Mounted once in `app/layout.tsx`         |
| `TopBar`                          | `components/shell/TopBar.tsx`                 | Menu button, logo, breadcrumb, user menu |
| `LeftNav`                         | `components/shell/LeftNav.tsx`                | Rows from the nav tree                   |
| `SubNav`                          | `components/shell/SubNav.tsx`                 | Views of the active section              |
| `UserMenu`                        | `components/shell/UserMenu.tsx`               | Identity, sign out                       |
| `Icon`, `ICON_NAMES`              | `components/shell/Icon.tsx`, `icon-names.ts`  | The icon set                             |
| `useViewportTier`, tier constants | `components/shell/viewport.ts`                | Tier-dependent trees only                |
| `useNavCollapsed`                 | `components/shell/nav-collapse.ts`            | Rail collapse preference                 |
| `lockScroll`                      | `components/shell/scroll-lock.ts`             | Modal overlays on a phone                |
| `NAV_TREE` and helpers            | `lib/nav/tree.ts`                             | The one tree (§2.5)                      |
| `canSeeNavItem`                   | `lib/nav/access.ts`                           | The gating seam (§2.6)                   |
| `Page`, `PageHeader`              | `components/primitives/Page.tsx`              | Every page's wrapper, title and actions  |
| `Card`                            | `components/primitives/Card.tsx`              | Titled sections                          |
| `Button`, `ButtonLink`            | `components/primitives/Button.tsx`            | Actions / button-styled links            |
| `Input`                           | `components/primitives/Input.tsx`             | Labelled text fields with hint and error |
| `Select`                          | `components/primitives/Select.tsx`            | Every dropdown (§5)                      |
| `FilterableTable`                 | `components/primitives/FilterableTable.tsx`   | Every table of records (§4)              |
| `DesktopOnlyNotice`               | `components/primitives/DesktopOnlyNotice.tsx` | Desktop tools on a phone                 |
| `placePopover`                    | `components/primitives/anchor.ts`             | Anchored popover placement               |

Charts (`components/charts/*`) and the map wrappers (`components/map/*`) are shared too but are
feature components, not registry primitives; they follow the same "extend, don't fork" rule.

---

## 7. Checklists

### 7.1 Adding a page

1. Ask the §2.1 question. A section: add a node to `NAV_TREE` in usage order with `key`, `label`,
   `icon`, `route`, and `matchPrefixes` / `detailLabel` for detail routes; add the replica child if
   its parent now has its first child. A view: add it to the node's `views`.
2. Make the key equal the permission page key, or set `pageKey`; tell the permissions owner.
3. Build with `Page` → `PageHeader` (title, actions) → `Card`s. No `<main>`, no back link.
4. State the page class (§3.4). Layout by toolkit classes / `md:` `lg:`.
5. Tables of records: `FilterableTable` with a `label`. Dropdowns: `Select`.
6. Inputs, targets and semantics per §3.5.
7. `pnpm test` (the nav test fails if the page resolves to no key) and a manual pass at 375, 768
   and 1280px: no horizontal page scroll, drawer opens and Escape closes it, primary action visible.
8. Add the route to the compliance snapshot (§8).

### 7.2 Touching an existing page

Steps 3–7 for the parts you touch. A bare `<table>` of records you pass becomes a
`FilterableTable` in the same change; a qualifying native `<select>` becomes a `Select`.

### 7.3 Adding a view

It must keep the page's path. Add `{ key, label, value }` to the node's `views` (exactly one with
`value: null`, the default) and set `viewParam`. The page reads the view with `activeView`.

### 7.4 Changing a primitive or the shell

Owner-edit-only (§6). Verify at all three tiers, keep `tree.test.ts`, `viewport.test.ts` and the
logic tests green, and update §6 and §8 in the same change.

---

## 8. Compliance snapshot (2026-09-26)

After the change that introduced this standard. "Shell" = inside `AppShell` with breadcrumb and
no page-rendered back links; "Page" = built on `Page` / `PageHeader` / `Card`.

| Route                | Class          | Shell             | Page   | Tables                                                                     | Dropdowns                                                               | Complies | Gaps                                                                         |
| -------------------- | -------------- | ----------------- | ------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `/`                  | Tablet-capable | Yes               | Yes    | —                                                                          | —                                                                       | Yes      |                                                                              |
| `/sign-in`           | Tablet-capable | Outside by design | No     | —                                                                          | —                                                                       | Yes      | Raw inputs, not `Input` (outside the shell; low value)                       |
| `/review`            | Tablet-capable | Yes               | Yes    | Rounds: `FilterableTable`, cards on phone                                  | —                                                                       | Yes      |                                                                              |
| `/review/[roundId]`  | Tablet-capable | Yes               | Yes    | Scorecard: exempt grid in `.table-scroll`                                  | —                                                                       | Yes      | Hole picker is a tab strip (fine); record-detail tabs not used               |
| `/review/trends`     | Tablet-capable | Yes               | Yes    | Tee strategy ×N and WHS ledger: `FilterableTable`; rolling summary exempt  | Course: `Select`                                                        | Yes      | Window chips are in-page links (page state), not a view                      |
| `/clubs`             | Tablet-capable | Yes               | Yes    | Clubs: `FilterableTable`                                                   | —                                                                       | Yes      |                                                                              |
| `/clubs/[clubId]`    | Tablet-capable | Yes               | Yes    | Condition buckets: `FilterableTable`                                       | —                                                                       | Yes      | Pattern `dl` side panel stacks below `lg` (fine)                             |
| `/courses`           | Tablet-capable | Yes               | Yes    | Courses (mine + published, one table): `FilterableTable`, cards            | —                                                                       | Yes      |                                                                              |
| `/courses/new`       | Tablet-capable | Yes               | Yes    | —                                                                          | —                                                                       | Partly   | Form fields use `.input` directly, not `Input`; area choice is radios        |
| `/courses/[id]`      | Desktop-only   | Yes               | Editor | —                                                                          | —                                                                       | Yes      | Read-only editor; `DesktopOnlyNotice` on a phone                             |
| `/courses/[id]/edit` | Desktop-only   | Yes               | Editor | —                                                                          | Feature kind, new kind, hole: `Select`; Par, Penalty native (exception) | Partly   | Editor fields use `.cm-field` not `Input`; hole delete uses `window.confirm` |
| `/import`            | Tablet-capable | Yes               | Yes    | Past sessions: `FilterableTable`; detected columns and club mapping exempt | Simulator, bag club: `Select`                                           | Yes      |                                                                              |

Route handlers without UI (`/auth/callback`, `/courses/import-osm`, `/courses/maplibre/[file]`)
are out of scope.

**Backlog:** browser e2e at three tiers with axe (§1, Deferred); `Input` in the new-course form and
editor; an in-page confirmation instead of `window.confirm` in the course editor; a `/settings`
page to unlock the Settings row; record-detail tabs if the round review grows.
