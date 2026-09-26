'use client';

import { useSyncExternalStore } from 'react';

/**
 * The three tiers (docs/standards/web-ui.md §3.1). The numbers also appear
 * literally in globals.css media queries (a custom property cannot be used
 * in @media); viewport.test.ts keeps the two in step. They match Tailwind's
 * `md` (768) and `lg` (1024) breakpoints, the only two the app uses.
 */
export const PHONE_MAX = 767;
export const TABLET_MAX = 1023;

export type ViewportTier = 'phone' | 'tablet' | 'desktop';

export function tierForWidth(width: number): ViewportTier {
  return width <= PHONE_MAX ? 'phone' : width <= TABLET_MAX ? 'tablet' : 'desktop';
}

const QUERIES = [`(max-width: ${PHONE_MAX}px)`, `(max-width: ${TABLET_MAX}px)`];

function subscribe(onChange: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener('change', onChange);
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange);
  };
}

/**
 * For components whose *tree* must differ by tier. Renders "desktop" on the
 * server and corrects after hydration, so what it controls must be safe to
 * flash. Prefer the CSS toolkit classes for layout.
 */
export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(
    subscribe,
    () => tierForWidth(window.innerWidth),
    () => 'desktop',
  );
}
