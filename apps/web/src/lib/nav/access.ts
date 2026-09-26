/**
 * Nav gating seam (docs/standards/web-ui.md §2.6).
 *
 * The shell asks this one function whether a nav row may be shown, passing
 * the row's permission page key (`permissionKey(node)` in tree.ts — equal to
 * the page keys of the `@caddymate/api` permission catalogue). It returns
 * true for every key today. The permissions work (docs/standards/permissions.md)
 * replaces the body — keep the signature, so the LeftNav, the SubNav and any
 * page guard built on `menuKeyForPath` pick it up without further changes.
 */
export function canSeeNavItem(key: string): boolean {
  void key;
  return true;
}
