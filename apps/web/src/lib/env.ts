/**
 * The web app's only reader of `process.env` (CLAUDE.md §5; `src/proxy.ts`
 * aside). `NEXT_PUBLIC_*` values are inlined at build time, so each is read
 * by its literal name.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy apps/web/.env.example to .env.local.`);
  return value;
}

/**
 * Required config. Getters: a missing value throws on first use, naming the
 * variable, so modules that only need the optional config below (Sentry, which
 * also loads in the edge runtime next to the proxy) can import this file safely.
 */
export const env = {
  get supabaseUrl(): string {
    return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
};

/**
 * Optional error reporting (docs/SPEC.md §16, decision 008). Empty DSN = Sentry
 * stays off. Build-time source-map upload reads `SENTRY_AUTH_TOKEN`,
 * `SENTRY_ORG` and `SENTRY_PROJECT` itself (Sentry's webpack plugin), not here.
 */
export const sentryConfig = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
  /** `production` on Vercel prod, `preview` on PR deploys, else `development`. */
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_VERCEL_ENV ||
    'development',
  /** Commit the bundle was built from (Vercel exposes it); tags the release. */
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
};

/** `nodejs` | `edge` on the server (set by Next per bundle), undefined in the browser. */
export const nextRuntime = process.env.NEXT_RUNTIME;
