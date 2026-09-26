'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { lockScroll } from '@/components/shell/scroll-lock';
import { placePopover, type Placement } from './anchor';
import {
  EMPTY_STATE,
  SORT_LABELS,
  activeFilterCount,
  applyTable,
  describeColumn,
  distinctValues,
  filterKindOf,
  nextSort,
  readState,
  sortKindOf,
  withFilter,
  writeState,
  type ColumnFilter,
  type FilterableColumn,
  type FilterableRow,
  type TableState,
  type Tone,
} from './filterable-table-logic';
import { normalise } from './select-logic';

export type { FilterableCell, FilterableColumn, FilterableRow } from './filterable-table-logic';

interface Props {
  /** Names the scroll frame for screen readers; use the section heading's words. */
  label: string;
  columns: FilterableColumn[];
  /** In the order they should read; the table keeps it until a header sorts. */
  rows: FilterableRow[];
  emptyMessage?: string;
  /** Keeps two tables' URL parameters apart on one page. */
  paramPrefix?: string;
  /** 'cards' draws each row as a card under 768px (phone-first tables). */
  phoneLayout?: 'scroll' | 'cards';
  /** Right of the count line: a page action or view control. Not a filter bar. */
  controls?: React.ReactNode;
  /** A visible caption above the table. */
  caption?: React.ReactNode;
  /** Totals rows (`<tr>`s) in a tfoot, outside the filter. */
  footer?: React.ReactNode;
}

/**
 * Every table of records (docs/standards/web-ui.md §4): each header sorts
 * and filters — a tick list of the values present, a contains box, or a
 * number/date range — and the state lives in the URL so a narrowed view
 * survives a refresh and can be shared. Rows are plain data (no functions),
 * so server pages build them and pass them straight in.
 */
export function FilterableTable(props: Props) {
  return (
    <Suspense fallback={<TableView {...props} state={EMPTY_STATE} setState={() => undefined} />}>
      <UrlTable {...props} />
    </Suspense>
  );
}

