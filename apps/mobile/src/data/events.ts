/**
 * Minimal change feed for the local store: every write bumps a version and
 * notifies subscribers; hooks re-run their query. Coarse but tiny — the
 * whole store is a few hundred rows.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

export function notifyChange(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const currentVersion = () => version;
