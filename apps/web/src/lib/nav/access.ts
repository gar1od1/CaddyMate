/**
 * Nav gating and the page guard's decision (docs/standards/web-ui.md §2.6,
 * docs/standards/permissions.md §5 gates 2–3).
 *
 * Thin wrappers over the `@caddymate/api` helpers so the shell and the root
 * layout ask one module. Nav keys are the catalogue's page keys, so the key
 * the shell passes (`permissionKey(node)`) is asked about verbatim. Pure — no
 * React, no I/O — so it is unit-tested in node.
 */
import {
  PAGES,
  canOpenPath,
  canSeeNavItem as canSeePage,
  firstAccessiblePath,
  isPageKey,
  pageKeyForPath,
  type Grants,
  type PageKey,
} from '@caddymate/api';

/** Gate 2: may this nav row be shown? Missing grants and unknown keys hide. */
export function canSeeNavItem(key: string, grants: Grants | null): boolean {
  return canSeePage(key, grants);
}

/** Query parameter that carries the page a redirected user was refused (see `NoAccess`). */
export const DENIED_PARAM = 'denied';

export type PageDecision =
  | { kind: 'open' }
  /** Denied, and another page is open to the user: go there and say why. */
  | { kind: 'redirect'; page: PageKey; to: string }
  /** Denied, and nothing else is open (or the fallback is this page): explain in place. */
  | { kind: 'denied'; page: PageKey };

/**
 * Gate 3 for a signed-in request. Public and unresolved paths are open (the
 * api's fail-safe); a denied page redirects to the first page the user holds
 * with `?denied=<page>`, or is explained in place when there is none — never
 * to `/sign-in`, which would bounce a signed-in user straight back.
 */
export function decidePage(path: string, grants: Grants | null): PageDecision {
  if (canOpenPath(path, 'web', grants)) return { kind: 'open' };
  const page = pageKeyForPath(path, 'web')!;
  const to = firstAccessiblePath(grants, 'web');
  if (to === null || to === path) return { kind: 'denied', page };
  return { kind: 'redirect', page, to: `${to}?${DENIED_PARAM}=${encodeURIComponent(page)}` };
}

/** Label of a page key from a query string, or null when it is not a catalogue page. */
export function deniedPageLabel(value: string | null): string | null {
  return value && isPageKey(value) ? PAGES[value].label : null;
}
