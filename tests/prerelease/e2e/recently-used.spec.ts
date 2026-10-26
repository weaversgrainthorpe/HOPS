import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// "Recently used": an optional per-browser row of the tiles this viewer opens most, above the tabs.
// Kept in localStorage only (no accounts, nothing sent to the server). Off until turned on in
// Theme Settings (or hidden again from the row's own menu); hidden while editing.

const madeIds: string[] = [];

test.afterEach(async ({ page, context }) => {
  for (const id of madeIds.splice(0)) {
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    if (rev === undefined) continue;
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup ${id}: ${r.status()}`).toBeTruthy();
  }
});

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const urlOf = (name: string) => `http://${name.toLowerCase()}.hops-recent.test/`;

const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });
const row = (page: Page) => page.locator('[data-recent-row]');
const rowNames = (page: Page) => row(page).locator('[data-recent-id] .title').allInnerTexts();

async function fakeHosts(context: BrowserContext) {
  await context.route(/hops-recent\.test/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>ok' }));
}

async function importDash(page: Page, context: BrowserContext) {
  const p = `recent${Date.now().toString(36)}`;
  const dash = {
    id: `${p}-dash`, name: `Recent ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: `${p}-tab`, name: 'Main', order: 0,
      root: {
        columns: 24,
        children: NAMES.map((name, i) => ({
          id: `${p}-${name.toLowerCase()}`, kind: 'tile', type: 'link', name, icon: 'mdi:server', size: 'medium',
          order: i, placement: { x: (i % 4) * 3, y: Math.floor(i / 4) * 3, w: 2, h: 2 },
          url: urlOf(name), openMode: 'newtab'
        }))
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'recent.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  madeIds.push(dash.id);
  return { path: `/${p}`, id: dash.id };
}

/** Click a tile (grid or row) and return the address its new tab opened. */
async function open(page: Page, target: ReturnType<Page['locator']>): Promise<string> {
  const popup = page.waitForEvent('popup');
  await target.click();
  const p = await popup;
  const u = p.url();
  await p.close();
  return u;
}
const openTile = (page: Page, name: string) => open(page, tileNamed(page, name).locator('button.entry'));

async function setShowRecent(page: Page, on: boolean) {
  await page.getByRole('button', { name: 'Theme Settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Theme Settings' });
  const box = dlg.getByRole('checkbox', { name: 'Show recently used' });
  if (on) await box.check();
  else await box.uncheck();
  await dlg.getByRole('button', { name: 'Apply Theme' }).click();
  await expect(dlg).toHaveCount(0);
}

test('off by default (nothing recorded); on: shows opened tiles by frecency, opens from the row, drops deleted ones', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importDash(page, context);
  await page.goto(f.path);
  await expect(tileNamed(page, 'Alpha')).toBeVisible();
  await openTile(page, 'Delta');
  await setShowRecent(page, true);
  await expect(row(page)).toHaveCount(0); // nothing was recorded while it was off

  // A stale entry for a tile that no longer exists is silently left out.
  await page.evaluate((dashId) => {
    const raw = JSON.parse(localStorage.getItem('hops_recent_tiles') || '{"v":1,"d":{}}');
    raw.d[dashId] = [{ id: 'ghost-tile', count: 50, last: Date.now() }];
    localStorage.setItem('hops_recent_tiles', JSON.stringify(raw));
  }, f.id);

  for (const n of ['Alpha', 'Bravo', 'Charlie']) await openTile(page, n);
  await expect(row(page)).toBeVisible();
  await expect(row(page).getByRole('heading', { name: 'Recently used' })).toBeVisible();
  expect(await rowNames(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  // Row tiles are the ordinary tile (Small): same name, same open.
  await expect(row(page).locator('button.entry.small')).toHaveCount(3);

  expect(await open(page, row(page).locator('[data-recent-id] button.entry', { hasText: 'Bravo' }))).toBe(urlOf('Bravo'));
  await expect.poll(() => rowNames(page)).toEqual(['Bravo', 'Charlie', 'Alpha']);

  // Search's Enter opens a tile too, and counts.
  await page.keyboard.press('/');
  await page.getByRole('textbox', { name: /search tiles/i }).fill('Echo');
  const pop = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  expect((await pop).url()).toBe(urlOf('Echo'));
  // Bravo (opened twice) stays first; Echo, the newest single open, comes next.
  await expect.poll(() => rowNames(page)).toEqual(['Bravo', 'Echo', 'Charlie', 'Alpha']);
});

test('Clear history empties the row; the toggle persists across reloads (Theme Settings and the row menu)', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importDash(page, context);
  await page.goto(f.path);
  await setShowRecent(page, true);
  await openTile(page, 'Alpha');
  await expect(row(page)).toBeVisible();

  await page.reload();
  await expect(row(page)).toBeVisible();
  expect(await rowNames(page)).toEqual(['Alpha']);

  await row(page).getByRole('button', { name: 'Recently used options' }).click();
  await page.getByRole('menuitem', { name: 'Clear history' }).click();
  await expect(row(page)).toHaveCount(0);
  await page.reload();
  await expect(tileNamed(page, 'Alpha')).toBeVisible();
  await expect(row(page)).toHaveCount(0);

  // Still on: a new open shows the row again. Hide it from the row's menu: stays off after reload.
  await openTile(page, 'Bravo');
  await expect(row(page)).toBeVisible();
  await row(page).getByRole('button', { name: 'Recently used options' }).click();
  await page.getByRole('menuitem', { name: 'Hide recently used' }).click();
  await expect(row(page)).toHaveCount(0);
  await page.reload();
  await expect(tileNamed(page, 'Alpha')).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Theme Settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'Show recently used' })).not.toBeChecked();
  // Theme Settings' Clear history works too.
  await page.getByRole('dialog', { name: 'Theme Settings' }).getByRole('button', { name: 'Clear history' }).click();
  await page.keyboard.press('Escape');
  await setShowRecent(page, true);
  await expect(row(page)).toHaveCount(0);
});

test('hidden in edit mode, back after', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importDash(page, context);
  await page.goto(f.path);
  await setShowRecent(page, true);
  await openTile(page, 'Alpha');
  await expect(row(page)).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await page.locator('[aria-label="Exit Edit Mode"]').click();
  await expect(page.locator('[aria-label="Enter Edit Mode"]')).toBeVisible();
  await expect(row(page)).toBeVisible();
});

test('signed-out viewers can use it', async ({ page, context, browser }) => {
  const f = await importDash(page, context);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await fakeHosts(anon);
    const p = await anon.newPage();
    await p.goto(f.path);
    await expect(tileNamed(p, 'Alpha')).toBeVisible();
    await expect(p.locator('nav .logout-btn')).toHaveCount(0);
    await setShowRecent(p, true);
    await openTile(p, 'Charlie');
    await openTile(p, 'Alpha');
    expect(await rowNames(p)).toEqual(['Alpha', 'Charlie']);
    expect(await open(p, row(p).locator('button.entry', { hasText: 'Charlie' }))).toBe(urlOf('Charlie'));
  } finally {
    await anon.close();
  }
});

test('390 px phone: the row fits, no sideways page scroll', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importDash(page, context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(f.path);
  await expect(tileNamed(page, 'Alpha')).toBeVisible();
  await setShowRecent(page, true);
  for (const n of NAMES) await openTile(page, n);
  await expect(row(page)).toBeVisible();
  const geo = await page.evaluate(() => {
    const r = document.querySelector('[data-recent-row]')!.getBoundingClientRect();
    const shown = Array.from(document.querySelectorAll('[data-recent-row] [data-recent-id]'))
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    return {
      left: r.left, right: r.right, shown: shown.length,
      maxRight: Math.max(...shown.map((b) => b.right)), minW: Math.min(...shown.map((b) => b.width)),
      scroll: document.documentElement.scrollWidth
    };
  });
  expect(geo.shown).toBe(4);
  expect(geo.left).toBeGreaterThanOrEqual(0);
  expect(geo.right).toBeLessThanOrEqual(390);
  expect(geo.maxRight).toBeLessThanOrEqual(390);
  expect(geo.minW).toBeGreaterThanOrEqual(60);
  expect(geo.scroll).toBeLessThanOrEqual(390);
});
