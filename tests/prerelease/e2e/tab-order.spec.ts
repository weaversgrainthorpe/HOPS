import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken, signInDialog } from '../helpers';

// Settings › Dashboards › Tab order: big reorders of one dashboard's tabs (move one tab a long way,
// a batch together, drag a row), saved as one revision-checked save, refused while the dashboard is
// being edited. Synthetic data only. Needs Chromium (real drag and drop).

let seq = 0;
const made: string[] = [];

async function seed(page: Page, context: BrowserContext, tabCount = 60) {
  const p = `tord${Date.now().toString(36)}${(seq++).toString(36)}`;
  const tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: `${p}-t${i + 1}`, name: `Tab ${i + 1}`, order: i, root: { columns: 24, children: i === 0
      ? [{ id: `${p}-a`, kind: 'tile', type: 'link', name: 'Alpha', url: 'https://alpha.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } }]
      : [] }
  }));
  const dash = {
    id: `${p}-dash`, name: `Order ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { id: dash.id, name: dash.name, path: `/${p}`, tile: `${p}-a` };
}

async function serverOrder(page: Page, id: string): Promise<string[]> {
  const cfg = await (await page.request.get('/api/config')).json();
  return cfg.dashboards.find((d: { id: string }) => d.id === id).tabs.map((t: { name: string }) => t.name);
}

/** From the Dashboards list, click the dashboard's Tab order button. */
async function openTabOrder(page: Page, name: string) {
  await page.goto('/settings/dashboards');
  await page.getByRole('link', { name: `Tab order for ${name}` }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Tab order: ${name}`) })).toBeVisible();
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
    expect(r.ok()).toBeTruthy();
  }
});

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('tab order page', () => {
  test('move one tab a long way', async ({ page, context }) => {
    const d = await seed(page, context);
    await openTabOrder(page, d.name);
    await expect(page.getByText('(60 tabs)')).toBeVisible();
    const row = page.locator('[data-tab-row]', { has: page.getByRole('checkbox', { name: 'Tab 55', exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Move Tab 55 to the top' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save order' }).click();
    await expect(page.getByText('Tab order saved')).toBeVisible();
    await expect(page.getByText('No changes')).toBeVisible();
    expect((await serverOrder(page, d.id)).slice(0, 3)).toEqual(['Tab 55', 'Tab 1', 'Tab 2']);
  });

  test('move a batch to a typed position', async ({ page, context }) => {
    const d = await seed(page, context);
    await openTabOrder(page, d.name);
    for (const n of [10, 20, 30]) await page.getByRole('checkbox', { name: `Tab ${n}`, exact: true }).check();
    await expect(page.getByText('3 ticked')).toBeVisible();
    await page.getByRole('spinbutton').fill('2');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('button', { name: 'Save order' }).click();
    await expect(page.getByText('Tab order saved')).toBeVisible();
    expect((await serverOrder(page, d.id)).slice(0, 5)).toEqual(['Tab 1', 'Tab 10', 'Tab 20', 'Tab 30', 'Tab 2']);
  });

  test('drag a row by its handle', async ({ page, context }) => {
    const d = await seed(page, context);
    await openTabOrder(page, d.name);
    const target = page.locator('[data-tab-row]', { has: page.getByRole('checkbox', { name: 'Tab 1', exact: true }) });
    await page.getByRole('button', { name: 'Drag Tab 3', exact: true }).dragTo(target);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save order' }).click();
    await expect(page.getByText('Tab order saved')).toBeVisible();
    expect((await serverOrder(page, d.id)).slice(0, 3)).toEqual(['Tab 3', 'Tab 1', 'Tab 2']);
  });

  test('refused while the dashboard has an unsaved draft, and nothing is saved', async ({ browser, page, context }) => {
    const d = await seed(page, context, 6);
    // The edit session lives in one page's memory, and leaving the dashboard drops a clean or dirty
    // session (with a warning). What survives a client-side move to Settings is a parked draft: the
    // unsaved changes kept when the sign-in ends. So: make a draft, end the server session, Save
    // (which finds out and parks it), then go to the Tab order page by links in that same page.
    // Own signed-out context, because logging out ends the server session of the shared one.
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
    });
    try {
      const anon = await ctx.newPage();
      await anon.goto(d.path);
      await anon.getByRole('button', { name: 'Enter Edit Mode' }).click();
      await signInDialog(anon);
      await expect(anon.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
      await anon.locator(`[data-node-id="${d.tile}"]`).click({ button: 'right' });
      await anon.getByRole('menuitem', { name: 'Edit' }).click();
      await anon.getByRole('dialog').locator('input#name').fill('Alpha draft');
      await anon.getByRole('dialog').getByRole('button', { name: /^Save$/ }).click();
      const csrf = (await ctx.cookies()).find((c) => c.name === 'hops_csrf')!.value;
      expect((await anon.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrf } })).ok()).toBeTruthy();
      await anon.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
      await expect(anon.locator('.parked-banner')).toContainText('sign in to save your changes');

      await anon.getByRole('link', { name: 'Settings', exact: true }).click();
      await signInDialog(anon);
      await expect(anon.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
      await anon.getByRole('link', { name: `Tab order for ${d.name}` }).click();
      await anon.getByRole('button', { name: 'Move Tab 6 to the top' }).click();
      await anon.getByRole('button', { name: 'Save order' }).click();
      await expect(anon.locator('[data-tab-order-problem]')).toHaveText(
        `Not saved: "${d.name}" is being edited (an edit session or unsaved draft is open). Save or discard that first, then save the tab order.`
      );
      expect(await serverOrder(page, d.id)).toEqual(['Tab 1', 'Tab 2', 'Tab 3', 'Tab 4', 'Tab 5', 'Tab 6']);
    } finally {
      await ctx.close();
    }
  });

  test('the dashboard shows the new order', async ({ page, context }) => {
    const d = await seed(page, context, 6);
    await openTabOrder(page, d.name);
    await page.getByRole('button', { name: 'Move Tab 6 to the top' }).click();
    await page.getByRole('button', { name: 'Save order' }).click();
    await expect(page.getByText('Tab order saved')).toBeVisible();
    await page.goto(d.path);
    await expect(page.getByRole('tab').first()).toHaveAccessibleName(/Tab 6/);
  });
});
