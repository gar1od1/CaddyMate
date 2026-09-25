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

export default nextConfig;
