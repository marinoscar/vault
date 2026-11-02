import { defineConfig } from '@playwright/test';

const PORT = 4174;

// Mocked network: the built web app plus tests/support/mock-api.ts. This suite
// proves the browser journeys; it does not exercise the real API (see
// docs/TESTING.md).
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: `npm run preview --workspace=web -- --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
