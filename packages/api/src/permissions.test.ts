import { describe, expect, it } from 'vitest';
import fixture from '../../db/tests/fixtures/permissions.json';
import {
  can,
  canOpenPath,
  canSeeNavItem,
  DEFAULT_ROLE_PERMISSIONS,
  effectiveKeys,
  firstAccessiblePath,
  grantsForRole,
  grantsFromRows,
  isPublicPath,
  loadGrants,
  pageChain,
  pageKeyForPath,
  PAGES,
  PERMISSION_KEYS,
  permissionCatalogue,
  PERMISSIONS,
  PermissionDeniedError,
  requirePermission,
  ROLES,
  VERBS,
  type Grants,
  type PageKey,
} from './permissions.js';
import { FakeDb } from './testing/fakeDb.js';

const player = grantsForRole('player');
const curator = grantsForRole('curator');
const admin = grantsForRole('admin');
const none: Grants = { role: null, keys: new Set() };

describe('catalogue', () => {
  it('matches the JSON fixture the SQL test checks the seed against', () => {
    // Out of date? Regenerate it (docs/standards/permissions.md §7.3, step 3).
    expect(permissionCatalogue()).toEqual(fixture);
  });

  it('keys are <page>.<verb>, pages exist, modules are the first page segment', () => {
    for (const k of PERMISSION_KEYS) {
      const p = PERMISSIONS[k];
      expect(k).toBe(`${p.page}.${p.verb}`);
      expect(k).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*){1,2}$/);
      expect(VERBS).toContain(p.verb);
      expect(p.module).toBe(p.page.split('.')[0]);
      expect(PAGES[p.page].module).toBe(p.module);
    }
  });

  it('every page has exactly one view key and its parent pages exist', () => {
    for (const page of Object.keys(PAGES) as PageKey[]) {
      expect(PERMISSION_KEYS.filter((k) => k === `${page}.view`)).toHaveLength(1);
      expect(page.split('.').length).toBeLessThanOrEqual(2);
      expect(pageChain(page).at(-1)).toBe(page);
      expect(pageChain(page)).toHaveLength(page.split('.').length);
    }
  });

  it('admin holds every key; curator ⊇ player; only curation separates them', () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.admin)).toEqual(new Set(PERMISSION_KEYS));
    expect([...admin.keys].sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const k of player.keys) expect(curator.keys.has(k)).toBe(true);
    expect([...curator.keys].filter((k) => !player.keys.has(k))).toEqual(['courses.publish']);
    expect(ROLES).toEqual(['player', 'curator', 'admin']);
  });

  it('players hold the keys the Edge Functions check', () => {
    for (const k of ['rounds.write', 'clubs.refit', 'import.write'] as const) {
      expect(can(player, k)).toBe(true);
    }
    expect(can(player, 'courses.publish')).toBe(false);
  });
});

describe('page cascade', () => {
  it('switching a page off revokes its actions', () => {
    const held = DEFAULT_ROLE_PERMISSIONS.player.filter((k) => k !== 'clubs.view');
    const eff = effectiveKeys(held);
    expect(eff.has('clubs.refit')).toBe(false);
    expect(eff.has('import.write')).toBe(true);
  });

  it('switching a parent page off revokes its sub-pages', () => {
    const eff = effectiveKeys(DEFAULT_ROLE_PERMISSIONS.player.filter((k) => k !== 'rounds.view'));
    for (const k of ['rounds.review.view', 'rounds.trends.view', 'rounds.write'] as const) {
      expect(eff.has(k)).toBe(false);
    }
    // A sibling sub-page is independent.
    const noReview = DEFAULT_ROLE_PERMISSIONS.player.filter((k) => k !== 'rounds.review.view');
    expect(effectiveKeys(noReview).has('rounds.trends.view')).toBe(true);
    expect(effectiveKeys(['rounds.trends.view']).size).toBe(0);
  });

  it('drops unknown keys and honours a custom role map', () => {
    expect([...effectiveKeys(['dashboard.view', 'nope.view', 'dashboard'])]).toEqual([
      'dashboard.view',
    ]);
    const g = grantsForRole('curator', { ...DEFAULT_ROLE_PERMISSIONS, curator: ['courses.view'] });
    expect([...g.keys]).toEqual(['courses.view']);
    expect(g.role).toBe('curator');
  });
});

