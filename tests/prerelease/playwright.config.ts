import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';
import * as os from 'node:os';

// Tests run against a fresh HOPS process started by start-test-server.sh,
// not against the LAN deploy-local instance. This keeps the real homelab
// dashboards untouched and makes the suite deterministic.
//
// The server script picks a free port and writes it to a sentinel file
// the helpers read at runtime. The webServer block below waits for
// /api/health to respond before launching tests.

const PORT = process.env.HOPS_TEST_PORT || '18080';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  // Serial execution — HOPS has shared SQLite state per process, and
  // parallel tests fighting over the same dashboards yield flakes that
  // are not real bugs. The whole suite still finishes in 3–5 minutes.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    // Block PWA service-worker registration in tests. With the SW on,
    // each test inherits whatever cache earlier tests populated, which
    // hides regressions and randomly serves stale shells. The SW is
    // covered by its own dedicated specs; for general E2E, block it.
    serviceWorkers: 'block',
  },

  projects: [
    { name: 'setup', testMatch: /setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'auth.json' },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: './start-test-server.sh',
    url: `${BASE_URL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOPS_TEST_PORT: PORT,
    },
  },
});
