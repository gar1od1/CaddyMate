/** Pure parts of the type-to-filter Select (web-ui.md §5), unit-tested. */

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown right-aligned and matched too (a code, a loft, a count). */
  hint?: string;
  disabled?: boolean;
}

/** Lower-case, accents stripped, whitespace collapsed. */
export function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Options whose label or hint contains every word of the query, in any
 * order. Options whose label starts with the query come first; otherwise the
 * caller's order is kept.
 */
export function filterOptions<T extends SelectOption>(options: readonly T[], query: string): T[] {
  const q = normalise(query);
  if (!q) return [...options];
  const words = q.split(' ');
  const hits = options.filter((o) => {
    const hay = normalise(`${o.label} ${o.hint ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
  const starts = hits.filter((o) => normalise(o.label).startsWith(q));
  return [...starts, ...hits.filter((o) => !starts.includes(o))];
}

/**
 * The next enabled option index moving by `delta` (±1), or to the first /
 * last enabled option for `'first'` / `'last'`. Stops at the ends. -1 when
 * nothing is enabled.
 */
export function moveActive(
  options: readonly SelectOption[],
  current: number,
  delta: 1 | -1 | 'first' | 'last',
): number {
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  if (enabled.length === 0) return -1;
  if (delta === 'first') return enabled[0]!;
  if (delta === 'last') return enabled.at(-1)!;
  if (current < 0) return delta === 1 ? enabled[0]! : enabled.at(-1)!;
  if (delta === 1) return enabled.find((i) => i > current) ?? enabled.at(-1)!;
  return [...enabled].reverse().find((i) => i < current) ?? enabled[0]!;
}
