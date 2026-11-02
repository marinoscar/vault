import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The suites came from apps/web, which runs with globals.
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
