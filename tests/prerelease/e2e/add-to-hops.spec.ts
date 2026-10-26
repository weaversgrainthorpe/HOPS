import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken, signInDialog, openSettings, setSetting } from '../helpers';

// "Add to HOPS": the bookmarklet on Settings › Dashboards, and the /add page it opens. The query
// parameters only prefill; nothing is created until a signed-in user clicks Add.

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

/** A dashboard with two tabs; the second holds a folder. */
async function importDash(page: Page, context: BrowserContext) {
  const p = `addh${Date.now().toString(36)}`;
  const tab = (id: string, name: string, order: number, children: unknown[]) => ({ id: `${p}-${id}`, name, order, root: { columns: 24, children } });
  const dash = {
    id: `${p}-dash`, name: `AddTo ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [
      tab('t1', 'Main', 0, [{
        id: `${p}-x`, kind: 'tile', type: 'link', name: 'Existing', url: 'http://x.addh.test/', icon: 'mdi:server',
        size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 }
      }]),
      tab('t2', 'Second', 1, [{
        id: `${p}-f`, kind: 'folder', name: 'Media', display: 'expanded', size: 'medium', contentSize: 'medium',
        showTitle: true, placement: { x: 0, y: 0, w: 6, h: 6 }, content: { children: [] }
      }])
    ]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'add.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  madeIds.push(dash.id);
  return { id: dash.id, name: dash.name, path: `/${p}`, t1: `${p}-t1`, t2: `${p}-t2`, folder: `${p}-f` };
}

async function storedDash(page: Page, id: string) {
  return (await (await page.request.get('/api/config')).json()).dashboards.find((d: { id: string }) => d.id === id);
}

const addForm = (page: Page) => page.getByRole('form', { name: 'Add to HOPS' });
const addUrl = (o: Record<string, string>) => `/add?${new URLSearchParams(o).toString()}`;

test('signed out: /add asks to sign in first, then shows the prefilled form', async ({ browser, page: admin }) => {
  // api/boundaries.spec exhausts the per-IP sign-in limit on purpose; raise it for this test only.
  const before = await setSetting(admin, 'auth.login_rate_limit_per_min', '1000');
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }
  });
  const page = await ctx.newPage();
  try {
    await page.goto(addUrl({ url: 'https://grafana.addh.test/d/abc', name: 'Grafana <b>Boards</b>', icon: 'https://grafana.addh.test/fav.png' }));
    await signInDialog(page);
    const f = addForm(page);
    await expect(f).toBeVisible();
    await expect(f.getByLabel('Name', { exact: true })).toHaveValue('Grafana <b>Boards</b>'); // text, never HTML
    await expect(f.getByLabel('Address', { exact: true })).toHaveValue('https://grafana.addh.test/d/abc');
    await expect(f.getByLabel('Icon image address (optional)')).toHaveValue(/addh\.test\/fav\.png|\/api\/icons\/dashboard\/grafana\.svg/);
  } finally {
    await ctx.close();
    await setSetting(admin, 'auth.login_rate_limit_per_min', before);
  }
});

test('Add puts the tile on the chosen dashboard, tab and folder; then Open the dashboard', async ({ page, context }) => {
  const d = await importDash(page, context);
  await page.goto(addUrl({ url: 'https://tool.addh.test/', name: 'My Tool' }));
  const f = addForm(page);
  await f.getByLabel('Dashboard').selectOption({ label: d.name });
  await f.getByLabel('Tab').selectOption({ label: 'Second' });
  await expect(f.getByLabel('Folder (optional)')).toHaveValue('');
  await f.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(`Added “My Tool” to ${d.name}.`)).toBeVisible();
  let stored = await storedDash(page, d.id);
  const t2 = stored.tabs.find((t: { id: string }) => t.id === d.t2);
  const tile = t2.root.children.find((n: { name: string }) => n.name === 'My Tool');
  expect(tile).toMatchObject({ kind: 'tile', url: 'https://tool.addh.test/' });
  expect(tile.placement).toBeTruthy();
  // First free spot: not on top of the folder at 0,0.
  expect(tile.placement.x >= 6 || tile.placement.y >= 6).toBe(true);

  // The browser remembers where it last added; into the folder this time.
  await page.goto(addUrl({ url: 'https://tool2.addh.test/', name: 'In Folder' }));
  await expect(f.getByLabel('Dashboard')).toHaveValue(d.id);
  await expect(f.getByLabel('Tab')).toHaveValue(d.t2);
  await f.getByLabel('Folder (optional)').selectOption({ label: 'Media' });
  await f.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/Added “In Folder”/)).toBeVisible();
  stored = await storedDash(page, d.id);
  const folder = stored.tabs.find((t: { id: string }) => t.id === d.t2).root.children.find((n: { id: string }) => n.id === d.folder);
  expect(folder.content.children.map((n: { name: string }) => n.name)).toEqual(['In Folder']);

  await page.getByRole('link', { name: 'Open the dashboard' }).click();
  await expect(page).toHaveURL(new RegExp(`${d.path}$`));
});

test('a javascript: or data: address is refused, visibly, and Add creates nothing', async ({ page, context }) => {
  const d = await importDash(page, context);
  for (const bad of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>']) {
    const before = await storedDash(page, d.id);
    await page.goto(addUrl({ url: bad, name: 'Evil' }));
    const f = addForm(page);
    await expect(page.getByRole('alert', { name: 'Problems with the page details' })).toContainText("The page address can't be used");
    await expect(f.getByLabel('Address', { exact: true })).toHaveValue('');
    await f.getByLabel('Dashboard').selectOption({ label: d.name });
    await f.getByRole('button', { name: 'Add' }).click();
    await expect(f.locator('#add-error')).toContainText("That URL can't be used");
    expect((await storedDash(page, d.id)).revision).toBe(before.revision);
  }
});

test('opening /add creates nothing until Add is clicked', async ({ page, context }) => {
  const d = await importDash(page, context);
  const before = JSON.stringify(await (await page.request.get('/api/config')).json());
  const writes: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await page.goto(addUrl({ url: 'https://idle.addh.test/', name: 'Zqx Unclicked' }));
  await expect(addForm(page)).toBeVisible();
  await addForm(page).getByLabel('Dashboard').selectOption({ label: d.name });
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
  expect(JSON.stringify(await (await page.request.get('/api/config')).json())).toBe(before);
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(JSON.stringify(await (await page.request.get('/api/config')).json())).not.toContain('Zqx Unclicked');
});

test('Settings › Dashboards shows the draggable Add to HOPS bookmark', async ({ page, baseURL }) => {
  await openSettings(page);
  const link = page.getByRole('link', { name: 'Add to HOPS' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('draggable', 'true');
  const href = (await link.getAttribute('href')) ?? '';
  expect(href.startsWith('javascript:')).toBe(true);
  expect(href).toContain(`${new URL(baseURL!).origin}/add?url=`);
  await expect(page.getByLabel('Add to HOPS bookmark code')).toHaveValue(href);
  await expect(page.getByText(/Some sites block bookmarks like this one/)).toBeVisible();
  await expect(page.getByText(/For desktop browsers/)).toBeVisible();
});
