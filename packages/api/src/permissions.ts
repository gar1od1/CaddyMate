/**
 * Roles and permissions (docs/standards/permissions.md).
 *
 * Ownership (`user_id` + RLS) is the primary boundary; roles only widen it.
 * This file is the single source of truth for the catalogue: pages, the
 * actions on them and the roles that hold each by default. The migration
 * `20260928000000_roles_permissions.sql` seeds the same rows, and
 * `packages/db/tests/fixtures/permissions.json` (generated from
 * `permissionCatalogue()`) is what both the vitest and the SQL test compare
 * against, so the three copies cannot drift.
 *
 * Keys are `<page_key>.<verb>`; the first segment of a page key is its module
 * key. Holding `<page>.view` is holding the page: an action whose page (or any
 * ancestor page) is not viewable is not effective — the same cascade as the
 * `role_effective_permission` view.
 */
import type { Db } from './client.js';

export const ROLES = ['player', 'curator', 'admin'] as const;
export type AppRole = (typeof ROLES)[number];

/** Fixed verb list. Adding one is a standards change (and a `permission_verb` enum migration). */
export const VERBS = ['view', 'write', 'refit', 'publish'] as const;
export type PermissionVerb = (typeof VERBS)[number];

export type AppSurface = 'web' | 'mobile';

export interface PageDef {
  module: string;
  label: string;
  /** Route prefixes per surface; `/` matches the root only. Detail routes ride on their list's prefix. */
  web: readonly string[];
  mobile: readonly string[];
}

/**
 * Pages in nav order. The keys ARE the web shell's nav keys (apps/web/src/lib/nav/tree.ts):
 * `module` or `module.sub_page`, two levels at most.
 */
export const PAGES = {
  dashboard: { module: 'dashboard', label: 'Dashboard', web: ['/'], mobile: ['/'] },
  rounds: { module: 'rounds', label: 'Rounds', web: [], mobile: ['/round'] },
  'rounds.review': {
    module: 'rounds',
    label: 'Review',
    web: ['/review'],
    mobile: ['/review'],
  },
  'rounds.trends': {
    module: 'rounds',
    label: 'Trends',
    web: ['/review/trends'],
    mobile: ['/review/trends'],
  },
  clubs: {
    module: 'clubs',
    label: 'Clubs',
    web: ['/clubs'],
    mobile: ['/bag', '/review/clubs'],
  },
  courses: { module: 'courses', label: 'Courses', web: ['/courses'], mobile: [] },
  import: { module: 'import', label: 'Import', web: ['/import'], mobile: [] },
} as const satisfies Record<string, PageDef>;
export type PageKey = keyof typeof PAGES;

/** Paths that need no session, per surface (sign-in and the OAuth callback). */
export const PUBLIC_PATHS: Record<AppSurface, readonly string[]> = {
  web: ['/sign-in', '/auth'],
  mobile: ['/sign-in'],
};

export interface PermissionDef {
  module: string;
  page: PageKey;
  verb: PermissionVerb;
  description: string;
  /** Roles granted this key by the seed. `admin` must hold every key. */
  roles: readonly AppRole[];
}

const EVERYONE = ['player', 'curator', 'admin'] as const;

