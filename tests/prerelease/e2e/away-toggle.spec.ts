import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed, getCsrfToken } from '../helpers';

// Home/Away: a tile may have an away address; a per-browser Home/Away toggle in the header
// (shown only when the dashboard has one) picks which address tiles open.

const HOME = 'http://home.hops-away.test/';
const AWAY = 'https://away.hops-away.test/';
const PLAIN = 'http://plain.hops-away.test/';

const made: string[] = [];
const madeIds: string[] = [];

test.afterEach(async ({ page, context }) => {
  await deleteDashboardsNamed(page, made.splice(0));
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

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });
const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });
const awayToggle = (page: Page) => page.locator('nav .away-toggle');

/** Answer the fake home/away hosts so a popup has a page to load. */
async function fakeHosts(context: BrowserContext) {
  await context.route(/hops-away\.test/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>ok' }));
}

async function importAwayDash(page: Page, context: BrowserContext) {
  const p = `away${Date.now().toString(36)}`;
  const tile = (id: string, name: string, x: number, extra: Record<string, unknown>) => ({
    id: `${p}-${id}`, kind: 'tile', type: 'link', name, icon: 'mdi:server', size: 'medium', order: x,
    placement: { x: x * 2, y: 0, w: 2, h: 2 }, ...extra
  });
  const dash = {
    id: `${p}-dash`, name: `Away ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: `${p}-tab`, name: 'Main', order: 0,
      root: {
        columns: 24,
        children: [
          tile('nas', 'NAS', 0, { url: HOME, awayUrl: AWAY, openMode: 'newtab' }),
          tile('plain', 'Plain', 1, { url: PLAIN, openMode: 'newtab' }),
          tile('framed', 'Framed', 2, { url: HOME, awayUrl: AWAY, openMode: 'iframe' })
        ]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'away.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  madeIds.push(dash.id);
  return { path: `/${p}`, id: dash.id };
}

async function popupUrlOnClick(page: Page, name: string): Promise<string> {
  const popup = page.waitForEvent('popup');
  await tileNamed(page, name).locator('button.entry').click();
  const p = await popup;
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  const u = p.url();
  await p.close();
  return u;
}

test('dialog: set an away address (bad one refused), toggle appears only once a tile has one', async ({ page }) => {
  const dashName = uniqueName('AwayDlg');
  await createDashboardViaUI(page, dashName, undefined, made);
  await expect(awayToggle(page)).toHaveCount(0);
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Tile' });
  await dlg.locator('input#name').fill('NAS');
  await dlg.locator('input#url').fill(HOME);
  await expect(dlg.getByText('Used when this browser is set to Away, e.g. your Tailscale or public address.')).toBeVisible();
  await dlg.locator('#away-url').fill('javascript:alert(1)');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#away-url-error')).toBeVisible();
  await dlg.locator('#away-url').fill(AWAY);
  await expect(dlg.locator('#away-url-error')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(tileNamed(page, 'NAS')).toBeVisible();
  await expect(awayToggle(page)).toBeVisible();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
  const dash = (await (await page.request.get('/api/config')).json()).dashboards.find((d: { name: string }) => d.name === dashName);
  expect(JSON.stringify(dash)).toContain(`"awayUrl":"${AWAY}"`);

  // The server's refusal of a bad awayUrl (save and import) is covered by the Go tests.
});

test('Away opens the away address (click, iframe, keyboard), Home the home one; remembered across reloads', async ({ page, context }) => {
  await fakeHosts(context);
  const f = await importAwayDash(page, context);
  await page.goto(f.path);
  await expect(tileNamed(page, 'NAS')).toBeVisible();
  const t = awayToggle(page);
  await expect(t).toBeVisible();
  await expect(t).toHaveAccessibleName(/Switch to Away/);
  expect(await popupUrlOnClick(page, 'NAS')).toBe(HOME);

  await t.click();
  await expect(t).toHaveText(/Away/);
  await expect(t).toHaveAccessibleName(/Switch to Home/);
  expect(await popupUrlOnClick(page, 'NAS')).toBe(AWAY);
  // No away address: the home one.
  expect(await popupUrlOnClick(page, 'Plain')).toBe(PLAIN);
  // Keyboard: Enter on the focused tile opens what a click would.
  const popup = page.waitForEvent('popup');
  await tileNamed(page, 'NAS').locator('button.entry').focus();
  await page.keyboard.press('Enter');
  const kp = await popup;
  expect(kp.url()).toBe(AWAY);
  await kp.close();
  // Iframe mode uses the same choice.
  await tileNamed(page, 'Framed').locator('button.entry').click();
  await expect(page.locator('.iframe-container iframe')).toHaveAttribute('src', AWAY);
  await page.keyboard.press('Escape');
  // Hover text says the status is still checked at home.
  await expect(tileNamed(page, 'NAS').locator('button.entry')).toHaveAttribute('title', /Opens away address/);

  await page.reload();
  await expect(awayToggle(page)).toHaveText(/Away/);
  expect(await popupUrlOnClick(page, 'NAS')).toBe(AWAY);
  await awayToggle(page).click();
  await page.reload();
  await expect(awayToggle(page)).toHaveAccessibleName(/Switch to Away/);
  expect(await popupUrlOnClick(page, 'NAS')).toBe(HOME);

  // A dashboard without any away address shows no toggle.
  const other = uniqueName('NoAway');
  await createDashboardViaUI(page, other, undefined, made);
  await expect(awayToggle(page)).toHaveCount(0);
});

test('signed-out viewers see and use it', async ({ page, context, browser }) => {
  const f = await importAwayDash(page, context);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await fakeHosts(anon);
    const p = await anon.newPage();
    await p.goto(f.path);
    await expect(tileNamed(p, 'NAS')).toBeVisible();
    await expect(p.locator('nav .logout-btn')).toHaveCount(0);
    await awayToggle(p).click();
    await expect(awayToggle(p)).toHaveText(/Away/);
    expect(await popupUrlOnClick(p, 'NAS')).toBe(AWAY);
  } finally {
    await anon.close();
  }
});

test('390 px phone: the toggle is a 40 px target that overlaps nothing, Home and Away', async ({ page, context }) => {
  const f = await importAwayDash(page, context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(f.path);
  await expect(tileNamed(page, 'NAS')).toBeVisible();
  for (const mode of ['Home', 'Away']) {
    if (mode === 'Away') {
      await awayToggle(page).click();
      await expect(awayToggle(page)).toHaveText(/Away/);
    }
    await page.waitForTimeout(300);
    const geo = await page.evaluate(() => {
      const t = document.querySelector('nav .away-toggle')!.getBoundingClientRect();
      const others = Array.from(document.querySelectorAll('nav .nav-right > *, nav .nav-center, nav .nav-left'))
        .filter((e) => !e.classList.contains('away-toggle'))
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const overlaps = others.filter((r) => r.left < t.right - 0.5 && r.right > t.left + 0.5 && r.top < t.bottom - 0.5 && r.bottom > t.top + 0.5).length;
      return { w: t.width, h: t.height, left: t.left, right: t.right, overlaps, scroll: document.documentElement.scrollWidth };
    });
    expect(geo.w, mode).toBeGreaterThanOrEqual(40);
    expect(geo.h, mode).toBeGreaterThanOrEqual(40);
    expect(geo.left, mode).toBeGreaterThanOrEqual(0);
    expect(geo.right, mode).toBeLessThanOrEqual(390);
    expect(geo.overlaps, mode).toBe(0);
    expect(geo.scroll, mode).toBeLessThanOrEqual(390);
  }
  await expect(awayToggle(page)).toContainText('Away');
});
