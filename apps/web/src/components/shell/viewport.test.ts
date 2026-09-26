import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_MAX, TABLET_MAX, tierForWidth } from './viewport';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

describe('viewport tiers', () => {
  it('classifies widths at the boundaries', () => {
    expect(tierForWidth(320)).toBe('phone');
    expect(tierForWidth(PHONE_MAX)).toBe('phone');
    expect(tierForWidth(PHONE_MAX + 1)).toBe('tablet');
    expect(tierForWidth(TABLET_MAX)).toBe('tablet');
    expect(tierForWidth(TABLET_MAX + 1)).toBe('desktop');
  });

  it('uses exactly the same numbers as every media query in globals.css', () => {
    const widths = [...css.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].map(
      ([, kind, px]) => `${kind!}-${px!}`,
    );
    expect(widths.length).toBeGreaterThan(0);
    const allowed = new Set([
      `max-${String(PHONE_MAX)}`,
      `min-${String(PHONE_MAX + 1)}`,
      `max-${String(TABLET_MAX)}`,
      `min-${String(TABLET_MAX + 1)}`,
    ]);
    for (const w of widths) expect(allowed, w).toContain(w);
  });

  it('matches Tailwind md (768px) and lg (1024px), the only breakpoints kept', () => {
    expect(PHONE_MAX + 1).toBe(768);
    expect(TABLET_MAX + 1).toBe(1024);
    for (const bp of ['sm', 'xl', '2xl']) expect(css).toContain(`--breakpoint-${bp}: initial;`);
  });
});