/** The catalogue. Every key is `<page>.<verb>` and is checked somewhere (see the standard §8). */
export const PERMISSIONS = {
  'dashboard.view': {
    module: 'dashboard',
    page: 'dashboard',
    verb: 'view',
    description: 'Open the dashboard',
    roles: EVERYONE,
  },
  'rounds.view': {
    module: 'rounds',
    page: 'rounds',
    verb: 'view',
    description: 'Open the rounds section and the play screens (start, play, scorecard, summary)',
    roles: EVERYONE,
  },
  'rounds.write': {
    module: 'rounds',
    page: 'rounds',
    verb: 'write',
    description: 'Finalise a round on the server (finalise-round)',
    roles: EVERYONE,
  },
  'rounds.review.view': {
    module: 'rounds',
    page: 'rounds.review',
    verb: 'view',
    description: 'Open round review (replay, decisions, strokes gained)',
    roles: EVERYONE,
  },
  'rounds.trends.view': {
    module: 'rounds',
    page: 'rounds.trends',
    verb: 'view',
    description: 'Open trends (rolling SG, course view, WHS ledger)',
    roles: EVERYONE,
  },
  'clubs.view': {
    module: 'clubs',
    page: 'clubs',
    verb: 'view',
    description: 'Open the bag and club dispersion pages',
    roles: EVERYONE,
  },
  'clubs.refit': {
    module: 'clubs',
    page: 'clubs',
    verb: 'refit',
    description: 'Run the authoritative pattern refit (refit)',
    roles: EVERYONE,
  },
  'courses.view': {
    module: 'courses',
    page: 'courses',
    verb: 'view',
    description: 'Open the course list, course pages and the editor for own courses',
    roles: EVERYONE,
  },
  'courses.publish': {
    module: 'courses',
    page: 'courses',
    verb: 'publish',
    description: "Read, edit and publish any user's course (curation)",
    roles: ['curator', 'admin'],
  },
  'import.view': {
    module: 'import',
    page: 'import',
    verb: 'view',
    description: 'Open simulator import',
    roles: EVERYONE,
  },
  'import.write': {
    module: 'import',
    page: 'import',
    verb: 'write',
    description: 'Import a simulator session (import-sim)',
    roles: EVERYONE,
  },
} as const satisfies Record<string, PermissionDef>;
export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.hasOwn(PERMISSIONS, key);
}

export function isPageKey(key: string): key is PageKey {
  return Object.hasOwn(PAGES, key);
}

/** The page itself and every ancestor page that exists in the catalogue, root first. */
export function pageChain(page: string): PageKey[] {
  const parts = page.split('.');
  const out: PageKey[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('.');
    if (isPageKey(p)) out.push(p);
  }
  return out;
}

/**
 * Keys that are actually in force for a set of held keys: unknown keys are
 * dropped, and a key survives only while its page and every ancestor page's
 * `view` key are held. Mirrors the `role_effective_permission` view.
 */
export function effectiveKeys(held: Iterable<string>): Set<PermissionKey> {
  const set = new Set(held);
  const out = new Set<PermissionKey>();
  for (const k of set) {
    if (!isPermissionKey(k)) continue;
    if (pageChain(PERMISSIONS[k].page).every((p) => set.has(`${p}.view`))) out.add(k);
  }
  return out;
}

/** Seeded role → keys map (before the page cascade). */
export const DEFAULT_ROLE_PERMISSIONS = Object.fromEntries(
  ROLES.map((r) => [
    r,
    PERMISSION_KEYS.filter((k) => (PERMISSIONS[k].roles as readonly AppRole[]).includes(r)),
  ]),
) as Record<AppRole, PermissionKey[]>;

/** What one user may do: their role and effective keys, loaded once per request/session. */
export interface Grants {
  role: AppRole | null;
  keys: ReadonlySet<PermissionKey>;
}

/** Grants a role holds by default (the seed). Also the fail-safe fallback: `grantsForRole('player')`. */
export function grantsForRole(
  role: AppRole,
  map: Record<AppRole, readonly string[]> = DEFAULT_ROLE_PERMISSIONS,
): Grants {
  return { role, keys: effectiveKeys(map[role]) };
}

/** Pure check. Missing grants deny. */
export function can(grants: Grants | null | undefined, key: PermissionKey): boolean {
  return grants?.keys.has(key) ?? false;
}

/**
 * Nav composition (gate 2): show a nav item whose key is a page key only when
 * the user holds that page. Unknown keys are hidden.
 */
export function canSeeNavItem(navKey: string, grants: Grants | null | undefined): boolean {
  return isPageKey(navKey) && can(grants, `${navKey}.view` as PermissionKey);
}

