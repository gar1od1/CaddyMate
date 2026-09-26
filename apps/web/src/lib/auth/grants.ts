import { grantsForRole, loadGrants, type Db, type Grants } from '@caddymate/api';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in user's grants, loaded once per request (`React.cache`
 * dedupes the root layout, pages and actions that ask again). A query error
 * falls back to the player defaults: never more than a player, never a
 * player locked out (docs/standards/permissions.md §5 gate 3). Signed out
 * gives `{ role: null }` and no keys.
 */
export const getGrants = cache(async (): Promise<Grants> => {
  const supabase = await createClient();
  try {
    return await loadGrants(supabase as unknown as Db);
  } catch {
    return grantsForRole('player');
  }
});
