import { describe, expect, it } from 'vitest';
import {
  courseHandicap,
  netDoubleBogey,
  playingHandicap,
  scoreDifferential,
  stablefordPoints,
  strokesReceived,
} from './scoring.js';

describe('placeholder scoring', () => {
  it('computes course and playing handicap', () => {
    // HI 13, slope 128, CR 71.2, par 72 → round(14.73 − 0.8) = 14
    expect(courseHandicap(13, 128, 71.2, 72)).toBe(14);
    expect(playingHandicap(14)).toBe(13);
  });

  it('distributes strokes by stroke index', () => {
    expect(strokesReceived(13, 1)).toBe(1);
    expect(strokesReceived(13, 13)).toBe(1);
    expect(strokesReceived(13, 14)).toBe(0);
    expect(strokesReceived(20, 2)).toBe(2);
    expect(strokesReceived(20, 3)).toBe(1);
    expect(strokesReceived(0, 1)).toBe(0);
    expect(strokesReceived(-2, 18)).toBe(-1);
    expect(strokesReceived(-2, 17)).toBe(-1);
    expect(strokesReceived(-2, 16)).toBe(0);
  });

  it('scores Stableford points', () => {
    expect(stablefordPoints(4, 4, 0)).toBe(2);
    expect(stablefordPoints(4, 5, 1)).toBe(2);
    expect(stablefordPoints(4, 3, 1)).toBe(4);
    expect(stablefordPoints(4, 9, 0)).toBe(0);
  });

  it('caps and differentials', () => {
    expect(netDoubleBogey(4, 1)).toBe(7);
    expect(scoreDifferential(85, 71.2, 128)).toBe(12.2);
  });
});
