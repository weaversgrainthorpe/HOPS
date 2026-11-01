import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { hopsCommand } from '../hops-bin';
import { getCsrfToken } from '../helpers';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// The server goes away: the next page opened shows the app with its offline banner, from the
// service worker's own copy, and picks up by itself when the server is back. This stops a real HOPS
// instead of using setOffline: that emulation does not hold for a service worker's fetches, which
// reach the server after the first one, and it also sets navigator.onLine, which hides whether the
// app itself noticed.

const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 12);
const BASE = `http://localhost:${PORT}`;
// The heartbeat is every 30 s, so that is how long the app may take to notice the server is back.
const RECOVERY = { timeout: 40_000 };

test.describe.configure({ timeout: 120_000 });

let dataDir = '';
let child: ChildProcess | null = null;

async function startServer() {
  child = spawn(...hopsCommand(dataDir), { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('the offline-test HOPS did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
}

function stopServer() {
  child?.kill('SIGKILL');
  child = null;
}

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-offline-'));
  execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
  await startServer();
});

test.afterEach(() => {
  stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function signIn(context: BrowserContext) {
  const post = (url: string, data: object, headers = {}) => context.request.post(url, { data, headers });
  expect((await post('/api/auth/login', { username: ADMIN_USERNAME, password: ADMIN_INITIAL_PASSWORD })).ok()).toBeTruthy();
  const changed = await post('/api/auth/change-password',
    { oldPassword: ADMIN_INITIAL_PASSWORD, newPassword: ADMIN_TEST_PASSWORD },
    { 'X-CSRF-Token': await getCsrfToken(context) });
  expect(changed.ok(), await changed.text()).toBeTruthy();
}

async function rename(request: APIRequestContext, context: BrowserContext, name: string) {
  const cfg = await (await request.get('/api/config')).json();
  const dashboard = cfg.dashboards[0];
  const r = await request.put(`/api/dashboards/${encodeURIComponent(dashboard.id)}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    data: { schema: 3, dashboard: { ...dashboard, name }, revision: dashboard.revision, layoutVersion: cfg.layoutVersion }
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}

const newContext = (browser: import('@playwright/test').Browser, serviceWorkers: 'allow' | 'block' = 'allow') =>
  browser.newContext({ baseURL: BASE, serviceWorkers, storageState: { cookies: [], origins: [] } });

/** Open `url` until the worker controls the page: the first load isn't kept, the reload is. */
async function underWorker(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.reload();
}

test('a page opened with the server down shows the app and the banner, then updates by itself', async ({ browser }) => {
  const ctx = await newContext(browser);
  const admin = await newContext(browser, 'block');
  try {
    const page = await ctx.newPage();
    await underWorker(page, '/sample');
    const firstTile = page.getByRole('button', { name: /^Open / }).first();
    await expect(firstTile).toBeVisible();
    const offline = page.getByRole('status').filter({ hasText: "You're offline" });
    const savedCopy = page.getByRole('status').filter({ hasText: 'saved copy' });
    await expect(offline).toHaveCount(0);
    const tileName = await firstTile.getAttribute('aria-label');

    // Changed somewhere else: this browser's kept copy is now out of date.
    await signIn(admin);
    await rename(admin.request, admin, 'Renamed while away');

    stopServer();

    // A query string no one has opened: the browser's own cache can't answer, only the worker can.
    const res = await page.goto('/sample?first-offline-page');
    expect(res?.status()).toBe(200);
    await expect(offline).toBeVisible();
    await expect(page.getByRole('button', { name: tileName! }).first()).toBeVisible();
    await expect(page.getByText('Renamed while away')).toHaveCount(0);

    await startServer();

    // No reload here: the page notices, reads again, and only then drops the warning.
    await expect(page.getByText('Renamed while away').first()).toBeVisible(RECOVERY);
    await expect(offline).toHaveCount(0);
    await expect(savedCopy).toHaveCount(0);
  } finally {
    await ctx.close();
    await admin.close();
  }
});

test("a signed-in admin opening Settings with the server down isn't asked to sign in", async ({ browser }) => {
  const ctx = await newContext(browser);
  try {
    await signIn(ctx);
    const page = await ctx.newPage();
    await underWorker(page, '/settings/global');
    const sections = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(sections).toBeVisible();

    stopServer();

    await page.goto('/settings/global?first-offline-page');
    await expect(page.getByRole('alert').filter({ hasText: "Can't reach the server" })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);
    await expect(sections).toHaveCount(0);

    await startServer();

    await expect(sections).toBeVisible(RECOVERY);
    await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('signed out with the server up, Settings still asks for the password', async ({ browser }) => {
  const ctx = await newContext(browser);
  try {
    const page = await ctx.newPage();
    await page.goto('/settings/global');
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
