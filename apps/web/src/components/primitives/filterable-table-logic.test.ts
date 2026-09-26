import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  activeFilterCount,
  applyFilters,
  applyTable,
  cellDate,
  cellNumber,
  describeColumn,
  distinctValues,
  filterKindOf,
  matchesFilter,
  nextSort,
  readState,
  sortKindOf,
  sortRows,
  withFilter,
  writeState,
  type ColumnFilter,
  type FilterableColumn,
  type FilterableRow,
  type TableState,
} from './filterable-table-logic';

const columns: FilterableColumn[] = [
  { key: 'date', label: 'Date', filter: 'date' },
  { key: 'course', label: 'Course' },
  { key: 'gross', label: 'Gross', filter: 'number', align: 'right' },
  { key: 'notes', label: 'Notes', filter: 'text' },
  { key: 'open', label: '', filter: false, sort: false },
];

const row = (key: string, date: string, course: string, gross: number | null, notes = '—') => ({
  key,
  cells: {
    date: { text: date.slice(5), sortValue: date },
    course: { text: course },
    gross: { text: gross === null ? '—' : String(gross), sortValue: gross },
    notes: { text: notes },
    open: { text: 'Open', href: `/r/${key}` },
  },
});

const rows: FilterableRow[] = [
  row('a', '2026-05-01', 'Moyvalley', 88, 'Windy, lost two balls'),
  row('b', '2026-06-12', 'Carton House', 92),
  row('c', '2026-04-20', 'Moyvalley', null),
  row('d', '2026-07-03', 'Knightsbrook', 85, 'calm'),
];

const keys = (r: FilterableRow[]) => r.map((x) => x.key);

describe('column kinds', () => {
  it('defaults filters to the tick list and sorts from the filter kind', () => {
    expect(filterKindOf(columns[1]!)).toBe('enum');
    expect(filterKindOf(columns[4]!)).toBeNull();
    expect(sortKindOf(columns[0]!)).toBe('date');
    expect(sortKindOf(columns[2]!)).toBe('number');
    expect(sortKindOf(columns[1]!)).toBe('text');
    expect(sortKindOf(columns[4]!)).toBeNull();
    expect(sortKindOf({ key: 'x', label: 'X', sort: 'number' })).toBe('number');
  });
});

describe('cell values', () => {
  it('reads numbers from sortValue or text, including signed strokes', () => {
    expect(cellNumber({ text: '—' })).toBeNull();
    expect(cellNumber({ text: '+0.42' })).toBeCloseTo(0.42);
    expect(cellNumber({ text: '−1.10' })).toBeCloseTo(-1.1);
    expect(cellNumber({ text: '12 %' })).toBe(12);
    expect(cellNumber({ text: 'x', sortValue: 7 })).toBe(7);
    expect(cellNumber({ text: 'x', sortValue: Number.NaN })).toBeNull();
  });

  it('reads ISO dates only from a string sortValue', () => {
    expect(cellDate({ text: '1 May', sortValue: '2026-05-01T09:00:00Z' })).toBe('2026-05-01');
    expect(cellDate({ text: '2026-05-01' })).toBeNull();
    expect(cellDate({ text: 'x', sortValue: 'soon' })).toBeNull();
  });
});

describe('matchesFilter', () => {
  it('enum: the cell text is one of the ticked values', () => {
    const f: ColumnFilter = { kind: 'enum', values: ['Moyvalley'] };
    expect(matchesFilter({ text: 'Moyvalley' }, f, 'enum')).toBe(true);
    expect(matchesFilter({ text: 'Carton House' }, f, 'enum')).toBe(false);
  });

  it('text: contains, ignoring case and accents', () => {
    const f = { kind: 'text', query: 'WINDY' } as const;
    expect(matchesFilter({ text: 'Windý, lost two' }, f, 'text')).toBe(true);
    expect(matchesFilter({ text: 'calm' }, f, 'text')).toBe(false);
  });

  it('range: numbers inclusive, blanks excluded once a bound is set, bad bounds ignored', () => {
    const f = { kind: 'range', min: '85', max: '88' } as const;
    expect(matchesFilter({ text: '85' }, f, 'number')).toBe(true);
    expect(matchesFilter({ text: '88' }, f, 'number')).toBe(true);
    expect(matchesFilter({ text: '89' }, f, 'number')).toBe(false);
    expect(matchesFilter({ text: '—' }, f, 'number')).toBe(false);
    expect(matchesFilter({ text: '—' }, { kind: 'range', min: null, max: null }, 'number')).toBe(
      true,
    );
    expect(matchesFilter({ text: '3' }, { kind: 'range', min: 'abc', max: null }, 'number')).toBe(
      true,
    );
  });

  it('range: dates compare on the ISO day', () => {
    const f = { kind: 'range', min: '2026-05-01', max: null } as const;
    expect(matchesFilter({ text: '', sortValue: '2026-05-01T23:00:00Z' }, f, 'date')).toBe(true);
    expect(matchesFilter({ text: '', sortValue: '2026-04-30' }, f, 'date')).toBe(false);
    expect(matchesFilter({ text: 'n/a' }, f, 'date')).toBe(false);
    expect(
      matchesFilter({ text: '', sortValue: '2026-06-01' }, { ...f, max: '2026-05-31' }, 'date'),
    ).toBe(false);
  });
});