function UrlTable(props: Props) {
  const params = useSearchParams();
  const pathname = usePathname();
  const prefix = props.paramPrefix ?? '';
  // Read at render time (never in a mount effect) so the first paint is already narrowed.
  const state = useMemo(
    () => readState(new URLSearchParams(params.toString()), props.columns, prefix),
    [params, props.columns, prefix],
  );
  const setState = (next: TableState) => {
    const qs = writeState(
      new URLSearchParams(window.location.search),
      next,
      props.columns,
      prefix,
    ).toString();
    // Next.js syncs useSearchParams with native history calls without a server round trip.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  };
  return <TableView {...props} state={state} setState={setState} />;
}

const LIST = '__columns__';

function TableView({
  label,
  columns,
  rows,
  emptyMessage = 'Nothing here yet.',
  phoneLayout = 'scroll',
  controls,
  caption,
  footer,
  state,
  setState,
}: Props & { state: TableState; setState: (s: TableState) => void }) {
  const shown = useMemo(() => applyTable(rows, columns, state), [rows, columns, state]);
  const [panel, setPanel] = useState<{
    key: string;
    anchor: HTMLElement;
    place: Placement;
  } | null>(null);
  const cards = phoneLayout === 'cards';
  const filtered = activeFilterCount(state);

  const openPanel = (key: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setPanel({
      key,
      anchor,
      place: placePopover(
        r,
        { width: 272, height: 380 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    });
  };
  const closePanel = (restoreFocus: boolean) => {
    if (restoreFocus) panel?.anchor.focus();
    setPanel(null);
  };

  return (
    <div className="ftable">
      {caption ? <div className="text-muted text-xs">{caption}</div> : null}
      <div className="ftable-count">
        <span aria-live="polite">
          {filtered
            ? `${String(shown.length)} of ${String(rows.length)} rows`
            : `${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}`}
        </span>
        {filtered ? (
          <button
            type="button"
            className="link min-h-[var(--tap)]"
            onClick={() => setState({ ...state, filters: {} })}
          >
            Clear all filters
          </button>
        ) : null}
        {cards ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm show-sm-only"
            aria-haspopup="dialog"
            onClick={(e) => openPanel(LIST, e.currentTarget)}
          >
            <Icon name="filter" size={16} filled={filtered > 0} />
            Filter and sort{filtered ? ` (${String(filtered)})` : ''}
          </button>
        ) : null}
        {controls ? <div className="ftable-count-controls">{controls}</div> : null}
      </div>

      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className={`ftable-table ${cards ? 'ftable-cards' : ''}`}>
          <thead>
            <tr>
              {columns.map((c) => {
                const sortKind = sortKindOf(c);
                const filterKind = filterKindOf(c);
                const sorted = state.sort?.key === c.key ? state.sort.dir : null;
                const on = !!state.filters[c.key];
                return (
                  <th
                    key={c.key}
                    scope="col"
                    data-align={c.align}
                    title={c.title}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    <span className="ftable-th">
                      {sortKind ? (
                        <button
                          type="button"
                          className="ftable-sort"
                          onClick={() => setState({ ...state, sort: nextSort(state.sort, c.key) })}
                        >
                          {c.label}
                          {sorted ? (
                            <Icon name={sorted === 'asc' ? 'sort-asc' : 'sort-desc'} size={12} />
                          ) : null}
                        </button>
                      ) : (
                        <span>{c.label}</span>
                      )}
                      {filterKind || sortKind ? (
                        <button
                          type="button"
                          className="ftable-filter"
                          data-on={on || undefined}
                          aria-label={`Filter and sort ${c.label || 'column'}${on ? ' (filtered)' : ''}`}
                          aria-haspopup="dialog"
                          aria-expanded={panel?.key === c.key}
                          onClick={(e) =>
                            panel?.key === c.key
                              ? closePanel(false)
                              : openPanel(c.key, e.currentTarget)
                          }
                        >
                          <Icon name="filter" size={13} filled={on} />
                        </button>
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="ftable-empty" data-phone="title">
                  {rows.length === 0 ? emptyMessage : 'No rows match these filters.'}
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.key} className={toneClass(r.tone)}>
                  {columns.map((c) => {
                    const cell = r.cells[c.key] ?? { text: '—' };
                    const content =
                      cell.node ??
                      (cell.href ? (
                        <Link href={cell.href} className="font-semibold hover:underline">
                          {cell.text}
                        </Link>
                      ) : (
                        cell.text
                      ));
                    return (
                      <td
                        key={c.key}
                        data-align={c.align}
                        data-phone={c.phone}
                        className={toneClass(cell.tone)}
                      >
                        {cards ? (
                          <span className="ftable-cell-label" aria-hidden="true">
                            {c.label}
                          </span>
                        ) : null}
                        {cards ? <span>{content}</span> : content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>

      {panel ? (
        <FilterPanel
          key={panel.key}
          columnKey={panel.key}
          columns={columns}
          rows={rows}
          state={state}
          setState={setState}
          place={panel.place}
          anchor={panel.anchor}
          cards={cards}
          onPick={(key) => setPanel({ ...panel, key })}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}

function toneClass(tone: Tone | undefined): string {
  return tone && tone !== 'default' ? `ftable-tone-${tone}` : '';
}

/** A column's sort buttons and filter, or (phone cards) the list of columns. */
function FilterPanel({
  columnKey,
  columns,
  rows,
  state,
  setState,
  place,
  anchor,
  cards,
  onPick,
  onClose,
}: {
  columnKey: string;
  columns: FilterableColumn[];
  rows: FilterableRow[];
  state: TableState;
  setState: (s: TableState) => void;
  place: Placement;
  anchor: HTMLElement;
  cards: boolean;
  onPick: (key: string) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent((restoreFocus: boolean) => onClose(restoreFocus));
  const [find, setFind] = useState('');
  const column = columns.find((c) => c.key === columnKey) ?? null;

  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLElement>('input, button')?.focus();
    const unlock = window.matchMedia('(max-width: 767px)').matches ? lockScroll() : () => undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The opening button toggles the panel itself.
      if (!el?.contains(t) && !anchor.contains(t)) close(false);
    };
    document.addEventListener('keydown', onKey);
    // Deferred so the press that opened the panel does not close it.
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDown));
    return () => {
      unlock();
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [anchor]);

  const style = { top: place.top, bottom: place.bottom, left: place.left };
  const titleId = `ftable-panel-${columnKey}`;

  if (!column) {
    // Phone card layout: choose a column first.
    return (
      <>
        <div className="ftable-scrim" aria-hidden="true" />
        <div
          ref={ref}
          className="popover ftable-panel"
          style={style}
          role="dialog"
          aria-labelledby={titleId}
        >
          <p id={titleId} className="font-semibold">
            Filter and sort
          </p>
          <ul className="ftable-panel-list">
            {columns
              .filter((c) => filterKindOf(c) || sortKindOf(c))
              .map((c) => (
                <li key={c.key}>
                  <button type="button" className="menu-item" onClick={() => onPick(c.key)}>
                    <span className="flex-1">{c.label}</span>
                    <span className="text-muted text-xs">{describeColumn(c, state)}</span>
                  </button>
                </li>
              ))}
          </ul>
          <div className="ftable-panel-actions">
            <button type="button" className="btn btn-sm" onClick={() => onClose(true)}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  const sortKind = sortKindOf(column);
  const filterKind = filterKindOf(column);
  const current = state.filters[column.key] ?? null;
  const set = (f: ColumnFilter | null) => setState(withFilter(state, column.key, f));

  return (
    <>
      <div className="ftable-scrim" aria-hidden="true" />
      <div
        ref={ref}
        className="popover ftable-panel"
        style={style}
        role="dialog"
        aria-labelledby={titleId}
      >
        <div className="flex items-center gap-2">
          {cards ? (
            <button
              type="button"
              className="ftable-filter show-sm-only"
              aria-label="Back to columns"
              onClick={() => onPick(LIST)}
            >
              <Icon name="chevron-left" size={16} />
            </button>
          ) : null}
          <p id={titleId} className="font-semibold">
            {column.label || 'Column'}
          </p>
        </div>
        {sortKind ? (
          <div className="ftable-panel-sort">
            {(['asc', 'desc'] as const).map((dir, i) => {
              const on = state.sort?.key === column.key && state.sort.dir === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  className={`btn btn-sm ${on ? '' : 'btn-secondary'}`}
                  aria-pressed={on}
                  onClick={() => setState({ ...state, sort: on ? null : { key: column.key, dir } })}
                >
                  {SORT_LABELS[sortKind][i]}
                </button>
              );
            })}
          </div>
        ) : null}

        {filterKind === 'enum' ? (
          <EnumFilter
            rows={rows}
            columnKey={column.key}
            label={column.label}
            current={current?.kind === 'enum' ? current : null}
            find={find}
            setFind={setFind}
            set={set}
          />
        ) : filterKind === 'text' ? (
          <label className="block">
            <span className="field-label">Contains</span>
            <input
              className="input py-2 text-sm"
              value={current?.kind === 'text' ? current.query : ''}
              onChange={(e) => set({ kind: 'text', query: e.target.value })}
            />
          </label>
        ) : filterKind === 'number' || filterKind === 'date' ? (
          <div className="grid-2">
            {(['min', 'max'] as const).map((end) => (
              <label key={end} className="block">
                <span className="field-label">
                  {filterKind === 'date'
                    ? end === 'min'
                      ? 'From'
                      : 'To'
                    : end === 'min'
                      ? 'At least'
                      : 'At most'}
                </span>
                <input
                  className="input py-2 text-sm"
                  type={filterKind === 'date' ? 'date' : 'number'}
                  inputMode={filterKind === 'number' ? 'decimal' : undefined}
                  step="any"
                  value={(current?.kind === 'range' ? current[end] : null) ?? ''}
                  onChange={(e) => {
                    const prev = current?.kind === 'range' ? current : { min: null, max: null };
                    set({ kind: 'range', ...prev, [end]: e.target.value || null });
                  }}
                />
              </label>
            ))}
          </div>
        ) : null}

        <div className="ftable-panel-actions">
          {filterKind && current ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set(null)}>
              Clear
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => onClose(true)}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}

function EnumFilter({
  rows,
  columnKey,
  label,
  current,
  find,
  setFind,
  set,
}: {
  rows: FilterableRow[];
  columnKey: string;
  label: string;
  current: { kind: 'enum'; values: string[] } | null;
  find: string;
  setFind: (s: string) => void;
  set: (f: ColumnFilter | null) => void;
}) {
  const all = useMemo(() => distinctValues(rows, columnKey), [rows, columnKey]);
  const q = normalise(find);
  const visible = q ? all.filter((v) => normalise(v.value).includes(q)) : all;
  const isOn = (v: string) => !current || current.values.includes(v);

  const toggle = (v: string) => {
    const chosen = new Set(current ? current.values : all.map((x) => x.value));
    if (chosen.has(v)) chosen.delete(v);
    else chosen.add(v);
    set(chosen.size === all.length ? null : { kind: 'enum', values: [...chosen] });
  };

  return (
    <>
      <input
        className="input py-2 text-sm"
        placeholder="Find a value"
        aria-label={`Find a ${label || 'value'}`}
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          className="link"
          onClick={() => set(q ? { kind: 'enum', values: visible.map((v) => v.value) } : null)}
        >
          {q ? 'Only these' : 'Select all'}
        </button>
        <button type="button" className="link" onClick={() => set({ kind: 'enum', values: [] })}>
          Select none
        </button>
      </div>
      <ul className="ftable-panel-list" aria-label={`${label || 'Column'} values`}>
        {visible.length === 0 ? <li className="select-empty">No matching values</li> : null}
        {visible.map((v) => (
          <li key={v.value}>
            <label className="ftable-check">
              <input type="checkbox" checked={isOn(v.value)} onChange={() => toggle(v.value)} />
              <span>{v.value}</span>
              <span className="text-faint text-xs">{v.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
