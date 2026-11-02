import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './specs',
  // One font set, one clock, one API: nothing may flake, so nothing is retried.
  retries: 0,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Baselines live next to the specs; one folder per spec, named by test.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview --workspace=web -- --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
