import { test, expect, type Page, type BrowserContext, type Request } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Viewer pages load only the open dashboard first (GET /api/config?dashboard=…), then the other
// dashboards in the background (GET /api/config). In a real browser against a real server:
// the first config read is the light one; a dashboard opened before the rest arrives is fetched on
// its own and shown; search across dashboards waits for the rest, says so, and shows a failure with
// Retry; an unknown path is "not found" as before; editing still loads everything and saves, and a
// conflicting save is still refused visibly.

let seq = 0;
const made: string[] = [];

const tile = (id: string, name: string) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 }
});

/** Import two small dashboards, each with one uniquely named tile. */
async function setup(page: Page, context: BrowserContext) {
  const p = `pl${Date.now().toString(36)}${(seq++).toString(36)}`;
  const mk = (k: string, order: number) => ({
    id: `${p}-${k}`, name: `Partial ${k.toUpperCase()} ${p}`, order: 900 + order, path: `/${p}-${k}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs: [{ id: `${p}-${k}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [tile(`${p}-${k}-tile`, `Tile${k}${p}`)] } }]
  });
  const a = mk('a', 0);
  const b = mk('b', 1);
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'full', config: { layoutVersion: 2, dashboards: [a, b] } };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'partial.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(a.id, b.id);
  return { p, a, b };
}

test.afterEach(async ({ page, context }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
    expect(r.ok()).toBeTruthy();
  }
});