const underPrefix = (path: string, prefix: string) =>
  prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`);

/** True when `path` needs no session on this surface. */
export function isPublicPath(path: string, surface: AppSurface): boolean {
  return PUBLIC_PATHS[surface].some((p) => underPrefix(path, p));
}

/**
 * The page a route belongs to (gate 3): the longest matching prefix wins, `/`
 * matches only the root. `null` for public or unknown paths.
 */
export function pageKeyForPath(path: string, surface: AppSurface): PageKey | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (isPublicPath(clean, surface)) return null;
  let best: PageKey | null = null;
  let bestLen = -1;
  for (const key of Object.keys(PAGES) as PageKey[]) {
    for (const prefix of PAGES[key][surface]) {
      if (underPrefix(clean, prefix) && prefix.length > bestLen) {
        best = key;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Page guard decision. Public and unresolved paths fall through (`true`): the
 * guard never locks out a route the catalogue does not know yet; the route
 * drift test is what keeps that set empty.
 */
export function canOpenPath(path: string, surface: AppSurface, grants: Grants | null): boolean {
  const page = pageKeyForPath(path, surface);
  return page === null || canSeeNavItem(page, grants);
}

/** Where to send a user who opened a page they cannot see: the first visible page, or null. */
export function firstAccessiblePath(grants: Grants | null, surface: AppSurface): string | null {
  for (const key of Object.keys(PAGES) as PageKey[]) {
    const route = PAGES[key][surface][0];
    if (route !== undefined && canSeeNavItem(key, grants)) return route;
  }
  return null;
}

/** Thrown by `requirePermission`; map it to 403 / an inline "not allowed" message. */
export class PermissionDeniedError extends Error {
  readonly code = 'forbidden';
  readonly key: PermissionKey;
  constructor(key: PermissionKey) {
    super(`Not allowed: ${key}`);
    this.name = 'PermissionDeniedError';
    this.key = key;
  }
}

/** Gate 4 for server code: throw unless the caller holds `key`. */
export function requirePermission(grants: Grants | null | undefined, key: PermissionKey): void {
  if (!can(grants, key)) throw new PermissionDeniedError(key);
}

/** One row of the `my_permissions` view (role, plus one effective key or null). */
export interface MyPermissionRow {
  role: AppRole;
  permission_key: string | null;
}

// `my_permissions` is new in 20260928000000; until database.types.ts is
// regenerated the typed client does not know it, so read it through this
// narrow structural view of the client.
interface MyPermissionsSource {
  from(view: 'my_permissions'): {
    select(columns: 'role, permission_key'): PromiseLike<{
      data: MyPermissionRow[] | null;
      error: { message: string } | null;
    }>;
  };
}

/** Grants from `my_permissions` rows (the page cascade is already applied by the view). */
export function grantsFromRows(rows: readonly MyPermissionRow[]): Grants {
  const role = rows[0]?.role ?? null;
  const keys = new Set<PermissionKey>();
  for (const r of rows)
    if (r.permission_key && isPermissionKey(r.permission_key)) keys.add(r.permission_key);
  return { role, keys };
}

/**
 * Read the signed-in user's role and effective keys in one query. No rows
 * (signed out) gives `{ role: null }` and no keys. Throws on a query error;
 * callers that must not lock anyone out fall back to `grantsForRole('player')`.
 */
export async function loadGrants(db: Db): Promise<Grants> {
  const source = db as unknown as MyPermissionsSource;
  const { data, error } = await source.from('my_permissions').select('role, permission_key');
  if (error) throw new Error(`loadGrants: ${error.message}`);
  return grantsFromRows(data ?? []);
}

/** The catalogue as plain rows: what the seed must contain (see the JSON fixture). */
export function permissionCatalogue() {
  return {
    permissions: PERMISSION_KEYS.map((k) => ({
      permission_key: k,
      module_key: PERMISSIONS[k].module,
      page_key: PERMISSIONS[k].page,
      verb: PERMISSIONS[k].verb,
      description: PERMISSIONS[k].description,
    })),
    role_permissions: Object.fromEntries(
      ROLES.map((r) => [r, [...DEFAULT_ROLE_PERMISSIONS[r]].sort()]),
    ) as Record<AppRole, string[]>,
  };
}
