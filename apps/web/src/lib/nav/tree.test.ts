import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '@/components/shell/icon-names';
import {
  NAV_TREE,
  activeTrail,
  activeView,
  breadcrumbFor,
  findNode,
  flattenNav,
  isShellless,
  menuKeyForPath,
  permissionKey,
  viewHref,
  visibleTree,
  type NavNode,
} from './tree';

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Every page route under src/app, with dynamic segments filled in. */
function appRoutes(dir = APP_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return appRoutes(p);
    if (name !== 'page.tsx') return [];
    const route = relative(APP_DIR, dir).split(sep).filter(Boolean);
    return [`/${route.map((s) => (s.startsWith('[') ? 'x1' : s)).join('/')}`];
  });
}

const keys = (trail: NavNode[]) => trail.map((n) => n.key);

describe('nav tree invariants', () => {
  const all = flattenNav(NAV_TREE);

  it('has unique, kebab-case dotted keys that extend their parent key', () => {
    expect(new Set(all.map((n) => n.key)).size).toBe(all.length);
    const walk = (nodes: readonly NavNode[], parent: string | null, depth: number) => {
      for (const n of nodes) {
        expect(n.key).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);
        if (parent) expect(n.key.startsWith(`${parent}.`)).toBe(true);
        expect(n.key.split('.')).toHaveLength(depth + 1);
        expect(depth).toBeLessThan(3);
        walk(n.children ?? [], n.key, depth + 1);
      }
    };
    walk(NAV_TREE, null, 0);
  });

  it('gives every node an absolute route, a known icon and a sentence-case label', () => {
    for (const n of all) {
      expect(n.route.startsWith('/')).toBe(true);
      expect(ICON_NAMES).toContain(n.icon);
      expect(n.label).toMatch(/^[A-Z][a-z ]*$/);
      expect(n.label.toLowerCase()).not.toContain('home');
    }
  });

  it('applies the replica-child rule to every unlocked parent', () => {
    for (const n of all.filter((x) => x.children?.length && !x.locked))
      expect(n.children!.some((c) => c.route === n.route)).toBe(true);
  });

  it('keeps views on the same URL with unique keys and exactly one default', () => {
    for (const n of all.filter((x) => x.views)) {
      expect(n.viewParam).toBeTruthy();
      expect(new Set(n.views!.map((v) => v.key)).size).toBe(n.views!.length);
      expect(n.views!.filter((v) => v.value === null)).toHaveLength(1);
    }
  });

  it('ends with Settings', () => {
    expect(NAV_TREE.at(-1)!.key).toBe('settings');
  });

  it('resolves every page route to exactly one nav key (or is shell-less / the dashboard)', () => {
    const routes = appRoutes();
    expect(routes).toContain('/review/trends');
    for (const r of routes) {
      if (isShellless(r)) continue;
      expect(menuKeyForPath(NAV_TREE, r), r).not.toBeNull();
    }
  });
});

describe('activeTrail', () => {
  it('prefers the deepest node on a shared route (replica child)', () => {
    expect(keys(activeTrail(NAV_TREE, '/review'))).toEqual(['review', 'review.list']);
  });

  it('lets the longest route win among siblings', () => {
    expect(keys(activeTrail(NAV_TREE, '/review/trends'))).toEqual(['review', 'review.trends']);
  });

  it('matches detail routes through their prefixes', () => {
    expect(keys(activeTrail(NAV_TREE, '/review/abc'))).toEqual(['review', 'review.list']);
    expect(keys(activeTrail(NAV_TREE, '/courses/abc/edit'))).toEqual(['courses']);
    expect(keys(activeTrail(NAV_TREE, '/clubs/abc'))).toEqual(['clubs']);
  });

  it('matches nothing on the dashboard, unknown paths, locked rows or a bare prefix', () => {
    expect(activeTrail(NAV_TREE, '/')).toEqual([]);
    expect(activeTrail(NAV_TREE, '/nowhere')).toEqual([]);
    expect(activeTrail(NAV_TREE, '/settings')).toEqual([]);
    expect(activeTrail(NAV_TREE, '/clubsx')).toEqual([]);
  });
});

