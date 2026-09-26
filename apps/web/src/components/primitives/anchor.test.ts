import { describe, expect, it } from 'vitest';
import { placePopover } from './anchor';

const vp = { width: 1000, height: 800 };
const size = { width: 200, height: 300 };

describe('placePopover', () => {
  it('opens below the anchor when it fits', () => {
    const p = placePopover({ top: 100, bottom: 130, left: 50, right: 150 }, size, vp);
    expect(p).toEqual({ top: 134, left: 50, maxHeight: 800 - 130 - 4 - 8, side: 'below' });
  });

  it('flips above when below is too short and above has more room', () => {
    const p = placePopover({ top: 700, bottom: 730, left: 50, right: 150 }, size, vp);
    expect(p.side).toBe('above');
    expect(p.bottom).toBe(800 - 700 + 4);
    expect(p.maxHeight).toBe(700 - 4 - 8);
  });

  it('stays below when neither side fits but below has more room', () => {
    const p = placePopover(
      { top: 300, bottom: 330, left: 50, right: 150 },
      { width: 200, height: 900 },
      vp,
    );
    expect(p.side).toBe('below');
  });

  it('keeps the popover inside the viewport horizontally', () => {
    expect(placePopover({ top: 0, bottom: 20, left: 950, right: 990 }, size, vp).left).toBe(792);
    expect(placePopover({ top: 0, bottom: 20, left: -40, right: 10 }, size, vp).left).toBe(8);
    expect(placePopover({ top: 0, bottom: 20, left: 600, right: 700 }, size, vp, 'end').left).toBe(
      500,
    );
  });
});
