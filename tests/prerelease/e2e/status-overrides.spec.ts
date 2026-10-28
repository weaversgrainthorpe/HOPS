import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { getCsrfToken, deleteDashboardsNamed, setSetting, signInDialog } from '../helpers';

// rc5 Part B in a real browser: Settings › Dashboards › Status check overrides lists every level
// that sets status checks itself, says what restoring it to Inherit would change, and restores in
// bulk through the ordinary revision-checked saves. Synthetic dashboards only, deleted afterwards;
// the global setting is set On explicitly and put back.

let seq = 0;
const PAGE = '/settings/dashboards/status-overrides';
const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });
const nulls = { statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null };

async function importDash(page: Page, context: BrowserContext, dash: Record<string, unknown>) {
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'so.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
}

/**
 * The main fixture: the dashboard Off (set here); a tile On; a folder On over two tiles with no
 * setting; and a tile with no setting at the tab root. (An invalid value can't be saved or
 * imported, only found in legacy stored data, so the listing test adds one to the page's read.)
 */
async function setup(page: Page, context: BrowserContext, names: string[]) {
  const p = `so${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const tile = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'tile', type: 'link', name, url: `https://${key}.${p}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, ...extra
  });
  const name = `Overrides ${p}`;
  await importDash(page, context, {
    id: id('dash'), name, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: false, ...nulls },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: { columns: 24, children: [
        tile('on', 'Checked', { placement: placement(0, 0), statusCheck: { type: 'http', enabled: true, interval: 60 } }),
        {
          id: id('lab'), kind: 'folder', name: 'Lab', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
          statusChecksEnabled: true, placement: placement(0, 2, 12, 9),
          content: { children: [tile('f1', 'Inner one'), tile('f2', 'Inner two')] }
        },
        tile('plain', 'Plain', { placement: placement(2, 0) })
      ] }
    }]
  });
  names.push(name);
  return { p, id, name, path: `/${p}`, dashId: id('dash'), key: (level: string, k: string) => `${id('dash')}:${level}:${id(k)}` };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function dashboardOf(page: Page, dashId: string) {
  const cfg = await (await page.request.get('/api/config')).json();
  return cfg.dashboards.find((d: { id: string }) => d.id === dashId);
}

const group = (page: Page, f: Fixture) => page.locator(`[data-so-group="${f.dashId}"]`);
const rowOf = (page: Page, key: string) => page.locator(`[data-testid="so-row"][data-key="${key}"]`);
const filter = (page: Page, label: RegExp) => page.getByTestId('so-filter').getByRole('radio', { name: label });

/** Run `body` with the global setting On, the fixture built; both undone in `finally`. */
async function withFixture(page: Page, context: BrowserContext, body: (f: Fixture, names: string[]) => Promise<void>) {
  const names: string[] = [];
  const before = await setSetting(page, 'status.checks_enabled', 'true');
  try {
    const f = await setup(page, context, names);
    await body(f, names);
  } finally {
    await setSetting(page, 'status.checks_enabled', before);
    await deleteDashboardsNamed(page, names);
  }
}

async function open(page: Page, f: Fixture) {
  await page.goto(PAGE);
  await expect(page.getByTestId('status-overrides')).toContainText('Global setting: On');
  await expect(group(page, f)).toContainText('dashboard: Off (set here)');
}

