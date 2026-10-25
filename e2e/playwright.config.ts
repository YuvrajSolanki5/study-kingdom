import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the local stack:
 *   npm run db:start            (Supabase: Postgres, Auth, Mailpit)
 *   npm run dev                 (Worker API on :8787)  — started automatically below
 *   npm run dev:client          (Vite on :5173)        — started automatically below
 * Chromium covers Chrome; WebKit is Safari's engine (and the macOS webview's).
 */
export default defineConfig({
  testDir: '.',
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 15000,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: 'npm run dev -w @sk/server',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: true,
      cwd: '..',
    },
    {
      command: 'npm run dev -w @sk/client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
});
