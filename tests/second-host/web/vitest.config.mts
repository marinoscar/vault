import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Host Beta's web smoke test: jsdom, MSW for the API, the built @marinoscar/vault-web.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
