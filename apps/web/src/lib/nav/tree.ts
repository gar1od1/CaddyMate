/**
 * The web app's navigation tree: one tree, read by the LeftNav (rows), the
 * SubNav (views of the deepest active section), the TopBar breadcrumb and
 * the permission seam (`menuKeyForPath`). See docs/standards/web-ui.md §2.
 *
 * Pure data and pure helpers only — no React — so it is unit-tested in node.
 */
import type { IconName } from '@/components/shell/icon-names';

/** A same-URL slice of a section, selected by one query-string value. */
export interface NavView {
  /** Unique within its node; kebab-case. */
  key: string;
  label: string;
  /** Value of the node's `viewParam`; `null` is the default view (param absent). */
  value: string | null;
}

export interface NavNode {
  /** Lower-case kebab-case, dot per level, child keys extend the parent's. */
  key: string;
  /** Sentence case; plural nouns for lists. */
  label: string;
  /** The landing page. A replica child shares its parent's route. */
  route: string;
  icon: IconName;
  /** Sub-sections: pages with their own URL. At most three levels in total. */
  children?: NavNode[];
  /** Detail / create / edit routes that belong to this section (`/clubs/`). */
  matchPrefixes?: string[];
  /** Breadcrumb label for a record one segment below the route ("Round"). */
  detailLabel?: string;
  /** Query parameter that selects a view, and the views it selects. */
  viewParam?: string;
  views?: NavView[];
  /** Announced but unbuilt: drawn as "Soon", never linked, never matched. */
  locked?: boolean;
  /**
   * The permission page this row opens, when it differs from `key`. Unused
   * today: every unlocked row's key is a catalogue page key. See `permissionKey`.
   */
  pageKey?: string;
}

/** `/` — the dashboard. Reached from the logo; never a LeftNav row. */
export const DASHBOARD = { key: 'dashboard', label: 'Dashboard', route: '/' } as const;

/**
 * Nav order is usage order: the round loop, the bag, courses, data in, Settings last.
 * Keys are the `@caddymate/api` catalogue's page keys (`PAGES`); `tree.test.ts` checks it.
 */
export const NAV_TREE: readonly NavNode[] = [
  {
    // `rounds` has no web page of its own (play is mobile-only); its row opens Review.
    key: 'rounds',
    label: 'Rounds',
    route: '/review',
    icon: 'rounds',
    children: [
      {
        // Replica child: the parent row lands here and has other children.
        key: 'rounds.review',
        label: 'Review',
        route: '/review',
        icon: 'review',
        matchPrefixes: ['/review/'],
        detailLabel: 'Round',
      },
      {
        key: 'rounds.trends',
        label: 'Trends',
        route: '/review/trends',
        icon: 'trends',
        viewParam: 'view',
        views: [
          { key: 'strokes-gained', label: 'Strokes gained', value: null },
          { key: 'course', label: 'Course view', value: 'course' },
          { key: 'handicap', label: 'Handicap', value: 'handicap' },
        ],
      },
    ],
  },
  {
    key: 'clubs',
    label: 'Clubs',
    route: '/clubs',
    icon: 'clubs',
    matchPrefixes: ['/clubs/'],
    detailLabel: 'Club',
  },
  {
    key: 'courses',
    label: 'Courses',
    route: '/courses',
    icon: 'courses',
    matchPrefixes: ['/courses/'],
    detailLabel: 'Course',
  },
  { key: 'import', label: 'Import', route: '/import', icon: 'import' },
  {
    key: 'settings',
    label: 'Settings',
    route: '/settings',
    icon: 'settings',
    locked: true,
    children: [
      {
        key: 'settings.my-settings',
        label: 'My settings',
        route: '/settings',
        icon: 'settings',
        locked: true,
      },
    ],
  },
];

/** Routes rendered without the shell (signed-out pages, auth callbacks). */
const SHELLLESS_PREFIXES = ['/sign-in', '/auth'];

