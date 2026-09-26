/**
 * docs/standards/permissions.md §6.4, the two tests:
 *   1. drift — this mirror equals packages/api/src/permissions.ts, and every
 *      route file in apps/web and apps/mobile resolves to a catalogue page (or
 *      is public);
 *   2. guards — every Edge Function handler calls `requirePermission`, bar an
 *      allowlist with a reason each (a stale entry fails too).
 */
import { assertEquals, assertThrows } from '@std/assert';
import { fromFileUrl, join, relative, SEPARATOR } from '@std/path';
import * as api from '../../../packages/api/src/permissions.ts';
import { HttpError } from './http.ts';
import * as mirror from './permissions.ts';

const REPO_ROOT = join(fromFileUrl(new URL('.', import.meta.url)), '..', '..', '..');
const FUNCTIONS_DIR = join(REPO_ROOT, 'supabase', 'functions');

Deno.test('mirror catalogue equals the api catalogue', () => {
  assertEquals(mirror.PERMISSIONS, api.PERMISSIONS);
  assertEquals([...mirror.ROLES], [...api.ROLES]);
  assertEquals([...mirror.PAGE_KEYS], Object.keys(api.PAGES));
  assertEquals(mirror.DEFAULT_ROLE_PERMISSIONS, api.DEFAULT_ROLE_PERMISSIONS);
});

Deno.test('mirror cascade, grants and checks equal the api', () => {
  const keys = api.PERMISSION_KEYS;
  // Every role, and every role with one key removed (exercises the page cascade).
  for (const role of api.ROLES) {
    const held = api.DEFAULT_ROLE_PERMISSIONS[role];
    const variants: string[][] = [held, ...held.map((k) => held.filter((x) => x !== k))];
    for (const v of variants) {
      assertEquals(mirror.effectiveKeys(v), api.effectiveKeys(v));
      const map = { ...api.DEFAULT_ROLE_PERMISSIONS, [role]: v };
      const m = mirror.grantsForRole(role, map);
      const a = api.grantsForRole(role, map);
      assertEquals(m, a);
      for (const k of keys) assertEquals(mirror.can(m, k), api.can(a, k));
    }
  }
  for (const p of ['rounds.trends', 'review', 'nope.x', 'clubs.sub']) {
    assertEquals(mirror.pageChain(p), api.pageChain(p));
  }
  const rows = [
    { role: 'curator' as const, permission_key: 'courses.publish' },
    { role: 'curator' as const, permission_key: null },
    { role: 'curator' as const, permission_key: 'gone.view' },
  ];
  assertEquals(mirror.grantsFromRows(rows), api.grantsFromRows(rows));
  assertEquals(mirror.grantsFromRows([]), api.grantsFromRows([]));
});

Deno.test('requirePermission maps a denial to 403 forbidden', () => {
  mirror.requirePermission(mirror.grantsForRole('player'), 'clubs.refit');
  const err = assertThrows(
    () => mirror.requirePermission(mirror.grantsForRole('player'), 'courses.publish'),
    HttpError,
  );
  assertEquals(
    [err.status, err.code, err.message],
    [403, 'forbidden', 'Not allowed: courses.publish'],
  );
  assertThrows(() => mirror.requirePermission(null, 'dashboard.view'), HttpError);
});

Deno.test('loadGrants reads my_permissions with the caller client', async () => {
  const seen: string[] = [];
  const client = (data: unknown, error: unknown) =>
    ({
      from: (t: string) => ({
        select: (c: string) => {
          seen.push(`${t}:${c}`);
          return Promise.resolve({ data, error });
        },
      }),
    }) as unknown as Parameters<typeof mirror.loadGrants>[0];
  const g = await mirror.loadGrants(
    client([{ role: 'player', permission_key: 'dashboard.view' }], null),
  );
  assertEquals(g, { role: 'player', keys: new Set<mirror.PermissionKey>(['dashboard.view']) });
  assertEquals(await mirror.loadGrants(client(null, null)), {
    role: null,
    keys: new Set<mirror.PermissionKey>(),
  });
  await mirror.loadGrants(client(null, { message: 'boom' })).then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: Error) => assertEquals(e.message, 'loadGrants: boom'),
  );
  assertEquals(seen[0], 'my_permissions:role, permission_key');
});

// ---------------------------------------------------------------------------
// Route drift: every page/route file of the apps resolves to a page.
// ---------------------------------------------------------------------------

function* walk(dir: string): Generator<string> {
  for (const e of Deno.readDirSync(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) yield* walk(p);
    else yield p;
  }
}

/** File path under an app router directory → a concrete URL path (dynamic segments filled in). */
function routeFor(appDir: string, file: string, surface: api.AppSurface): string | null {
  const rel = relative(appDir, file).split(SEPARATOR);
  const name = rel.pop()!;
  if (surface === 'web') {
    if (name !== 'page.tsx' && name !== 'route.ts') return null;
  } else {
    if (!name.endsWith('.tsx') || name.startsWith('_') || name.startsWith('+')) return null;
    const base = name.slice(0, -'.tsx'.length);
    if (base !== 'index') rel.push(base);
  }
  const segs = rel
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') ? 'x1' : s));
  return '/' + segs.join('/');
}

Deno.test('every app route resolves to a catalogue page or is public', () => {
  const apps: [string, api.AppSurface][] = [
    [join(REPO_ROOT, 'apps', 'web', 'src', 'app'), 'web'],
    [join(REPO_ROOT, 'apps', 'mobile', 'src', 'app'), 'mobile'],
  ];
  const unresolved: string[] = [];
  let checked = 0;
  for (const [dir, surface] of apps) {
    for (const file of walk(dir)) {
      const route = routeFor(dir, file, surface);
      if (route === null) continue;
      checked++;
      if (!api.isPublicPath(route, surface) && api.pageKeyForPath(route, surface) === null) {
        unresolved.push(`${surface} ${route} (${relative(REPO_ROOT, file)})`);
      }
    }
  }
  assertEquals(
    unresolved,
    [],
    'add a page (or a route prefix) to PAGES in packages/api/src/permissions.ts',
  );
  assertEquals(checked > 10, true, 'expected to find the app routes');
});

// ---------------------------------------------------------------------------
// Guards: every function handler checks a key.
// ---------------------------------------------------------------------------

/** Functions without an action key, and why. */
const UNGUARDED: Record<string, string> = {
  weather:
    'read-through cache of public weather for any signed-in caller; no user data, no key to check',
  elevation:
    'terrain lookups; course grids are gated by course visibility (RLS via course_elevation_extent)',
};

Deno.test('every Edge Function handler calls requirePermission (or is allowlisted)', () => {
  const missing: string[] = [];
  const stale: string[] = [];
  const dirs = [...Deno.readDirSync(FUNCTIONS_DIR)]
    .filter((e) => e.isDirectory && !e.name.startsWith('_') && e.name !== 'scripts')
    .map((e) => e.name)
    .sort();
  for (const name of dirs) {
    const src = Deno.readTextFileSync(join(FUNCTIONS_DIR, name, 'handler.ts'));
    const guarded = /\brequirePermission\(\s*grants\s*,\s*'[a-z_.]+'\s*\)/.test(src);
    if (!guarded && !(name in UNGUARDED)) missing.push(name);
    if (guarded && name in UNGUARDED) stale.push(name);
  }
  for (const name of Object.keys(UNGUARDED)) {
    if (!dirs.includes(name)) stale.push(name);
  }
  assertEquals(missing, [], 'call requirePermission(grants, <key>) right after authenticate');
  assertEquals(stale, [], 'remove the stale UNGUARDED entry');
});