describe('applyFilters / sortRows / applyTable', () => {
  it('combines filters across columns with AND and ignores unknown or unfilterable ones', () => {
    const s = withFilter(
      withFilter(EMPTY_STATE, 'course', { kind: 'enum', values: ['Moyvalley', 'Knightsbrook'] }),
      'gross',
      { kind: 'range', min: '80', max: null },
    );
    expect(keys(applyFilters(rows, columns, s.filters))).toEqual(['a', 'd']);
    expect(keys(applyFilters(rows, columns, { open: { kind: 'text', query: 'zzz' } }))).toEqual(
      keys(rows),
    );
    expect(keys(applyFilters(rows, columns, { nope: { kind: 'text', query: 'zzz' } }))).toEqual(
      keys(rows),
    );
  });

  it('sorts numbers and dates by value, keeps blanks last both ways, and is stable', () => {
    expect(keys(sortRows(rows, columns, { key: 'gross', dir: 'asc' }))).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(keys(sortRows(rows, columns, { key: 'gross', dir: 'desc' }))).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(keys(sortRows(rows, columns, { key: 'date', dir: 'desc' }))).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
    expect(keys(sortRows(rows, columns, { key: 'course', dir: 'asc' }))).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
    expect(keys(sortRows(rows, columns, { key: 'notes', dir: 'asc' }))).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps the page order without a sort or for an unsortable column', () => {
    expect(keys(sortRows(rows, columns, null))).toEqual(keys(rows));
    expect(keys(sortRows(rows, columns, { key: 'open', dir: 'asc' }))).toEqual(keys(rows));
  });

  it('filters then sorts', () => {
    const s: TableState = {
      filters: { course: { kind: 'enum', values: ['Moyvalley'] } },
      sort: { key: 'date', dir: 'asc' },
    };
    expect(keys(applyTable(rows, columns, s))).toEqual(['c', 'a']);
  });
});

describe('state helpers', () => {
  it('lists distinct values with counts in natural order', () => {
    expect(distinctValues(rows, 'course')).toEqual([
      { value: 'Carton House', count: 1 },
      { value: 'Knightsbrook', count: 1 },
      { value: 'Moyvalley', count: 2 },
    ]);
    expect(distinctValues([{ key: 'x', cells: {} }], 'course')).toEqual([{ value: '', count: 1 }]);
  });

  it('cycles header sorting asc → desc → page order, restarting on another column', () => {
    expect(nextSort(null, 'a')).toEqual({ key: 'a', dir: 'asc' });
    expect(nextSort({ key: 'a', dir: 'asc' }, 'a')).toEqual({ key: 'a', dir: 'desc' });
    expect(nextSort({ key: 'a', dir: 'desc' }, 'a')).toBeNull();
    expect(nextSort({ key: 'a', dir: 'desc' }, 'b')).toEqual({ key: 'b', dir: 'asc' });
  });

  it('drops empty filters and counts active ones', () => {
    let s = withFilter(EMPTY_STATE, 'notes', { kind: 'text', query: '  ' });
    expect(activeFilterCount(s)).toBe(0);
    s = withFilter(s, 'gross', { kind: 'range', min: null, max: null });
    expect(activeFilterCount(s)).toBe(0);
    s = withFilter(s, 'course', { kind: 'enum', values: [] });
    expect(activeFilterCount(s)).toBe(1);
    expect(activeFilterCount(withFilter(s, 'course', null))).toBe(0);
  });

  it('describes a column for the phone sheet', () => {
    const s: TableState = {
      filters: {
        course: { kind: 'enum', values: ['Moyvalley', 'Knightsbrook'] },
        notes: { kind: 'text', query: 'wind' },
        gross: { kind: 'range', min: '80', max: null },
      },
      sort: { key: 'course', dir: 'desc' },
    };
    expect(describeColumn(columns[1]!, s)).toBe('2 chosen · Z to A');
    expect(describeColumn(columns[3]!, s)).toBe('contains “wind”');
    expect(describeColumn(columns[2]!, s)).toBe('80 to …');
    expect(describeColumn(columns[0]!, s)).toBe('All');
  });
});

describe('URL round trip', () => {
  const state: TableState = {
    filters: {
      course: { kind: 'enum', values: ['Moyvalley', 'A|B & C'] },
      notes: { kind: 'text', query: 'wind' },
      gross: { kind: 'range', min: '80', max: null },
      date: { kind: 'range', min: null, max: '2026-06-30' },
    },
    sort: { key: 'gross', dir: 'desc' },
  };

  it('writes and reads back the same state, leaving other parameters alone', () => {
    const p = writeState(new URLSearchParams('view=course&x=1'), state, columns, 't.');
    expect(p.get('view')).toBe('course');
    expect(p.get('t.sort')).toBe('gross:desc');
    expect(readState(p, columns, 't.')).toEqual(state);
    expect(readState(p, columns)).toEqual(EMPTY_STATE);
  });

  it('clears its own keys when the state is emptied', () => {
    const p = writeState(new URLSearchParams(), state, columns);
    expect(writeState(p, EMPTY_STATE, columns).toString()).toBe('');
  });

  it('encodes "nothing chosen" and drops duplicate or empty values', () => {
    const none = writeState(
      new URLSearchParams(),
      { filters: { course: { kind: 'enum', values: [] } }, sort: null },
      columns,
    );
    expect(readState(none, columns).filters.course).toEqual({ kind: 'enum', values: [] });
    const dup = new URLSearchParams('f.course=A&f.course=A&f.course=');
    expect(readState(dup, columns).filters.course).toEqual({ kind: 'enum', values: ['A'] });
  });

  it('ignores bad sorts and filters on unfilterable columns', () => {
    for (const s of ['open:asc', 'gross:up', 'nope:asc', 'gross'])
      expect(readState(new URLSearchParams({ sort: s }), columns).sort).toBeNull();
    expect(readState(new URLSearchParams('q.open=x'), columns).filters).toEqual({});
  });
});