export function isShellless(pathname: string): boolean {
  return SHELLLESS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Depth-first, parents before children. */
export function flattenNav(tree: readonly NavNode[]): NavNode[] {
  return tree.flatMap((n) => [n, ...flattenNav(n.children ?? [])]);
}

/**
 * The key the permission seam is asked about for a node: its `pageKey`, else
 * its own key. Nav keys equal the permission catalogue's page keys
 * (`@caddymate/api` PAGES) so the two trees read as one.
 */
export function permissionKey(node: Pick<NavNode, 'key' | 'pageKey'>): string {
  return node.pageKey ?? node.key;
}

/**
 * Keeps a node when the user may see it or any descendant (a parent stays for
 * its children). Locked rows open nothing, so they are announced to everyone
 * without asking the seam (they have no catalogue page yet).
 */
export function visibleTree(tree: readonly NavNode[], canSee: (key: string) => boolean): NavNode[] {
  return tree.flatMap((n) => {
    const children = n.children ? visibleTree(n.children, canSee) : undefined;
    if (!n.locked && !canSee(permissionKey(n)) && !children?.length) return [];
    return [{ ...n, children }];
  });
}

/** Length of the path this node claims for `pathname`, or -1. */
function matchLength(node: NavNode, pathname: string): number {
  if (node.locked) return -1;
  let best = pathname === node.route ? node.route.length : -1;
  for (const p of node.matchPrefixes ?? [])
    if (pathname.startsWith(p) && pathname.length > p.length) best = Math.max(best, p.length);
  return best;
}

/**
 * The trail from the top-level row to the deepest active node: the longest
 * route or prefix wins, and on a tie the deeper node (a replica child beats
 * its parent). Empty on the dashboard and on unknown paths.
 */
export function activeTrail(tree: readonly NavNode[], pathname: string): NavNode[] {
  let best: { trail: NavNode[]; len: number } = { trail: [], len: -1 };
  const walk = (nodes: readonly NavNode[], parents: NavNode[]) => {
    for (const n of nodes) {
      const trail = [...parents, n];
      const len = matchLength(n, pathname);
      if (len >= 0 && (len > best.len || (len === best.len && trail.length > best.trail.length)))
        best = { trail, len };
      if (n.children) walk(n.children, trail);
    }
  };
  walk(tree, []);
  return best.trail;
}

/**
 * The permission page key a path resolves to through the tree, or null for a
 * path outside it. The page guard itself uses `pageKeyForPath` from
 * `@caddymate/api`; `tree.test.ts` checks the two agree on every route.
 */
export function menuKeyForPath(tree: readonly NavNode[], pathname: string): string | null {
  if (pathname === DASHBOARD.route) return DASHBOARD.key;
  const leaf = activeTrail(tree, pathname).at(-1);
  return leaf ? permissionKey(leaf) : null;
}

export interface Crumb {
  label: string;
  href: string;
}

const SEGMENT_LABELS: Record<string, string> = { new: 'New', edit: 'Edit' };

/**
 * Breadcrumb from the URL: the active trail (a replica child that shares its
 * parent's route is folded into the parent), then one crumb per segment
 * below the matched route (`/courses/{id}/edit` → Courses › Course › Edit).
 */
export function breadcrumbFor(tree: readonly NavNode[], pathname: string): Crumb[] {
  const trail = activeTrail(tree, pathname);
  if (trail.length === 0) return [{ label: DASHBOARD.label, href: DASHBOARD.route }];
  const crumbs: Crumb[] = [];
  for (const n of trail)
    if (crumbs.at(-1)?.href !== n.route) crumbs.push({ label: n.label, href: n.route });
  const leaf = trail.at(-1)!;
  if (pathname !== leaf.route) {
    const rest = pathname.slice(leaf.route.length).split('/').filter(Boolean);
    let href = leaf.route;
    for (const seg of rest) {
      href = `${href}/${seg}`;
      crumbs.push({ label: SEGMENT_LABELS[seg] ?? leaf.detailLabel ?? 'Detail', href });
    }
  }
  return crumbs;
}

/** The view a query string selects on `node` (the default view when absent or unknown). */
export function activeView(node: NavNode, params: URLSearchParams): NavView | null {
  if (!node.views?.length || !node.viewParam) return null;
  const v = params.get(node.viewParam);
  return node.views.find((x) => x.value === v) ?? node.views.find((x) => x.value === null) ?? null;
}

/** Link to a view: same path, other query parameters kept, the view parameter set or cleared. */
export function viewHref(
  node: NavNode,
  view: NavView,
  pathname: string,
  params: URLSearchParams,
): string {
  const next = new URLSearchParams(params);
  if (view.value === null) next.delete(node.viewParam!);
  else next.set(node.viewParam!, view.value);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function findNode(tree: readonly NavNode[], key: string): NavNode | null {
  return flattenNav(tree).find((n) => n.key === key) ?? null;
}
