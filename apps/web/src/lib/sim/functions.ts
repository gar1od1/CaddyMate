/**
 * Calls to the `import-sim` and `refit` Edge Functions, with errors turned
 * into messages a player can act on (the function may not be deployed yet).
 */
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { SimFormat } from './parse';

export interface ImportSimRequest {
  source: SimFormat;
  csv: string;
  /** Sim club name → club_id. */
  clubAliases: Record<string, string>;
}

export interface ImportSimResponse {
  sessionId: string;
  inserted: number;
  skipped: number;
  clubsRefit: number | string[];
}

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Read `{ error }` / `{ message }` / text from a failed function response. */
async function bodyMessage(res: unknown): Promise<string | null> {
  if (!(res instanceof Response)) return null;
  try {
    const text = await res.clone().text();
    try {
      const j = JSON.parse(text) as { error?: unknown; message?: unknown };
      const m = j.error ?? j.message;
      if (typeof m === 'string') return m;
    } catch {
      // not JSON
    }
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** A player-facing message for anything `functions.invoke` returned as an error. */
export async function describeFunctionError(name: string, error: unknown): Promise<string> {
  if (error instanceof FunctionsFetchError) {
    return `Could not reach the ${name} service. Check your connection, or the function may not be deployed yet.`;
  }
  if (error instanceof FunctionsRelayError) {
    return `The ${name} service is unavailable right now (relay error). Try again in a minute.`;
  }
  if (error instanceof FunctionsHttpError) {
    const res = error.context as unknown;
    const status = res instanceof Response ? res.status : null;
    const detail = await bodyMessage(res);
    if (status === 404) {
      return `The ${name} function is not deployed on this Supabase project yet.`;
    }
    if (status === 401 || status === 403) return 'Your session has expired. Sign in again.';
    return `${name} failed${status ? ` (HTTP ${String(status)})` : ''}${detail ? `: ${detail}` : '.'}`;
  }
  if (error instanceof Error) return `${name} failed: ${error.message}`;
  return `${name} failed.`;
}

async function invoke<T>(
  client: SupabaseClient,
  name: string,
  body: object,
): Promise<FunctionResult<T>> {
  try {
    const { data, error } = await client.functions.invoke<T>(name, { body });
    if (error) return { ok: false, message: await describeFunctionError(name, error) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, message: await describeFunctionError(name, e) };
  }
}

export const importSim = (client: SupabaseClient, req: ImportSimRequest) =>
  invoke<ImportSimResponse>(client, 'import-sim', req);

export const refitClubs = (client: SupabaseClient, clubIds?: string[]) =>
  invoke<unknown>(client, 'refit', clubIds ? { clubIds } : {});
