import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/*.test.ts',
        'src/index.ts',
        'src/types/**',
        'vitest.config.ts',
        'eslint.config.js',
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
