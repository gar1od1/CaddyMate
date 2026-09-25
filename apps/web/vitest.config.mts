import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only (pure lib code). Kept apart from Next's build: nothing under
// src/app imports vitest, and `next build` never runs this config.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