const isWholeConfig = (url: string) => new URL(url).pathname === '/api/config' && !new URL(url).searchParams.has('dashboard');
const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`).first();

/** A client-side navigation (the app's router handles the click), as the switcher would do. */
async function clientNavigate(page: Page, href: string) {
  await page.evaluate((h) => {
    const a = document.createElement('a');
    a.href = h;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, href);
}

async function openSearch(page: Page) {
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: /search tiles/i });
  await expect(input).toBeVisible();
  return input;
}

test.describe('viewer loads only the open dashboard', () => {
  test('the first config read for a dashboard path is the ?dashboard= one; the rest follows in the background', async ({ page, context }) => {
    const f = await setup(page, context);
    const reads: string[] = [];
    page.on('request', (r: Request) => {
      if (new URL(r.url()).pathname.startsWith('/api/config')) reads.push(r.url());
    });
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    await expect.poll(() => reads.some(isWholeConfig)).toBe(true);
    const first = new URL(reads[0]);
    expect(first.pathname).toBe('/api/config');
    expect(first.searchParams.get('dashboard')).toBe(f.a.path.slice(1));
  });

  test('a dashboard opened before the rest arrives is fetched on its own and shown', async ({ page, context }) => {
    const f = await setup(page, context);
    // Hold the background load: it never answers during this test.
    await page.route((u) => isWholeConfig(u.toString()), () => {});
    const one = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/config/dashboard/${f.b.id}`);
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    await clientNavigate(page, f.b.path);
    await one;
    await expect(node(page, f.b.tabs[0].root.children[0].id)).toBeVisible();
    await expect(page.getByText('Dashboard not found')).toHaveCount(0);
  });

  test('an unknown path is "not found" as before; search across dashboards finds a tile once the rest has loaded', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(`/${f.p}-nope`);
    await expect(page.getByRole('heading', { name: 'Dashboard not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible();
    const input = await openSearch(page);
    await input.fill(`Tileb${f.p}`);
    const hit = page.getByRole('button', { name: new RegExp(`Tileb${f.p}`) });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText(f.b.name);
    await expect(page.getByText('Loading the other dashboards…')).toHaveCount(0);
  });

  test('when the background load fails, an ordinary dashboard page shows a small bar with Retry and stays usable', async ({ page, context }) => {
    const f = await setup(page, context);
    let fail = true;
    await page.route((u) => isWholeConfig(u.toString()), (route) => (fail ? route.abort() : route.continue()));
    await page.goto(f.a.path);
    const tileA = node(page, f.a.tabs[0].root.children[0].id);
    await expect(tileA).toBeVisible();
    const bar = page.getByRole('alert').filter({ hasText: "Couldn't load the other dashboards" });
    await expect(bar).toBeVisible();
    await expect(tileA).toBeVisible();
    fail = false;
    await bar.getByRole('button', { name: 'Retry' }).click();
    await expect(bar).toHaveCount(0);
    await expect(tileA).toBeVisible();
  });

  test('when the background load fails, search says so with Retry, and Retry recovers', async ({ page, context }) => {
    const f = await setup(page, context);
    let fail = true;
    await page.route((u) => isWholeConfig(u.toString()), (route) => (fail ? route.abort() : route.continue()));
    await page.goto(`/${f.p}-nope`);
    await expect(page.getByRole('heading', { name: 'Dashboard not found' })).toBeVisible();
    const input = await openSearch(page);
    await input.fill(`Tileb${f.p}`);
    const failed = page.locator('.search-panel').getByRole('alert').filter({ hasText: "Couldn't load the other dashboards" });
    await expect(failed).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`Tileb${f.p}`) })).toHaveCount(0);
    fail = false;
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: new RegExp(`Tileb${f.p}`) })).toBeVisible();
    await expect(failed).toHaveCount(0);
  });

  test('Settings opened from a dashboard waits for every dashboard; a failure shows with Retry, and Retry opens it', async ({ page, context }) => {
    const f = await setup(page, context);
    let fail = true;
    await page.route((u) => isWholeConfig(u.toString()), (route) => (fail ? route.abort() : route.continue()));
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    await clientNavigate(page, '/settings/dashboards');
    await page.waitForURL('**/settings/dashboards'); // the dashboard page's own bar has gone
    const failed = page.getByRole('alert').filter({ hasText: "Couldn't load the other dashboards" });
    await expect(failed).toBeVisible();
    await expect(page.getByRole('button', { name: 'New dashboard' })).toHaveCount(0);
    fail = false;
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'New dashboard' })).toBeVisible();
    await expect(failed).toHaveCount(0);
  });

  test('the pencil waits for every dashboard: busy and named, a failure shows with Retry, and Retry starts editing', async ({ page, context }) => {
    const f = await setup(page, context);
    let mode: 'hold' | 'fail' | 'pass' = 'hold';
    let held: (() => void)[] = [];
    await page.route((u) => isWholeConfig(u.toString()), async (route) => {
      if (mode === 'hold') await new Promise<void>((res) => held.push(res));
      await (mode === 'fail' ? route.abort() : route.continue());
    });
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    const pencil = page.locator('[aria-label="Enter edit mode"]');
    await pencil.click();
    await expect(pencil).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Loading the other dashboards…' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toHaveCount(0);

    mode = 'fail';
    held.forEach((res) => res());
    held = [];
    const failed = page.getByRole('alert').filter({ hasText: "Couldn't load the other dashboards" });
    await expect(failed).toBeVisible();
    await expect(pencil).toBeEnabled();

    mode = 'pass';
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(page.locator('[aria-label="Exit edit mode"]')).toBeEnabled();
  });

  test('Add to HOPS opened from a dashboard loads every dashboard before its form', async ({ page, context }) => {
    const f = await setup(page, context);
    let fail = true;
    await page.route((u) => isWholeConfig(u.toString()), (route) => (fail ? route.abort() : route.continue()));
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    await clientNavigate(page, '/add?url=https%3A%2F%2Fnew.example.lan%2F&name=New');
    await page.waitForURL('**/add?*'); // the dashboard page's own bar has gone
    const failed = page.getByRole('alert').filter({ hasText: "Couldn't load the other dashboards" });
    await expect(failed).toBeVisible();
    await expect(page.getByRole('form', { name: 'Add to HOPS' })).toHaveCount(0);
    fail = false;
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('form', { name: 'Add to HOPS' })).toBeVisible();
  });

  test('editing loads every dashboard first, saves, and a conflicting save is still refused visibly', async ({ page, context }) => {
    const f = await setup(page, context);
    await page.goto(f.a.path);
    await expect(node(page, f.a.tabs[0].root.children[0].id)).toBeVisible();
    await page.locator('[aria-label="Enter edit mode"]').click();
    const toolbar = page.getByRole('toolbar', { name: 'Editing' });
    await expect(toolbar).toBeVisible();

    const addTab = async (name: string) => {
      await toolbar.getByRole('button', { name: 'Add tab' }).click();
      const dlg = page.getByRole('dialog', { name: 'New tab' });
      await dlg.locator('input#name').fill(name);
      await dlg.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByRole('tab', { name: `Switch to ${name} tab` })).toBeVisible();
    };
    await addTab('Saved tab');
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await toolbar.getByRole('button', { name: /Save/ }).click();
    expect((await saved).status()).toBe(200);
    const stored = await (await page.request.get(`/api/config/dashboard/${f.a.id}`)).json();
    expect(stored.dashboard.tabs.map((t: { name: string }) => t.name)).toContain('Saved tab');

    // Someone else saves the same dashboard: this page's next save is refused (409), visibly.
    const put = await page.request.put(`/api/dashboards/${encodeURIComponent(f.a.id)}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context), 'Content-Type': 'application/json' },
      data: JSON.stringify({ schema: 3, dashboard: { ...stored.dashboard, name: `${f.a.name} elsewhere` }, revision: stored.revision, layoutVersion: 2 })
    });
    expect(put.status(), await put.text()).toBe(200);
    await addTab('Conflicting tab');
    const refused = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await toolbar.getByRole('button', { name: /Save/ }).click();
    expect((await refused).status()).toBe(409);
    await expect(page.getByRole('alert').filter({ hasText: /changed somewhere else/ }).first()).toBeVisible();
  });
});
