import { describe, expect, it } from 'vitest';
import { filterOptions, moveActive, normalise, type SelectOption } from './select-logic';

const clubs: SelectOption[] = [
  { value: 'd', label: 'Driver', hint: '10.5°' },
  { value: '3w', label: '3 wood', hint: '15°' },
  { value: '7i', label: '7 iron', hint: '31°' },
  { value: 'pw', label: 'Pitching wedge', hint: '46°' },
  { value: 'sw', label: 'Sand wedge', hint: '56°', disabled: true },
  { value: 'moy', label: 'Moyvalley Golf Clúb' },
];

const labels = (o: SelectOption[]) => o.map((x) => x.label);

describe('normalise', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalise('  Clúb   ÉIRE ')).toBe('club eire');
  });
});

describe('filterOptions', () => {
  it('returns everything for an empty query, in order', () => {
    expect(labels(filterOptions(clubs, '   '))).toEqual(labels(clubs));
  });

  it('matches label and hint, every word in any order', () => {
    expect(labels(filterOptions(clubs, 'wedge'))).toEqual(['Pitching wedge', 'Sand wedge']);
    expect(labels(filterOptions(clubs, '31'))).toEqual(['7 iron']);
    expect(labels(filterOptions(clubs, 'wedge pitch'))).toEqual(['Pitching wedge']);
    expect(filterOptions(clubs, 'putter')).toEqual([]);
  });

  it('ignores case and accents', () => {
    expect(labels(filterOptions(clubs, 'CLUB'))).toEqual(['Moyvalley Golf Clúb']);
  });

  it('puts label-prefix matches first', () => {
    const opts = [
      { value: 'a', label: 'Big iron' },
      { value: 'b', label: 'Iron man' },
    ];
    expect(labels(filterOptions(opts, 'iron'))).toEqual(['Iron man', 'Big iron']);
  });
});

describe('moveActive', () => {
  it('steps over disabled options and stops at the ends', () => {
    expect(moveActive(clubs, 3, 1)).toBe(5);
    expect(moveActive(clubs, 5, -1)).toBe(3);
    expect(moveActive(clubs, 5, 1)).toBe(5);
    expect(moveActive(clubs, 0, -1)).toBe(0);
  });

  it('enters from nothing and jumps to first / last', () => {
    expect(moveActive(clubs, -1, 1)).toBe(0);
    expect(moveActive(clubs, -1, -1)).toBe(5);
    expect(moveActive(clubs, 2, 'first')).toBe(0);
    expect(moveActive(clubs, 2, 'last')).toBe(5);
  });

  it('returns -1 when nothing is enabled', () => {
    expect(moveActive([{ value: 'x', label: 'X', disabled: true }], -1, 1)).toBe(-1);
    expect(moveActive([], -1, 'first')).toBe(-1);
  });
});
