type Result<T> = { data: T | null; error: { message: string } | null };

/** Unwrap a supabase-js result that must carry data; throws a contextual Error otherwise. */
export function must<R extends Result<unknown>>(res: R, what: string): NonNullable<R['data']> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no data`);
  return res.data;
}

/** Like `must` but a missing row is fine (maybeSingle). */
export function mustMaybe<R extends Result<unknown>>(
  res: R,
  what: string,
): NonNullable<R['data']> | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
}

/** For writes without `.select()`: only the error matters. */
export function check(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Message of anything thrown or returned as an error (supabase-js errors are loosely typed). */
export const errorMessage = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === 'object' && e !== null && 'message' in e
      ? String(e.message)
      : String(e);