test.describe('Status check overrides page', () => {
  test('lists the rows with their effects; the filter is remembered', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      // Legacy stored data with an invalid value: the server refuses to store one now, so it is
      // added to what this page reads (GET /api/config), as an old install would serve it.
      await page.route('**/api/config', async (route) => {
        const resp = await route.fetch();
        const cfg = await resp.json();
        const d = cfg.dashboards.find((x: { id: string }) => x.id === f.dashId);
        d.tabs[0].root.children.push({
          id: f.id('bad'), kind: 'tile', type: 'link', name: 'Broken', url: 'https://bad.example.lan/', icon: 'mdi:lan',
          openMode: 'newtab', size: 'medium', order: 0, placement: placement(4, 0), statusCheck: 'yes'
        });
        await route.fulfill({ response: resp, json: cfg });
      });
      await open(page, f);
      await expect(page.getByRole('link', { name: /On \(Settings › Global\)/ })).toHaveAttribute('href', '/settings/global#status-checks');
      await expect(filter(page, /^Would change something/)).toBeChecked();
      const rows = group(page, f).getByTestId('so-row');
      await expect(rows).toHaveCount(4);
      await expect(rowOf(page, f.key('tile', 'on'))).toContainText('On (set here)');
      await expect(rowOf(page, f.key('tile', 'on'))).toContainText(`→ Off, from dashboard ${f.name}`);
      await expect(rowOf(page, f.key('tile', 'on'))).toContainText('stops checking');
      await expect(rowOf(page, f.key('folder', 'lab'))).toContainText('stops checking 2 tiles');
      await expect(rowOf(page, f.key('tile', 'bad'))).toContainText('Invalid (treated as off)');
      const dashRow = page.locator(`[data-testid="so-row"][data-key="${f.dashId}:dashboard:${f.dashId}"]`);
      await expect(dashRow).toContainText('Off (set here)');
      await expect(dashRow).toContainText('→ On, from global');
      await expect(dashRow).toContainText('starts checking 1 tile');

      await filter(page, /^No effect/).check();
      await expect(rows).toHaveCount(0);
      // Remembered per browser.
      await page.reload();
      await expect(filter(page, /^No effect/)).toBeChecked();
      await filter(page, /^All/).check();
      await expect(rows).toHaveCount(4);
      await filter(page, /^Would change something/).check();
    });
  });

  test('restore a folder and a tile: preview, save, and the badges follow', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      await open(page, f);
      await rowOf(page, f.key('folder', 'lab')).getByRole('checkbox').check();
      await rowOf(page, f.key('tile', 'on')).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Restore inheritance for 2 selected' }).click();
      const prev = page.getByTestId('so-preview');
      await expect(prev).toContainText('will start checking 0 tiles and stop checking 3 tiles');
      await expect(prev).toContainText('Main › Lab › Inner one');
      // Nothing saved yet.
      expect((await dashboardOf(page, f.dashId)).revision).toBe(1);
      await prev.getByRole('button', { name: 'Confirm' }).click();
      await expect(rowOf(page, f.key('folder', 'lab'))).toHaveCount(0);
      await expect(rowOf(page, f.key('tile', 'on'))).toHaveCount(0);
      await expect(group(page, f).getByTestId('so-row')).toHaveCount(1); // the dashboard's own Off
      await expect(page.getByTestId('so-refusal')).toHaveCount(0);

      const d = await dashboardOf(page, f.dashId);
      const [on, lab] = d.tabs[0].root.children;
      expect(on.statusCheck).toEqual({ type: 'http', interval: 60 }); // only `enabled` removed
      expect(lab.statusChecksEnabled).toBeUndefined();

      // View mode: the folder's tiles now follow the Off dashboard: no badge.
      await page.goto(f.path);
      await expect(page.locator(`[data-node-id="${f.id('f1')}"]`)).toBeVisible();
      await expect(page.locator(`[data-node-id="${f.id('f1')}"] .status-badge`)).toHaveCount(0);
      await expect(page.locator(`[data-node-id="${f.id('f2')}"] .status-badge`)).toHaveCount(0);
      await expect(page.locator(`[data-node-id="${f.id('on')}"] .status-badge`)).toHaveCount(0);
    });
  });

  test('a tile with no setting under an On dashboard is checked (absent = Inherit)', async ({ page, context }) => {
    const names: string[] = [];
    const before = await setSetting(page, 'status.checks_enabled', 'true');
    try {
      const p = `so${Date.now().toString(36)}on`;
      const name = `Overrides on ${p}`;
      await importDash(page, context, {
        id: `${p}-dash`, name, order: 0, path: `/${p}`, revision: 1,
        settings: { statusChecksEnabled: true, ...nulls },
        tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [{
          id: `${p}-t`, kind: 'tile', type: 'link', name: 'Follower', url: `https://t.${p}.example.lan/`, icon: 'mdi:lan',
          openMode: 'newtab', size: 'medium', order: 0, placement: placement(0, 0)
        }] } }]
      });
      names.push(name);
      await page.goto(`/${p}`);
      await expect(page.locator(`[data-node-id="${p}-t"] .status-badge .status-indicator`)).toBeVisible();
    } finally {
      await setSetting(page, 'status.checks_enabled', before);
      await deleteDashboardsNamed(page, names);
    }
  });

  test('refused while the dashboard has an unsaved draft open; nothing saved', async ({ page, context, browser }) => {
    await withFixture(page, context, async (f) => {
      const { page: own, ctx } = await loggedOutPage(browser);
      try {
        // Edit the dashboard (a dirty draft), then lose the sign-in: the draft is parked in memory.
        await own.goto(f.path);
        await own.getByRole('button', { name: 'Enter Edit Mode' }).click();
        await signInDialog(own);
        await expect(own.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
        await own.locator(`[data-node-id="${f.id('plain')}"]`).click({ button: 'right' });
        await own.getByRole('menuitem', { name: 'Edit' }).click();
        const dlg = own.getByRole('dialog');
        await dlg.locator('input#name').fill('Plain draft');
        await dlg.getByRole('button', { name: /^Save$/ }).click();
        const csrf = (await ctx.cookies()).find((c) => c.name === 'hops_csrf')!.value;
        expect((await own.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrf } })).ok()).toBeTruthy();
        await own.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
        await expect(own.locator('.parked-banner')).toBeVisible();

        // Signed in again on Settings (in-page navigation keeps the parked draft), to the page.
        await own.getByRole('link', { name: 'Settings' }).click();
        await signInDialog(own);
        await own.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Status check overrides' }).click();
        await expect(own).toHaveURL(new RegExp(`${PAGE}$`));
        await expect(group(own, f)).toContainText('dashboard: Off (set here)');
        await rowOf(own, f.key('tile', 'on')).getByRole('checkbox').check();
        await own.getByRole('button', { name: 'Restore inheritance for 1 selected' }).click();
        await own.getByTestId('so-preview').getByRole('button', { name: 'Confirm' }).click();
        await expect(own.getByTestId('so-refusal')).toContainText(`"${f.name}" is being edited`);
        const d = await dashboardOf(page, f.dashId);
        expect(d.revision).toBe(1);
        expect(d.tabs[0].root.children[0].statusCheck.enabled).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  test('a dashboard changed elsewhere refuses visibly and the list reloads', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      await open(page, f);
      // Another browser saves the dashboard after this page loaded.
      const r = await page.request.put(`/api/dashboards/${encodeURIComponent(f.dashId)}/settings`, {
        headers: { 'X-CSRF-Token': await getCsrfToken(context), 'Content-Type': 'application/json' },
        data: JSON.stringify({ overrides: { statusCheckIntervalMinutes: 7 }, revision: 1 })
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      await rowOf(page, f.key('tile', 'on')).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Restore inheritance for 1 selected' }).click();
      await page.getByTestId('so-preview').getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByTestId('so-refusal')).toContainText('changed somewhere else');
      expect((await dashboardOf(page, f.dashId)).tabs[0].root.children[0].statusCheck.enabled).toBe(true);
      // Reloaded: trying again now saves.
      await rowOf(page, f.key('tile', 'on')).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Restore inheritance for 1 selected' }).click();
      await page.getByTestId('so-preview').getByRole('button', { name: 'Confirm' }).click();
      await expect(rowOf(page, f.key('tile', 'on'))).toHaveCount(0);
      expect((await dashboardOf(page, f.dashId)).tabs[0].root.children[0].statusCheck.enabled).toBeUndefined();
    });
  });

  test('iPad portrait width (768 px): no sideways scrolling', async ({ page, context }) => {
    // Between the phone layout and a wide screen the settings content area is narrower than the
    // row's four columns once needed; the rows must wrap or stack, never push the page sideways.
    await page.setViewportSize({ width: 768, height: 1024 });
    await withFixture(page, context, async (f) => {
      await open(page, f);
      await filter(page, /^All/).check();
      await expect(group(page, f).getByTestId('so-row')).toHaveCount(3); // the dashboard, tile On, folder Lab
      await group(page, f).getByTestId('so-row').first().getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Restore inheritance for 1 selected' }).click();
      await expect(page.getByTestId('so-preview')).toBeVisible();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll<HTMLElement>('[data-testid="status-overrides"] *')]
          .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 0.5)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
        return { scroll: doc.scrollWidth, client: doc.clientWidth, wide: wide.slice(0, 5) };
      });
      expect(overflow.wide, 'elements past the right edge').toEqual([]);
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  });

  test('phone width: rows stack and restoring the dashboard override works', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withFixture(page, context, async (f) => {
      await open(page, f);
      const dashRow = rowOf(page, `${f.dashId}:dashboard:${f.dashId}`);
      await expect(dashRow).toBeVisible();
      const box = await dashRow.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);
      // Stacked: the effect sits below the path.
      const what = await dashRow.locator('.what').boundingBox();
      const eff = await dashRow.locator('.effect').boundingBox();
      expect(eff!.y).toBeGreaterThan(what!.y);
      await dashRow.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Restore inheritance for 1 selected' }).click();
      await expect(page.getByTestId('so-preview')).toContainText('will start checking 1 tile and stop checking 0 tiles');
      await page.getByTestId('so-preview').getByRole('button', { name: 'Confirm' }).click();
      await expect(dashRow).toHaveCount(0);
      // Under a global On, the tile and the folder that are On no longer change anything.
      await filter(page, /^No effect/).check();
      await expect(group(page, f)).toContainText('dashboard: follows global (on)');
      await expect(group(page, f).getByTestId('so-row')).toHaveCount(2);
      await filter(page, /^Would change something/).check();
      const s = await (await page.request.get(`/api/dashboards/${encodeURIComponent(f.dashId)}/settings`)).json();
      expect(s.overrides.statusChecksEnabled ?? null).toBeNull();
    });
  });
});

async function loggedOutPage(browser: Browser): Promise<{ page: Page; ctx: BrowserContext }> {
  // Explicitly empty: in Playwright Test a new context would otherwise inherit the project's auth.json.
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
  });
  return { page: await ctx.newPage(), ctx };
}
