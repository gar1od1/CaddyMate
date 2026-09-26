import * as Sentry from '@sentry/nextjs';
import { nextRuntime } from '@/lib/env';
import { initSentry } from '@/lib/sentry';

/** Next.js server start-up hook: Sentry for the Node and edge runtimes (decision 008). */
export function register(): void {
  if (nextRuntime === 'nodejs' || nextRuntime === 'edge') initSentry(nextRuntime);
}

/** Errors thrown while rendering, in route handlers, server actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
