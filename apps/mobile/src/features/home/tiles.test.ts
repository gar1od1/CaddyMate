import { grantsForRole, type Grants, type PermissionKey } from '@caddymate/api';
import { describe, expect, it } from 'vitest';
import { canOpenClubDispersion, homeTiles } from './tiles';

const only = (...keys: PermissionKey[]): Grants => ({ role: 'player', keys: new Set(keys) });

describe('homeTiles', () => {
  it('shows every tile to a default player', () => {
    expect(homeTiles(grantsForRole('player'))).toEqual({
      play: true,
      bag: true,
      trends: true,
      review: true,
    });
    expect(canOpenClubDispersion(grantsForRole('player'), 'c1')).toBe(true);
  });

  it('hides tiles whose page is not held', () => {
    const t = homeTiles(only('dashboard.view', 'rounds.view', 'rounds.review.view'));
    expect(t).toEqual({ play: true, bag: false, trends: false, review: true });
    expect(canOpenClubDispersion(only('dashboard.view'), 'c1')).toBe(false);
  });

  it('keys trends and review on their own pages', () => {
    const t = homeTiles(only('dashboard.view', 'rounds.view', 'rounds.trends.view', 'clubs.view'));
    expect(t).toEqual({ play: true, bag: true, trends: true, review: false });
  });

  it('shows nothing gated without grants', () => {
    expect(homeTiles(null)).toEqual({ play: false, bag: false, trends: false, review: false });
  });
});
