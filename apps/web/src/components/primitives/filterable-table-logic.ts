/**
 * Pure rules behind FilterableTable (docs/standards/web-ui.md §4): column
 * kinds, filtering, sorting and the URL encoding of a table's state. No
 * React here, so it is unit-tested in node.
 */
import type { ReactNode } from 'react';
import { normalise } from './select-logic';

/** How a column's header filters: tick list of values, contains-text, or a range. */
export type FilterKind = 'enum' | 'text' | 'number' | 'date';
export type SortKind = 'text' | 'number' | 'date';
export type Tone = 'default' | 'muted' | 'strong' | 'warning' | 'accent';

export interface FilterableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Default 'enum'. `false` only for action columns and all-distinct free text. */
  filter?: FilterKind | false;
  /** Default: from `filter` ('number'/'date'), else 'text'. `false` for action columns. */
  sort?: SortKind | false;
  /** Card layout on a phone: the card's title (exactly one), hidden, or the action row. */
  phone?: 'title' | 'hide' | 'actions';
  /** Header tooltip. */
  title?: string;
}

export interface FilterableCell {
  /** What is shown, filtered on and (without `sortValue`) sorted on. Never '' — use '—'. */
  text: string;
  href?: string;
  /** Rendered instead of `text` (a badge, a button); `text` still names it in filters. */
  node?: ReactNode;
  /** A number, or an ISO date/time string, where `text` would sort or range-filter wrongly. */
  sortValue?: number | string | null;
  tone?: Tone;
}

export interface FilterableRow {
  key: string;
  cells: Record<string, FilterableCell>;
  tone?: Tone;
}

export type ColumnFilter =
  | { kind: 'enum'; values: string[] }
  | { kind: 'text'; query: string }
  | { kind: 'range'; min: string | null; max: string | null };

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface TableState {
  filters: Record<string, ColumnFilter>;
  sort: SortState | null;
}

export const EMPTY_STATE: TableState = { filters: {}, sort: null };

export function filterKindOf(c: FilterableColumn): FilterKind | null {
  return c.filter === false ? null : (c.filter ?? 'enum');
}

export function sortKindOf(c: FilterableColumn): SortKind | null {
  if (c.sort === false) return null;
  if (c.sort) return c.sort;
  return c.filter === 'number' ? 'number' : c.filter === 'date' ? 'date' : 'text';
}

export const SORT_LABELS: Record<SortKind, [asc: string, desc: string]> = {
  text: ['A to Z', 'Z to A'],
  number: ['Smallest to largest', 'Largest to smallest'],
  date: ['Oldest to newest', 'Newest to oldest'],
};

const EMPTY_CELL: FilterableCell = { text: '' };
const cellOf = (row: FilterableRow, key: string) => row.cells[key] ?? EMPTY_CELL;

/** The cell as a number (its numeric `sortValue`, else its text parsed), or null. */
export function cellNumber(cell: FilterableCell): number | null {
  if (typeof cell.sortValue === 'number')
    return Number.isFinite(cell.sortValue) ? cell.sortValue : null;
  const n = Number.parseFloat(cell.text.replace(/[^\d.+\-−]/g, '').replace('−', '-'));
  return Number.isFinite(n) ? n : null;
}

/** The cell as an ISO date (YYYY-MM-DD) from its string `sortValue`, or null. */
export function cellDate(cell: FilterableCell): string | null {
  const v = typeof cell.sortValue === 'string' ? cell.sortValue : null;
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

export function matchesFilter(
  cell: FilterableCell,
  filter: ColumnFilter,
  kind: FilterKind,
): boolean {
  switch (filter.kind) {
    case 'enum':
      return filter.values.includes(cell.text);
    case 'text':
      return normalise(cell.text).includes(normalise(filter.query));
    case 'range': {
      if (filter.min === null && filter.max === null) return true;
      if (kind === 'date') {
        const d = cellDate(cell);
        if (d === null) return false;
        return (filter.min === null || d >= filter.min) && (filter.max === null || d <= filter.max);
      }
      const n = cellNumber(cell);
      if (n === null) return false;
      const lo = filter.min === null ? null : Number(filter.min);
      const hi = filter.max === null ? null : Number(filter.max);
      return (
        (lo === null || !Number.isFinite(lo) || n >= lo) &&
        (hi === null || !Number.isFinite(hi) || n <= hi)
      );
    }
  }
}

export function applyFilters(
  rows: readonly FilterableRow[],
  columns: readonly FilterableColumn[],
  filters: TableState['filters'],
): FilterableRow[] {
  const active = columns.flatMap((c) => {
    const f = filters[c.key];
    const kind = filterKindOf(c);
    return f && kind ? [{ key: c.key, f, kind }] : [];
  });
  if (active.length === 0) return [...rows];
  return rows.filter((r) => active.every((a) => matchesFilter(cellOf(r, a.key), a.f, a.kind)));
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Compare two cells for `kind`; empty values sort last in both directions (handled by caller). */
function sortKey(cell: FilterableCell, kind: SortKind): number | string | null {
  if (kind === 'number') return cellNumber(cell);
  if (kind === 'date')
    return typeof cell.sortValue === 'string' && cell.sortValue ? cell.sortValue : null;
  const t = typeof cell.sortValue === 'string' ? cell.sortValue : cell.text;
  return t === '' || t === '—' ? null : t;
}

/** Stable sort by one column; rows without a value stay at the end either way. */
export function sortRows(
  rows: readonly FilterableRow[],
  columns: readonly FilterableColumn[],
  sort: SortState | null,
): FilterableRow[] {
  const col = sort && columns.find((c) => c.key === sort.key);
  const kind = col ? sortKindOf(col) : null;
  if (!sort || !kind) return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: sortKey(cellOf(r, sort.key), kind) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const d =
        typeof a.k === 'number' && typeof b.k === 'number'
          ? a.k - b.k
          : collator.compare(String(a.k), String(b.k));
      return d === 0 ? a.i - b.i : sign * d;
    })
    .map((x) => x.r);
}

