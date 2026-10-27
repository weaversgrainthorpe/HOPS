import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// "Recently used": an optional per-browser row of the tiles this viewer opens most, above the tabs.
// Kept in localStorage only (no accounts, nothing sent to the server). Off until turned on in
// Theme Settings (or hidden again from the row's own menu). A slim one-line strip of chips; in edit
// mode it stays (dimmed, inert) so nothing below it moves.

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
  // Row chips are the ordinary tile in chip form: same name, same open.
  await expect(row(page).locator('button.recent-chip')).toHaveCount(3);

  expect(await open(page, row(page).locator('[data-recent-id] button.recent-chip', { hasText: 'Bravo' }))).toBe(urlOf('Bravo'));
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

async function topOf(page: Page, sel: string) {
  return page.evaluate((q) => document.querySelector(q)!.getBoundingClientRect().top, sel);
}

test('edit mode: the row stays (dimmed, inert, not in the layout) and nothing below it moves', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importDash(page, context);
  await page.goto(f.path);
  await setShowRecent(page, true);
  await openTile(page, 'Alpha');
  await expect(row(page)).toBeVisible();
  const tabSel = '[data-dashboard-tabs] [role=tab]';
  const before = { tab: await topOf(page, tabSel), rowBox: await row(page).boundingBox() };
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(row(page)).toBeVisible();
  await expect(row(page)).toHaveAttribute('data-recent-editing', '');
  await expect(row(page).locator('[data-recent-note]')).toHaveText('Recently used — not part of the layout');
  expect(Number(await row(page).evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.6);
  // Inert: no tab stops, and a click does not open the tile.
  expect(await row(page).evaluate((e) => e.matches('[inert]'))).toBe(true);
  await row(page).locator('button.recent-chip').click({ force: true, timeout: 1500 }).catch(() => {}); // inert: swallowed, nothing opens
  const during = { tab: await topOf(page, tabSel), rowBox: await row(page).boundingBox() };
  expect(Math.abs(during.tab - before.tab)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.rowBox!.y - before.rowBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.rowBox!.height - before.rowBox!.height)).toBeLessThanOrEqual(1);
  // The canvas top (the editing canvas vs the view canvas) is where it was.
  const canvasTop = await page.evaluate(() => document.querySelector('.canvas-panel')!.getBoundingClientRect().top);
  await page.locator('[aria-label="Exit Edit Mode"]').click();
  await expect(page.locator('[aria-label="Enter Edit Mode"]')).toBeVisible();
  await expect(row(page)).toBeVisible();
  await expect(row(page)).not.toHaveAttribute('data-recent-editing', '');
  const after = { tab: await topOf(page, tabSel), canvas: await topOf(page, '.canvas-panel') };
  expect(Math.abs(after.tab - before.tab)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.canvas - canvasTop)).toBeLessThanOrEqual(1);
});

for (const [w, h] of [[1920, 1000], [390, 844]]) {
  test(`${w} px: the strip is one slim line (at most 56px tall)`, async ({ page, context }) => {
    await fakeHosts(context);
    const f = await importDash(page, context);
    await page.setViewportSize({ width: w, height: h });
    await page.goto(f.path);
    await expect(tileNamed(page, 'Alpha')).toBeVisible();
    await setShowRecent(page, true);
    for (const n of NAMES) await openTile(page, n);
    await expect(row(page)).toBeVisible();
    const box = (await row(page).boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(56);
    const chip = (await row(page).locator('button.recent-chip').first().boundingBox())!;
    expect(chip.height).toBeGreaterThanOrEqual(40);
  });
}

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
    expect(await open(p, row(p).locator('button.recent-chip', { hasText: 'Charlie' }))).toBe(urlOf('Charlie'));
  } finally {
    await anon.close();
  }
});

test('390 px phone: the strip scrolls sideways on one line, the page does not', async ({ page, context }) => {
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
    const strip = document.querySelector('[data-recent-row] ul')!;
    const tops = new Set(Array.from(strip.querySelectorAll('button.recent-chip')).map((e) => Math.round(e.getBoundingClientRect().top)));
    return {
      left: r.left, right: r.right, lines: tops.size,
      scrolls: strip.scrollWidth > strip.clientWidth, page: document.documentElement.scrollWidth
    };
  });
  expect(geo.left).toBeGreaterThanOrEqual(0);
  expect(geo.right).toBeLessThanOrEqual(390);
  expect(geo.lines).toBe(1);
  expect(geo.scrolls).toBe(true);
  expect(geo.page).toBeLessThanOrEqual(390);
});
