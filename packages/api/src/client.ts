import type { Database } from '@caddymate/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The typed client every repository function in this package takes. */
export type Db = SupabaseClient<Database>;
