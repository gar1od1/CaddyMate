/**
 * Caller authentication. Every request must carry the caller's Supabase JWT in
 * `Authorization: Bearer …`; it is verified against Supabase Auth and used for
 * a user-scoped client, so RLS applies to anything read on the caller's behalf.
 * The service-role client is only for the cache tables and Storage writes.
 */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, 'misconfigured', `Missing environment variable ${name}`);
  return v;
}

/** The bearer token from an `Authorization` header, or `null`. */
export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return m ? m[1]! : null;
}

export interface AuthedCaller {
  user: User;
  /** Supabase client acting as the caller (RLS applies). */
  client: SupabaseClient;
}

/** Verify the caller's JWT; throws 401 when absent or invalid. */
export async function requireUser(req: Request): Promise<AuthedCaller> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'unauthorized', 'Missing bearer token');
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized', 'Invalid or expired token');
  return { user: data.user, client };
}

let service: SupabaseClient | undefined;

/** Service-role client (bypasses RLS). Use only for weather_cache, elevation_grids and Storage. */
export function serviceClient(): SupabaseClient {
  service ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}
