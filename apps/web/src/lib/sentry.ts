import {
  CONDITION_MODEL_VERSION,
  DISPERSION_ENGINE_VERSION,
  STRATEGY_ENGINE_VERSION,
} from '@caddymate/engine';
import * as Sentry from '@sentry/nextjs';
import { sentryConfig } from '@/lib/env';

/**
 * Sentry for the web app (docs/SPEC.md §16, decision 008). Every entry point
 * (`src/instrumentation.ts` for the server and edge runtimes,
 * `src/instrumentation-client.ts` for the browser) calls {@link initSentry};
 * with no `NEXT_PUBLIC_SENTRY_DSN` it does nothing, so local dev, CI and the
 * build run without a Sentry account. Nothing here throws.
 */
export function initSentry(runtime: 'browser' | 'nodejs' | 'edge'): boolean {
  if (!sentryConfig.dsn) return false;
  try {
    Sentry.init({
      dsn: sentryConfig.dsn,
      environment: sentryConfig.environment,
      release: sentryConfig.release,
      // Errors only; no performance tracing or replays until they earn their cost.
      tracesSampleRate: 0,
      // No auto-collected user info (IP), cookies (the Supabase session), headers or bodies:
      // the user is identified by id only, via setSentryUser.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
      initialScope: {
        tags: {
          runtime,
          app: 'web',
          // The derived-row version columns (SPEC §7.6), so an error can be matched to its model.
          engine_version: DISPERSION_ENGINE_VERSION,
          strategy_engine_version: STRATEGY_ENGINE_VERSION,
          condition_model_version: CONDITION_MODEL_VERSION,
        },
      },
    });
    return true;
  } catch (err) {
    console.error('Sentry init failed', err);
    return false;
  }
}

/** Attach the signed-in user's id (never the email) to later events; `null` on sign-out. */
export function setSentryUser(userId: string | null): void {
  if (!sentryConfig.dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