export function applyTable(
  rows: readonly FilterableRow[],
  columns: readonly FilterableColumn[],
  state: TableState,
): FilterableRow[] {
  return sortRows(applyFilters(rows, columns, state.filters), columns, state.sort);
}

/** Distinct texts of a column with counts, in natural order. */
export function distinctValues(
  rows: readonly FilterableRow[],
  key: string,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const t = cellOf(r, key).text;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => collator.compare(a.value, b.value));
}

/** Header-label clicks cycle: ascending, descending, the page's own order. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

export function activeFilterCount(state: TableState): number {
  return Object.keys(state.filters).length;
}

/** Sets or clears one column's filter; filters that select everything are dropped. */
export function withFilter(
  state: TableState,
  key: string,
  filter: ColumnFilter | null,
): TableState {
  const filters = { ...state.filters };
  const empty =
    filter === null ||
    (filter.kind === 'text' && filter.query.trim() === '') ||
    (filter.kind === 'range' && filter.min === null && filter.max === null);
  if (empty) delete filters[key];
  else filters[key] = filter;
  return { ...state, filters };
}

/** "2 chosen · A to Z" — the phone sheet's summary of one column. */
export function describeColumn(c: FilterableColumn, state: TableState): string {
  const parts: string[] = [];
  const f = state.filters[c.key];
  if (f?.kind === 'enum') parts.push(`${String(f.values.length)} chosen`);
  if (f?.kind === 'text') parts.push(`contains “${f.query}”`);
  if (f?.kind === 'range') parts.push([f.min ?? '…', f.max ?? '…'].join(' to '));
  const kind = sortKindOf(c);
  if (state.sort?.key === c.key && kind)
    parts.push(SORT_LABELS[kind][state.sort.dir === 'asc' ? 0 : 1]);
  return parts.join(' · ') || 'All';
}

// --- URL ---------------------------------------------------------------------

/**
 * State ↔ query string, so a narrowed table survives a refresh and can be
 * shared. Keys: `<prefix>f.<col>` (repeated, enum), `<prefix>q.<col>` (text),
 * `<prefix>min.<col>` / `<prefix>max.<col>` (range), `<prefix>sort=<col>:asc|desc`.
 */
export function readState(
  params: URLSearchParams,
  columns: readonly FilterableColumn[],
  prefix = '',
): TableState {
  const filters: TableState['filters'] = {};
  for (const c of columns) {
    const kind = filterKindOf(c);
    if (!kind) continue;
    if (kind === 'enum') {
      if (params.has(`${prefix}f.${c.key}`))
        filters[c.key] = {
          kind: 'enum',
          values: params
            .getAll(`${prefix}f.${c.key}`)
            .filter((v, i, a) => v !== '' && a.indexOf(v) === i),
        };
    } else if (kind === 'text') {
      const q = params.get(`${prefix}q.${c.key}`);
      if (q) filters[c.key] = { kind: 'text', query: q };
    } else {
      const min = params.get(`${prefix}min.${c.key}`) || null;
      const max = params.get(`${prefix}max.${c.key}`) || null;
      if (min !== null || max !== null) filters[c.key] = { kind: 'range', min, max };
    }
  }
  let sort: SortState | null = null;
  const s = params.get(`${prefix}sort`);
  if (s) {
    const i = s.lastIndexOf(':');
    const key = s.slice(0, i);
    const dir = s.slice(i + 1);
    const col = columns.find((c) => c.key === key);
    if (col && sortKindOf(col) && (dir === 'asc' || dir === 'desc')) sort = { key, dir };
  }
  return { filters, sort };
}

/** A copy of `params` with this table's keys replaced by `state`; other keys untouched. */
export function writeState(
  params: URLSearchParams,
  state: TableState,
  columns: readonly FilterableColumn[],
  prefix = '',
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const c of columns)
    for (const p of ['f.', 'q.', 'min.', 'max.']) next.delete(`${prefix}${p}${c.key}`);
  next.delete(`${prefix}sort`);
  for (const [key, f] of Object.entries(state.filters)) {
    if (f.kind === 'enum') {
      // An empty tick list still needs a key to mean "nothing chosen".
      if (f.values.length === 0) next.append(`${prefix}f.${key}`, '');
      for (const v of f.values) next.append(`${prefix}f.${key}`, v);
    } else if (f.kind === 'text') next.set(`${prefix}q.${key}`, f.query);
    else {
      if (f.min !== null) next.set(`${prefix}min.${key}`, f.min);
      if (f.max !== null) next.set(`${prefix}max.${key}`, f.max);
    }
  }
  if (state.sort) next.set(`${prefix}sort`, `${state.sort.key}:${state.sort.dir}`);
  return next;
}