describe('checks', () => {
  it('can / canSeeNavItem', () => {
    expect(can(null, 'dashboard.view')).toBe(false);
    expect(can(undefined, 'dashboard.view')).toBe(false);
    expect(can(player, 'dashboard.view')).toBe(true);
    expect(canSeeNavItem('rounds.trends', player)).toBe(true);
    expect(canSeeNavItem('rounds', player)).toBe(true);
    expect(canSeeNavItem('courses', none)).toBe(false);
    expect(canSeeNavItem('settings', admin)).toBe(false);
    expect(canSeeNavItem('settings.my-settings', admin)).toBe(false);
    expect(canSeeNavItem('courses', null)).toBe(false);
  });

  it('requirePermission throws a typed error', () => {
    expect(() => {
      requirePermission(curator, 'courses.publish');
    }).not.toThrow();
    try {
      requirePermission(player, 'courses.publish');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDeniedError);
      expect((e as PermissionDeniedError).key).toBe('courses.publish');
      expect((e as PermissionDeniedError).code).toBe('forbidden');
      expect((e as Error).message).toBe('Not allowed: courses.publish');
    }
    expect(() => {
      requirePermission(null, 'dashboard.view');
    }).toThrow(PermissionDeniedError);
  });
});

describe('routes', () => {
  // Every route of apps/web and apps/mobile today; the Deno route test walks the
  // app directories and checks the same resolution for the files on disk.
  const WEB: [string, PageKey | null][] = [
    ['/', 'dashboard'],
    ['/sign-in', null],
    ['/auth/callback', null],
    ['/review', 'rounds.review'],
    ['/review/0b7c', 'rounds.review'],
    ['/review/trends', 'rounds.trends'],
    ['/review/trends/', 'rounds.trends'],
    ['/clubs', 'clubs'],
    ['/clubs/abc', 'clubs'],
    ['/import', 'import'],
    ['/courses', 'courses'],
    ['/courses/new', 'courses'],
    ['/courses/abc/edit', 'courses'],
    ['/courses/import-osm', 'courses'],
    ['/unknown', null],
    ['/importer', null],
  ];
  const MOBILE: [string, PageKey | null][] = [
    ['/', 'dashboard'],
    ['/sign-in', null],
    ['/bag', 'clubs'],
    ['/round/new', 'rounds'],
    ['/round/r1', 'rounds'],
    ['/round/r1/scorecard', 'rounds'],
    ['/review/r1', 'rounds.review'],
    ['/review/trends', 'rounds.trends'],
    ['/review/clubs/c1', 'clubs'],
    ['/courses', null],
  ];

  it('resolves every route to its page (longest prefix, root exact)', () => {
    for (const [path, page] of WEB)
      expect([path, pageKeyForPath(path, 'web')]).toEqual([path, page]);
    for (const [path, page] of MOBILE)
      expect([path, pageKeyForPath(path, 'mobile')]).toEqual([path, page]);
    expect(isPublicPath('/auth/callback', 'web')).toBe(true);
    expect(isPublicPath('/auth', 'mobile')).toBe(false);
  });

  it('canOpenPath guards known pages and falls through for public/unknown paths', () => {
    const noClubs = {
      role: 'player' as const,
      keys: effectiveKeys(['dashboard.view', 'rounds.view', 'rounds.review.view']),
    };
    expect(canOpenPath('/clubs/x', 'web', noClubs)).toBe(false);
    expect(canOpenPath('/review/x', 'web', noClubs)).toBe(true);
    expect(canOpenPath('/sign-in', 'web', none)).toBe(true);
    expect(canOpenPath('/whatever', 'web', none)).toBe(true);
    expect(canOpenPath('/', 'mobile', null)).toBe(false);
  });

  it('firstAccessiblePath picks the first visible page with a route on the surface', () => {
    expect(firstAccessiblePath(player, 'web')).toBe('/');
    const onlyImport = { role: 'player' as const, keys: effectiveKeys(['import.view']) };
    expect(firstAccessiblePath(onlyImport, 'web')).toBe('/import');
    expect(firstAccessiblePath(onlyImport, 'mobile')).toBeNull();
    const onlyRounds = { role: 'player' as const, keys: effectiveKeys(['rounds.view']) };
    expect(firstAccessiblePath(onlyRounds, 'mobile')).toBe('/round');
    expect(firstAccessiblePath(none, 'web')).toBeNull();
  });
});

describe('loadGrants', () => {
  it('reads role and effective keys from my_permissions', async () => {
    const db = new FakeDb({
      my_permissions: [
        { role: 'curator', permission_key: 'courses.publish' },
        { role: 'curator', permission_key: 'dashboard.view' },
        { role: 'curator', permission_key: 'legacy.key' },
      ],
    });
    const g = await loadGrants(db.asDb());
    expect(g.role).toBe('curator');
    expect([...g.keys].sort()).toEqual(['courses.publish', 'dashboard.view']);
    expect(db.log).toEqual([{ table: 'my_permissions', op: 'select' }]);
  });

  it('a role with no keys and a signed-out caller hold nothing', async () => {
    expect(grantsFromRows([{ role: 'player', permission_key: null }])).toEqual({
      role: 'player',
      keys: new Set(),
    });
    expect(await loadGrants(new FakeDb().asDb())).toEqual({ role: null, keys: new Set() });
  });

  it('throws on a query error', async () => {
    const db = {
      from: () => ({
        select: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
    };
    await expect(loadGrants(db as never)).rejects.toThrow('loadGrants: boom');
  });
});
