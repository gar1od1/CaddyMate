/** JSON responses, error mapping and outbound fetch helpers shared by the Edge Functions. */
import { corsHeaders, preflight } from './cors.ts';

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
  });
}

/** `{ error: { code, message } }` with the error's status; unknown errors become an opaque 500. */
export function errorJson(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error(err);
  return json({ error: { code: 'internal', message: 'Internal error' } }, 500);
}

/** Wrap a handler with CORS preflight handling and error → JSON mapping. */
export function serveJson(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      return await handler(req);
    } catch (err) {
      return errorJson(err);
    }
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * `fetch` with a timeout. Aborts map to 504 `upstream_timeout`, network failures
 * to 502 `upstream_unreachable`; the response itself is returned as-is.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new HttpError(504, 'upstream_timeout', `Upstream timed out after ${timeoutMs} ms`);
    }
    throw new HttpError(502, 'upstream_unreachable', `Upstream request failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Throw 502 `upstream_error` (naming the host, never the query: it may hold a key) unless OK. */
export async function ensureOk(res: Response, url: string): Promise<Response> {
  if (res.ok) return res;
  const detail = (await res.text().catch(() => '')).slice(0, 200);
  throw new HttpError(
    502,
    'upstream_error',
    `${new URL(url).host} returned ${res.status}${detail ? `: ${detail}` : ''}`,
  );
}

export async function fetchJson(
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const res = await ensureOk(await fetchWithTimeout(url, {}, timeoutMs, fetchImpl), url);
  return await res.json();
}

/** Map `items` through `fn` with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Parse a finite number in [min, max] from a query/body value, or throw 400. */
export function parseCoord(value: unknown, name: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, 'bad_request', `${name} must be a number in [${min}, ${max}]`);
  }
  return n;
}
