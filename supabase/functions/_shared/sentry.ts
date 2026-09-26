/**
 * Error reporting for the Edge Functions (docs/SPEC.md §16, decision 008): a
 * dependency-free client for Sentry's HTTP envelope endpoint. Off unless the
 * `SENTRY_DSN` secret is set; never throws, and gives up after a short timeout
 * so a Sentry outage cannot slow an error response by more than that.
 *
 * `SENTRY_DSN` / `SENTRY_ENVIRONMENT` are read here rather than in `auth.ts`:
 * `http.ts` imports this module and `auth.ts` imports `http.ts`, so reading
 * them there would create an import cycle.
 */
import { CONDITION_MODEL_VERSION } from './engine/conditions/model.ts';
import { DISPERSION_ENGINE_VERSION } from './engine/dispersion/types.ts';

export const SENTRY_TIMEOUT_MS = 2000;

export interface SentryDsn {
  /** `https://host[/prefix]/api/<project>/envelope/` */
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** Parse `https://<key>@<host>[/<prefix>]/<project>`; `null` when absent or malformed. */
export function parseDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return {
      envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`,
      publicKey: u.username,
      dsn,
    };
  } catch {
    return null;
  }
}

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined; // no --allow-env: reporting is simply off
  }
}

/** Function name from the request path (`/functions/v1/<name>/…` or `/<name>/…`). */
export function functionName(req: Request): string {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const i = parts[0] === 'functions' ? 2 : 0;
  return parts[i] ?? 'unknown';
}

function exceptionOf(err: unknown): { type: string; value: string; stack?: string } {
  if (err instanceof Error) return { type: err.name, value: err.message, stack: err.stack };
  return { type: 'NonError', value: String(err) };
}

/** The Sentry event for `err` thrown while serving `req` (no query string, headers or body). */
export function buildEvent(
  err: unknown,
  req: Request,
  environment: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const { type, value, stack } = exceptionOf(err);
  const url = new URL(req.url);
  return {
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: now.getTime() / 1000,
    platform: 'javascript',
    level: 'error',
    environment,
    server_name: 'supabase-edge',
    tags: {
      app: 'edge-functions',
      function: functionName(req),
      engine_version: String(DISPERSION_ENGINE_VERSION),
      condition_model_version: String(CONDITION_MODEL_VERSION),
    },
    request: { method: req.method, url: `${url.origin}${url.pathname}` },
    exception: { values: [{ type, value }] },
    // The raw stack as context: Sentry's parser needs frames, and this stays dependency-free.
    extra: stack ? { stack } : undefined,
  };
}

/** Serialise one event as a Sentry envelope (header line, item header, payload). */
export function envelope(dsn: SentryDsn, event: Record<string, unknown>, now = new Date()): string {
  const header = { event_id: event.event_id, dsn: dsn.dsn, sent_at: now.toISOString() };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}

export interface ReportDeps {
  dsn?: string;
  environment?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/**
 * Send `err` to Sentry when `SENTRY_DSN` is set. Resolves `true` when Sentry
 * accepted it, `false` when reporting is off or failed; never rejects.
 */
export async function reportError(
  err: unknown,
  req: Request,
  deps: ReportDeps = {},
): Promise<boolean> {
  const dsn = parseDsn(deps.dsn ?? readEnv('SENTRY_DSN'));
  if (!dsn) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? SENTRY_TIMEOUT_MS);
  try {
    const environment = deps.environment ?? readEnv('SENTRY_ENVIRONMENT') ?? 'production';
    const res = await (deps.fetch ?? fetch)(dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=caddymate-edge/1.0`,
      },
      body: envelope(dsn, buildEvent(err, req, environment)),
      signal: ctrl.signal,
    });
    await res.body?.cancel();
    return res.ok;
  } catch (e) {
    console.error('Sentry report failed', e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
