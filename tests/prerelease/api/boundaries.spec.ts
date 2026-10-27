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
    '/api/logs',
    '/api/icons/usage',
    '/api/icons/packaged',
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

// The failed-login limit is per IP per minute and every spec signs in from
// 127.0.0.1, so this test must not leave that IP's allowance used up for the
// specs after it (order must not matter). It lowers the limit to 3 as the
// admin, fires a short burst, and afterEach puts the stored value back: only
// a handful of attempts are recorded, well under the restored limit.
const RATE_LIMIT_KEY = 'auth.login_rate_limit_per_min';
let rateLimitBefore: string | null = null;

async function adminSetSetting(playwright: { request: { newContext: Function } }, baseURL: string | undefined, key: string, value: string): Promise<string> {
  const admin = await playwright.request.newContext({ baseURL, storageState: 'auth.json' });
  try {
    const csrf = (await admin.storageState()).cookies.find((c: { name: string }) => c.name === 'hops_csrf')?.value;
    if (!csrf) throw new Error('hops_csrf cookie not present — was the setup auth project run?');
    const list = await admin.get('/api/settings');
    expect(list.ok(), `GET /api/settings: ${list.status()}`).toBeTruthy();
    const body = await list.json();
    const rows: { key: string; value: string }[] = Array.isArray(body) ? body : body.settings;
    const before = rows.find((r) => r.key === key)?.value;
    if (before === undefined) throw new Error(`setting ${key} not listed`);
    const put = await admin.put(`/api/settings/${key}`, {
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      data: JSON.stringify({ value }),
    });
    expect(put.ok(), `PUT ${key}: ${put.status()} ${await put.text()}`).toBeTruthy();
    return before;
  } finally {
    await admin.dispose();
  }
}

test.afterEach(async ({ playwright, baseURL }) => {
  if (rateLimitBefore === null) return;
  const v = rateLimitBefore;
  rateLimitBefore = null;
  await adminSetSetting(playwright, baseURL, RATE_LIMIT_KEY, v);
});

test('login rate limit fires after burst of bad passwords', async ({ request, playwright, baseURL }) => {
  rateLimitBefore = await adminSetSetting(playwright, baseURL, RATE_LIMIT_KEY, '3');
  let sawRateLimit = false;
  for (let i = 0; i < 6; i++) {
    const r = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'definitely-wrong' },
    });
    if (r.status() === 429) {
      sawRateLimit = true;
      break;
    }
  }
  expect(sawRateLimit, 'rate limiter should fire within 6 bad attempts at a limit of 3').toBeTruthy();
});
