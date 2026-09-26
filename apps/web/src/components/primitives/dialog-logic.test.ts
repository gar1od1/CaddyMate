import { describe, expect, it } from 'vitest';
import { FOCUSABLE_SELECTOR, trapIndex } from './dialog-logic';

describe('trapIndex', () => {
  it('does nothing with no focusables', () => {
    expect(trapIndex(0, -1, false)).toBeNull();
    expect(trapIndex(0, -1, true)).toBeNull();
  });

  it('wraps from the last to the first and back', () => {
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
  });

  it('lets the browser move focus inside the list', () => {
    expect(trapIndex(3, 0, false)).toBeNull();
    expect(trapIndex(3, 1, false)).toBeNull();
    expect(trapIndex(3, 1, true)).toBeNull();
    expect(trapIndex(3, 2, true)).toBeNull();
  });

  it('enters at the first or last from outside the list', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
  });

  it('keeps focus on a single focusable', () => {
    expect(trapIndex(1, 0, false)).toBe(0);
    expect(trapIndex(1, 0, true)).toBe(0);
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  it('skips disabled controls and tabindex -1', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });
});
