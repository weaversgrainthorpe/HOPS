import { test, expect, type BrowserContext } from '@playwright/test';
import { hopsCommand } from '../hops-bin';
import { getCsrfToken } from '../helpers';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

// A slow link, not a dead one: the server answers, but later than the service worker's limit
// (KEPT_WAIT_MS, 45 s). A real browser and a real worker, with a small proxy in front of a real HOPS
// holding back the config reads: no emulation reaches a service worker's fetches reliably. The test
// has to wait the limit out, so it takes about a minute.

const PORT = Number(process.env.HOPS_TEST_PORT || '18080') + 13;
const SERVER = `http://127.0.0.1:${PORT}`;
const PROXY_PORT = PORT + 1;
const BASE = `http://localhost:${PROXY_PORT}`;
const KEPT_WAIT_MS = 45_000;
const SERVER_ANSWERS_AFTER_MS = 50_000;

test.describe.configure({ timeout: 200_000 });

let dataDir = '';
let child: ChildProcess | null = null;
let proxy: http.Server | null = null;
let holdFor = 0;
let release: () => void = () => {};
let released = new Promise<void>((r) => (release = r));

function startProxy(): Promise<void> {
  proxy = http.createServer((req, res) => {
    const held = req.url?.startsWith('/api/config') ? holdFor : 0;
    const out = http.request(`${SERVER}${req.url}`, { method: req.method, headers: req.headers }, async (answer) => {
      if (held) await Promise.race([new Promise((r) => setTimeout(r, held)), released]);
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    out.on('error', () => res.destroy());
    req.pipe(out);
  });
  return new Promise((r) => proxy!.listen(PROXY_PORT, '127.0.0.1', r));
}

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-slow-link-'));
  execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), String(PORT)]);
  child = spawn(...hopsCommand(dataDir), { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${SERVER}/api/health`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('the slow-link HOPS did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  holdFor = 0;
  released = new Promise<void>((r) => (release = r));
  await startProxy();
});

test.afterEach(async () => {
  release();
  proxy?.closeAllConnections();
  await new Promise((r) => proxy?.close(r));
  child?.kill('SIGKILL');
  child = null;
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

test('a config read slower than the limit shows the marked saved copy, then the server\'s answer refreshes it', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, serviceWorkers: 'allow', storageState: { cookies: [], origins: [] } });
  const admin = await browser.newContext({ baseURL: SERVER, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    await page.goto('/sample');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.reload();
    const firstTile = page.getByRole('button', { name: /^Open / }).first();
    await expect(firstTile).toBeVisible();
    const keptAddress = await page.evaluate(async () => {
      const entries = performance.getEntriesByType('resource').map((e) => e.name);
      return entries.find((n) => n.includes('/api/config?dashboard=')) ?? '';
    });
    expect(keptAddress).not.toBe('');
    const keptText = () => page.evaluate(async (url) => (await (await caches.match(url))?.text()) ?? '', keptAddress);
    await expect.poll(keptText).toContain('"schemaVersion"');

    // Changed elsewhere, so the kept copy and the server's answer can be told apart.
    await signIn(admin);
    const cfg = await (await admin.request.get('/api/config')).json();
    const dashboard = cfg.dashboards[0];
    const put = await admin.request.put(`/api/dashboards/${encodeURIComponent(dashboard.id)}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(admin) },
      data: { schema: 3, dashboard: { ...dashboard, name: 'Renamed on the server' }, revision: dashboard.revision, layoutVersion: cfg.layoutVersion }
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    holdFor = SERVER_ANSWERS_AFTER_MS;
    const started = Date.now();
    await page.goto('/sample?slow-link');

    // The worker gives up waiting at its limit, before the server and before the app's 60 s.
    const savedCopy = page.getByRole('status').filter({ hasText: 'saved copy' });
    await expect(savedCopy).toBeVisible({ timeout: KEPT_WAIT_MS + 5_000 });
    expect(Date.now() - started).toBeGreaterThan(KEPT_WAIT_MS - 3_000);
    expect(Date.now() - started).toBeLessThan(SERVER_ANSWERS_AFTER_MS);
    await expect(firstTile).toBeVisible();
    await expect(page.getByText('Renamed on the server')).toHaveCount(0);

    // The server's late answer still lands in the worker's copy.
    await expect.poll(keptText, { timeout: 15_000 }).toContain('Renamed on the server');

    // The link recovers: the page reads again by itself and the warning goes.
    holdFor = 0;
    release();
    await expect(page.getByText('Renamed on the server').first()).toBeVisible({ timeout: 45_000 });
    await expect(savedCopy).toHaveCount(0);
  } finally {
    await ctx.close();
    await admin.close();
  }
});
