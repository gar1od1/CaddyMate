import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/client';
import { initSentry, setSentryUser } from '@/lib/sentry';

// Browser start-up hook (runs before hydration). Sentry, when a DSN is set (decision 008).
if (initSentry('browser')) {
  try {
    // Tag browser events with the signed-in user's id (not email) as the session changes.
    createClient().auth.onAuthStateChange((_event, session) => {
      setSentryUser(session?.user.id ?? null);
    });
  } catch {
    // Missing Supabase config: the app reports it itself (src/lib/env.ts); stay quiet here.
  }
}

/** Soft navigations become breadcrumbs / navigation spans. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
