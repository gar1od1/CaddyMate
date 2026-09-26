'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort boundary for errors the root layout itself throws (it replaces
 * the layout, so it renders its own <html>). Reports to Sentry when it is
 * initialised (decision 008); a no-op otherwise.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center p-6">
        <div className="card flex max-w-md flex-col gap-3" role="alert">
          <p className="font-semibold">Something went wrong</p>
          <p className="text-muted text-sm">
            The page failed to load. Try again
            {error.digest ? `; if it keeps happening, quote ref ${error.digest}` : ''}.
          </p>
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