describe('menuKeyForPath and permissionKey', () => {
  it('maps pages to permission page keys', () => {
    expect(menuKeyForPath(NAV_TREE, '/')).toBe('home');
    expect(menuKeyForPath(NAV_TREE, '/review')).toBe('review');
    expect(menuKeyForPath(NAV_TREE, '/review/123')).toBe('review');
    expect(menuKeyForPath(NAV_TREE, '/review/trends')).toBe('review.trends');
    expect(menuKeyForPath(NAV_TREE, '/import')).toBe('import');
    expect(menuKeyForPath(NAV_TREE, '/elsewhere')).toBeNull();
    expect(permissionKey({ key: 'a.b', pageKey: 'a' })).toBe('a');
  });
});

describe('visibleTree', () => {
  it('keeps everything when the seam allows everything', () => {
    expect(flattenNav(visibleTree(NAV_TREE, () => true))).toHaveLength(flattenNav(NAV_TREE).length);
  });

  it('drops hidden rows but keeps a parent for a visible child', () => {
    const t = visibleTree(NAV_TREE, (k) => k === 'review.trends');
    expect(flattenNav(t).map((n) => n.key)).toEqual(['review', 'review.trends']);
  });

  it('asks about the permission key (a replica child follows its parent page)', () => {
    const asked: string[] = [];
    visibleTree(NAV_TREE, (k) => (asked.push(k), true));
    expect(asked).not.toContain('review.list');
    expect(asked.filter((k) => k === 'review')).toHaveLength(2);
  });
});

describe('breadcrumbFor', () => {
  const crumbs = (p: string) => breadcrumbFor(NAV_TREE, p).map((c) => `${c.label}@${c.href}`);

  it('folds a replica child into its parent and adds detail segments', () => {
    expect(crumbs('/review')).toEqual(['Rounds@/review']);
    expect(crumbs('/review/r1')).toEqual(['Rounds@/review', 'Round@/review/r1']);
    expect(crumbs('/review/trends')).toEqual(['Rounds@/review', 'Trends@/review/trends']);
    expect(crumbs('/courses/c1/edit')).toEqual([
      'Courses@/courses',
      'Course@/courses/c1',
      'Edit@/courses/c1/edit',
    ]);
    expect(crumbs('/courses/new')).toEqual(['Courses@/courses', 'New@/courses/new']);
  });

  it('shows the dashboard at the root and for unknown paths', () => {
    expect(crumbs('/')).toEqual(['Dashboard@/']);
  });
});

describe('views', () => {
  const trends = findNode(NAV_TREE, 'review.trends')!;

  it('resolves the active view from the query string, defaulting when absent or unknown', () => {
    expect(activeView(trends, new URLSearchParams(''))!.key).toBe('strokes-gained');
    expect(activeView(trends, new URLSearchParams('view=course'))!.key).toBe('course');
    expect(activeView(trends, new URLSearchParams('view=bogus'))!.key).toBe('strokes-gained');
    expect(activeView(findNode(NAV_TREE, 'clubs')!, new URLSearchParams())).toBeNull();
    expect(findNode(NAV_TREE, 'nope')).toBeNull();
  });

  it('links views on the same path, keeping other parameters', () => {
    const p = new URLSearchParams('course=abc&view=handicap');
    const [sg, course] = trends.views!;
    expect(viewHref(trends, sg!, '/review/trends', p)).toBe('/review/trends?course=abc');
    expect(viewHref(trends, course!, '/review/trends', p)).toBe(
      '/review/trends?course=abc&view=course',
    );
    expect(viewHref(trends, sg!, '/review/trends', new URLSearchParams())).toBe('/review/trends');
  });
});

describe('isShellless', () => {
  it('covers sign-in and auth callbacks only', () => {
    expect(isShellless('/sign-in')).toBe(true);
    expect(isShellless('/auth/callback')).toBe(true);
    expect(isShellless('/authors')).toBe(false);
    expect(isShellless('/')).toBe(false);
  });
});
