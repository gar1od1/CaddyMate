/**
 * Pure parts of `Dialog` (docs/standards/web-ui.md §3.5 item 6): which
 * elements take focus, and where Tab / Shift+Tab go at the ends of the trap.
 */

/** Elements that can hold keyboard focus inside a dialog. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Index to move focus to when Tab is pressed with focus at `current` among
 * `count` focusables, or null to let the browser move it. Focus wraps from the
 * last to the first (and back with Shift); from outside the list (`current`
 * -1, e.g. the panel itself) it enters at the first or last.
 */
export function trapIndex(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}
