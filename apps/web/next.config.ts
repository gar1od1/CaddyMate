import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; compile them with the app.
  transpilePackages: ['@caddymate/engine', '@caddymate/db', '@caddymate/ui', '@caddymate/api'],
  // MapLibre's worker bundle, served by src/app/courses/maplibre/[file]/route.ts.
  outputFileTracingIncludes: {
    '/courses/maplibre/[file]': [
      '../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
      '../../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs',
    ],
  },
  // Workspace packages use NodeNext-style `.js` specifiers for `.ts` files.
  // Turbopack cannot resolve those, so dev/build run on webpack (see package.json).
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

// Sentry build step (decision 008): uploads source maps when SENTRY_AUTH_TOKEN,
// SENTRY_ORG and SENTRY_PROJECT are set in the build environment (Vercel), and
// skips the upload otherwise. Runtime reporting is gated separately on
// NEXT_PUBLIC_SENTRY_DSN (src/lib/sentry.ts).
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Upload client maps for all chunks (workspace packages included) and keep them off the CDN.
  widenClientFileUpload: true,
});
