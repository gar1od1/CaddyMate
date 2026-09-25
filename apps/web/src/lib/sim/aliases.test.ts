import { describe, expect, it } from 'vitest';
import {
  aliasUpdates,
  canonicalClubKey,
  initialMapping,
  suggestClub,
  toClubAliases,
  type AliasClub,
} from './aliases';

const club = (
  id: string,
  name: string,
  kind: string,
  loftDeg: number | null,
  aliases: string[] = [],
) => ({ id, name, kind, loftDeg, simNameAliases: aliases }) satisfies AliasClub;

const bag: AliasClub[] = [
  club('d', 'Driver', 'driver', 9),
  club('5w', '5W', 'wood', 18),
  club('4h', '4H', 'hybrid', 22, ['Hybrid 4']),
  club('7i', '7i', 'iron', 30.5),
  club('pw', 'PW', 'wedge', 44.5),
  club('50', '50°', 'wedge', 50),
  club('54', '54°', 'wedge', 54),
  club('60', '60°', 'wedge', 60),
  club('putt', 'Putter', 'putter', 3),
];

describe('canonicalClubKey', () => {
  it.each([
    ['Driver', 'driver'],
    ['DR', 'driver'],
    ['1W', 'driver'],
    ['3 Wood', '3w'],
    ['W3', '3w'],
    ['5W', '5w'],
    ['4 Hybrid', '4h'],
    ['H4', '4h'],
    ['7 Iron', '7i'],
    ['i7', '7i'],
    ['07i', '7i'],
    ['Pitching Wedge', 'pw'],
    ['GW', 'gw'],
    ['Sand Wedge', 'sw'],
    ['LW', 'lw'],
    ['56°', '56deg'],
    ['56 Wedge', '56deg'],
    ['50° ', '50deg'],
    ['Putter', 'putter'],
    ['Mystery', null],
    ['12', null],
  ])('%s → %s', (raw, key) => {
    expect(canonicalClubKey(raw)).toBe(key);
  });
});

describe('suggestClub', () => {
  it('prefers remembered aliases, then names, then canonical keys, then wedge lofts', () => {
    expect(suggestClub('hybrid 4', bag)).toEqual({ clubId: '4h', reason: 'remembered' });
    expect(suggestClub('pw', bag)).toEqual({ clubId: 'pw', reason: 'name' });
    expect(suggestClub('7 Iron', bag)).toEqual({ clubId: '7i', reason: 'matched' });
    expect(suggestClub('Driver ', bag)).toEqual({ clubId: 'd', reason: 'name' });
    expect(suggestClub('SW', bag)).toEqual({ clubId: '54', reason: 'loft' });
    expect(suggestClub('LW', bag)).toEqual({ clubId: '60', reason: 'loft' });
    expect(suggestClub('52°', bag)).toEqual({ clubId: '50', reason: 'loft' });
    expect(suggestClub('3 Wood', bag)).toBeNull();
    expect(suggestClub('Chipper', bag)).toBeNull();
  });

  it('matches lettered bag wedges without a loft from a degree sim name', () => {
    const lettered = [club('sw', 'SW', 'wedge', null)];
    expect(suggestClub('56 Wedge', lettered)).toEqual({ clubId: 'sw', reason: 'loft' });
    expect(suggestClub('46', [club('x', 'Wedge', 'wedge', null)])).toBeNull();
  });
});

describe('mapping helpers', () => {
  it('builds the initial mapping and the import payload', () => {
    const m = initialMapping(['Driver', '7 Iron', '3 Wood'], bag);
    expect(m).toEqual({ Driver: 'd', '7 Iron': '7i', '3 Wood': null });
    expect(toClubAliases(m)).toEqual({ Driver: 'd', '7 Iron': '7i' });
  });

  it('adds new aliases, moves re-mapped ones and forgets skipped ones', () => {
    const clubs = [
      club('a', '7i', 'iron', 30, ['7 Iron', 'Keep me']),
      club('b', '6i', 'iron', 27, []),
      club('c', '8i', 'iron', 34, ['8 Iron']),
    ];
    const updates = aliasUpdates(clubs, { '7 iron': 'b', '8 Iron': 'c', Old: null, Nine: 'c' });
    expect(updates).toEqual([
      { clubId: 'a', aliases: ['Keep me'] },
      { clubId: 'b', aliases: ['7 iron'] },
      { clubId: 'c', aliases: ['8 Iron', 'Nine'] },
    ]);
    expect(aliasUpdates(clubs, { '7 Iron': 'a' })).toEqual([]);
  });
});
