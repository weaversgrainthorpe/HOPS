import { test as base, expect } from '@playwright/test';

// Auth + CSRF boundary tests. These run UNAUTHENTICATED — the default
// storageState in the chromium project is the logged-in admin, so we
// override it to a clean context here.

const test = base.extend({
  storageState: async ({}, use) => {
    await use({ cookies: [], origins: [] });
  },
});

test('protected endpoints reject unauthenticated GET with 401', async ({ request }) => {
  // Note: /api/config is intentionally PUBLIC — viewers load dashboards
  // from it without signing in. /api/config/export and /api/config/import
  // are the protected operations.
  const endpoints = [
    '/api/config/export',
    '/api/settings',
    '/api/backups',
    '/api/discovery/scans',
    '/api/discovery/detectors',
  ];

  for (const ep of endpoints) {
    const r = await request.get(ep);
    expect(r.status(), `${ep} should require auth`).toBe(401);
  }
});

test('protected mutation without CSRF token fails', async ({ request }) => {
  // Login to get a session cookie but skip the X-CSRF-Token header
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'TestPass123!' },
  });
  expect(login.ok()).toBeTruthy();

  // Without the X-CSRF-Token header this PUT must be rejected
  const r = await request.put('/api/settings/auth.login_rate_limit_per_min', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ value: '999' }),
  });
  expect(r.ok()).toBeFalsy();
  // Expected: 403 (forbidden) — pin the family, not the exact code.
  expect([401, 403]).toContain(r.status());
});

test('public endpoints respond without auth', async ({ request }) => {
  for (const ep of ['/api/health', '/api/version', '/api/auth/check']) {
    const r = await request.get(ep);
    expect(r.status(), `${ep} should be public`).toBe(200);
  }
});

test('login rate limit fires after burst of bad passwords', async ({ request }) => {
  // Default limit is 20/min/IP — fire 25 quick attempts, expect at least
  // one 429 in the back half.
  let sawRateLimit = false;
  for (let i = 0; i < 25; i++) {
    const r = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'definitely-wrong' },
    });
    if (r.status() === 429) {
      sawRateLimit = true;
      break;
    }
  }
  expect(sawRateLimit, 'rate limiter should fire within 25 bad attempts').toBeTruthy();
});
