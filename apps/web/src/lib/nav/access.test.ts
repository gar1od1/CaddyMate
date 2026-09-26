import { effectiveKeys, grantsForRole, type Grants } from '@caddymate/api';
import { describe, expect, it } from 'vitest';
import { canSeeNavItem, decidePage, deniedPageLabel } from './access';

const player = grantsForRole('player');
const only = (...keys: string[]): Grants => ({ role: 'player', keys: effectiveKeys(keys) });

describe('canSeeNavItem', () => {
  it('asks the catalogue with the request grants', () => {
    expect(canSeeNavItem('clubs', player)).toBe(true);
    expect(canSeeNavItem('rounds.trends', player)).toBe(true);
    expect(canSeeNavItem('clubs', only('dashboard.view'))).toBe(false);
    expect(canSeeNavItem('settings', player)).toBe(false);
    expect(canSeeNavItem('clubs', null)).toBe(false);
  });
});

describe('decidePage', () => {
  it('opens held, public and unresolved paths', () => {
    expect(decidePage('/review/trends', player)).toEqual({ kind: 'open' });
    expect(decidePage('/sign-in', null)).toEqual({ kind: 'open' });
    expect(decidePage('/nowhere', only())).toEqual({ kind: 'open' });
  });

  it('redirects a denied page to the first held page, naming the page', () => {
    expect(decidePage('/clubs/c1', only('dashboard.view'))).toEqual({
      kind: 'redirect',
      page: 'clubs',
      to: '/?denied=clubs',
    });
    expect(decidePage('/', only('clubs.view'))).toEqual({
      kind: 'redirect',
      page: 'dashboard',
      to: '/clubs?denied=dashboard',
    });
  });

  it('explains in place when nothing else is open', () => {
    expect(decidePage('/import', only())).toEqual({ kind: 'denied', page: 'import' });
  });
});

describe('deniedPageLabel', () => {
  it('labels catalogue pages only', () => {
    expect(deniedPageLabel('rounds.trends')).toBe('Trends');
    expect(deniedPageLabel('settings')).toBeNull();
    expect(deniedPageLabel(null)).toBeNull();
  });
});
