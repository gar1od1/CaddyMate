import {
  CONDITION_MODEL_VERSION,
  DISPERSION_ENGINE_VERSION,
  STRATEGY_ENGINE_VERSION,
} from '@caddymate/engine';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import type { ComponentType } from 'react';
import { env } from './env';

/**
 * Sentry for the app (docs/SPEC.md §16, decision 008). Off unless
 * `EXPO_PUBLIC_SENTRY_DSN` is set, and never throws: a failed init is logged
 * and the app carries on (CLAUDE.md §5 — CI's `expo export` runs without a .env).
 */
let enabled = false;

/** Initialise once, at module scope of the root layout. Returns whether Sentry is on. */
export function initSentry(): boolean {
  if (enabled || !env.sentryDsn) return enabled;
  try {
    Sentry.init({
      dsn: env.sentryDsn,
      environment: env.sentryEnvironment || (__DEV__ ? 'development' : 'production'),
      // Errors and native crashes only; no tracing or replays for now.
      tracesSampleRate: 0,
      // No IP or device-identifying defaults; the user is identified by id only.
      sendDefaultPii: false,
      initialScope: {
        tags: {
          app: 'mobile',
          app_version: Constants.expoConfig?.version ?? 'unknown',
          // The derived-row version columns (SPEC §7.6), so an error can be matched to its model.
          engine_version: DISPERSION_ENGINE_VERSION,
          strategy_engine_version: STRATEGY_ENGINE_VERSION,
          condition_model_version: CONDITION_MODEL_VERSION,
        },
      },
    });
    enabled = true;
  } catch (err) {
    console.warn('Sentry init failed', err);
  }
  return enabled;
}

/** Wrap the root component (touch breadcrumbs, error boundary) when Sentry is on; else as-is. */
export function withSentry<P extends Record<string, unknown>>(
  Root: ComponentType<P>,
): ComponentType<P> {
  return enabled ? Sentry.wrap(Root) : Root;
}

/** Attach the signed-in user's id (never the email) to later events; `null` on sign-out. */
export function setSentryUser(userId: string | null): void {
  if (enabled) Sentry.setUser(userId ? { id: userId } : null);
}
