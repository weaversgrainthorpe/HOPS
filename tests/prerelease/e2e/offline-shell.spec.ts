import { test, expect } from '@playwright/test';
import { hopsCommand } from '../hops-bin';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// The server goes away: the next page opened shows the app with its offline banner, from the
// service worker's own copy. This stops a real HOPS instead of using setOffline: that emulation does
// not hold for a service worker's fetches, which reach the server after the first one, and it also
// sets navigator.onLine, which hides whether the app itself noticed.

const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 12);

test('the server is down: a page not opened before shows the app and the banner', async ({ browser }) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-offline-'));
  execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
  let child: ChildProcess | null = spawn(...hopsCommand(dataDir), { stdio: 'ignore' });
  const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}`, serviceWorkers: 'allow', storageState: { cookies: [], origins: [] } });
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('the offline-test HOPS did not start');
      await new Promise((r) => setTimeout(r, 200));
    }

    const page = await ctx.newPage();
    await page.goto('/sample');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The first load isn't controlled yet: a reload is what puts the dashboard in the kept copies.
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.reload();
    const firstTile = page.getByRole('button', { name: /^Open / }).first();
    await expect(firstTile).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toHaveCount(0);
    const tileName = await firstTile.getAttribute('aria-label');

    child.kill('SIGKILL');
    child = null;

    // A query string no one has opened: the browser's own cache can't answer, only the worker can.
    const res = await page.goto('/sample?first-offline-page');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible();
    await expect(page.getByRole('button', { name: tileName! }).first()).toBeVisible();
  } finally {
    await ctx.close();
    if (child?.pid) process.kill(child.pid, 'SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
