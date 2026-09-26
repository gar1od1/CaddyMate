'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Desktop LeftNav collapse preference, persisted per browser. When storage is
 * unavailable (private mode, blocked site data) it lives in memory for the
 * visit instead.
 */
const KEY = 'cm.nav.collapsed';
const listeners = new Set<() => void>();
let memory = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return memory;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNavCollapsed(): [boolean, (next: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // Kept in memory only.
    }
    for (const l of listeners) l();
  }, []);
  return [collapsed, set];
}
