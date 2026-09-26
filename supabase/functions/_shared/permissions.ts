/**
 * Mirror of the pure half of packages/api/src/permissions.ts (the catalogue,
 * the page cascade, `can`) plus the Edge Function gate: `loadGrants` reads the
 * caller's `my_permissions` with their own client and `requirePermission`
 * throws HttpError(403, 'forbidden'). `permissions_test.ts` checks this copy
 * against the api. Change the api first, then this copy
 * (docs/standards/permissions.md).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export const ROLES = ['player', 'curator', 'admin'] as const;
export type AppRole = (typeof ROLES)[number];

/** Page keys in nav order (routes live in the api only: the functions have no pages). */
export const PAGE_KEYS = [
  'dashboard',
  'rounds',
  'rounds.review',
  'rounds.trends',
  'clubs',
  'courses',
  'import',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

const EVERYONE = ['player', 'curator', 'admin'] as const;

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
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.hasOwn(PERMISSIONS, key);
}

const isPageKey = (key: string): key is PageKey => (PAGE_KEYS as readonly string[]).includes(key);

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

/** Known keys whose page chain is fully viewable (the `role_effective_permission` cascade). */
export function effectiveKeys(held: Iterable<string>): Set<PermissionKey> {
  const set = new Set(held);
  const out = new Set<PermissionKey>();
  for (const k of set) {
    if (!isPermissionKey(k)) continue;
    if (pageChain(PERMISSIONS[k].page).every((p) => set.has(`${p}.view`))) {
      out.add(k);
    }
  }
  return out;
}

export const DEFAULT_ROLE_PERMISSIONS = Object.fromEntries(
  ROLES.map((r) => [
    r,
    PERMISSION_KEYS.filter((k) => (PERMISSIONS[k].roles as readonly AppRole[]).includes(r)),
  ]),
) as Record<AppRole, PermissionKey[]>;

export interface Grants {
  role: AppRole | null;
  keys: ReadonlySet<PermissionKey>;
}

export function grantsForRole(
  role: AppRole,
  map: Record<AppRole, readonly string[]> = DEFAULT_ROLE_PERMISSIONS,
): Grants {
  return { role, keys: effectiveKeys(map[role]) };
}

export function can(grants: Grants | null | undefined, key: PermissionKey): boolean {
  return grants?.keys.has(key) ?? false;
}

export interface MyPermissionRow {
  role: AppRole;
  permission_key: string | null;
}

export function grantsFromRows(rows: readonly MyPermissionRow[]): Grants {
  const role = rows[0]?.role ?? null;
  const keys = new Set<PermissionKey>();
  for (const r of rows) {
    if (r.permission_key && isPermissionKey(r.permission_key)) {
      keys.add(r.permission_key);
    }
  }
  return { role, keys };
}

/** The caller's grants, read with the caller's own (RLS) client. */
export async function loadGrants(caller: SupabaseClient): Promise<Grants> {
  const { data, error } = await caller.from('my_permissions').select('role, permission_key');
  if (error) throw new Error(`loadGrants: ${error.message}`);
  return grantsFromRows((data ?? []) as MyPermissionRow[]);
}

/** Gate 4: 403 unless the caller holds `key`. */
export function requirePermission(grants: Grants | null | undefined, key: PermissionKey): void {
  if (!can(grants, key)) {
    throw new HttpError(403, 'forbidden', `Not allowed: ${key}`);
  }
}
