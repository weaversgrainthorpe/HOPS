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

// ---------------------------------------------------------------- the dashboard you came from

/** The bookmark clicked on a HOPS page: HOPS opens /add in place (in-app, keeping an edit). */
async function bookmarkOnHops(page: Page, o: Record<string, string>) {
  await page.evaluate((u) => (window as unknown as { hopsAdd: (u: string) => void }).hopsAdd(u), new URL(addUrl(o), page.url()).href);
  await expect(page).toHaveURL(/\/add\?/);
  await expect(addForm(page)).toBeVisible();
}

async function openEditing(page: Page, path: string, tab: string) {
  await page.goto(path);
  await page.getByRole('tab', { name: tab }).click();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

test('while editing: /add proposes that dashboard and tab, adds INTO the draft (undoable, nothing PUT), and Cancel returns to the editor', async ({ page, context }) => {
  const d = await importDash(page, context);
  await openEditing(page, d.path, 'Second');
  const rev = (await storedDash(page, d.id)).revision;
  const puts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });

  // Cancel goes back to the dashboard, still editing — never "/".
  await bookmarkOnHops(page, { url: 'https://cancel.addh.test/', name: 'Zqx Cancelled' });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`${d.path}$`));
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();

  await bookmarkOnHops(page, { url: 'https://showcase.addh.test/', name: 'Showcase Tool' });
  const f = addForm(page);
  await expect(f.getByLabel('Dashboard')).toHaveValue(d.id);
  await expect(f.getByLabel('Tab')).toHaveValue(d.t2);
  await expect(page.getByTestId('add-target')).toHaveText(`Adding to ${d.name}`);
  await expect(page.getByText(`Adds to your unsaved changes on ${d.name}.`)).toBeVisible();
  await f.getByRole('button', { name: 'Add' }).click();

  // Back in the editor on that dashboard and tab, the tile part of the unsaved changes.
  await expect(page).toHaveURL(new RegExp(`${d.path}$`));
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('status')).toHaveText(/Unsaved changes/);
  await expect(page.getByText('Showcase Tool', { exact: true })).toBeVisible();
  expect(puts).toEqual([]);
  expect((await storedDash(page, d.id)).revision).toBe(rev);

  // Undo removes it, like any edit.
  await bar.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByText('Showcase Tool', { exact: true })).toHaveCount(0);
  await expect(bar.getByRole('status')).toHaveCount(0);
  expect(puts).toEqual([]);
  expect(JSON.stringify(await storedDash(page, d.id))).not.toContain('Showcase Tool');
});

test('not editing: /add proposes the dashboard last viewed in this browser', async ({ page, context }) => {
  const d = await importDash(page, context);
  // Another dashboard was the last add target (any id; a missing one is skipped); the viewed one wins.
  await page.goto(d.path);
  await page.evaluate(() => localStorage.setItem('hops.addToHops.last', JSON.stringify({ dashboardId: 'sample' })));
  await page.getByRole('tab', { name: 'Second' }).click();
  await page.goto(addUrl({ url: 'https://viewed.addh.test/', name: 'Viewed' }));
  const f = addForm(page);
  await expect(f.getByLabel('Dashboard')).toHaveValue(d.id);
  await expect(f.getByLabel('Tab')).toHaveValue(d.t2);
  await expect(page.getByTestId('add-target')).toHaveText(`Adding to ${d.name}`);
  await expect(page.getByText(/Adds to your unsaved changes/)).toHaveCount(0);
});

test('opened by the bookmark in a new tab (no history): Cancel closes it or says you can', async ({ context }) => {
  const p = await context.newPage();
  await p.goto(addUrl({ url: 'https://newtab.addh.test/', name: 'New Tab' }));
  await expect(addForm(p)).toBeVisible();
  await p.getByRole('button', { name: 'Cancel' }).click();
  // Either the browser let the page close itself, or it says so — never off to another dashboard.
  await expect.poll(async () => p.isClosed() || (await p.getByText('You can close this tab.').isVisible())).toBe(true);
  if (!p.isClosed()) {
    await expect(p).toHaveURL(/\/add\?/);
    await p.close();
  }
});

// ---------------------------------------------------------------- an edit open in ANOTHER tab
// Two pages in one context share BroadcastChannel, like two tabs of one browser.

const bar = (p: Page) => p.getByRole('toolbar', { name: 'Editing' });

/** A change in the editor: a tile added through the toolbar's Add tile (an undoable draft edit). */
async function addTileInEditor(p: Page, name: string) {
  await bar(p).getByRole('button', { name: 'Add tile' }).click();
  const dlg = p.getByRole('dialog', { name: 'New Tile' });
  await dlg.locator('input#name').fill(name);
  await dlg.locator('input#url').fill(`https://${name.toLowerCase().replace(/\W+/g, '')}.addh.test/`);
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(p.getByText(name, { exact: true })).toBeVisible();
}

const tilesNamed = (dash: { tabs: { root: unknown }[] }, name: string) => JSON.stringify(dash.tabs).split(`"name":"${name}"`).length - 1;

test('an edit with unsaved changes in another tab: told up front; Add hands the tile to that draft (undoable, nothing saved)', async ({ page, context }) => {
  const d = await importDash(page, context);
  await openEditing(page, d.path, 'Main');
  await addTileInEditor(page, 'Mine First');
  const rev = (await storedDash(page, d.id)).revision;
  const puts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
  const b = await context.newPage();
  b.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
  try {
    await b.goto(addUrl({ url: 'https://grafana.addh.test/', name: 'Grafana' }));
    const f = addForm(b);
    await f.getByLabel('Dashboard').selectOption(d.id);
    // Before any input: the note says where the tile will go.
    await expect(b.getByTestId('presence-note')).toHaveText(`${d.name} is open for editing in another tab — the tile will be added to that edit.`);
    await expect(b.getByText("Using HOPS's bundled icon for this service.")).toBeVisible(); // a relative icon address still submits
    await f.getByRole('button', { name: 'Add' }).click();
    await expect(b.getByText(`Added to your edit of ${d.name} in your other tab. You can close this tab.`)).toBeVisible();

    // In A: part of the draft, toasted, unsaved; Undo removes it (and only it); nothing was saved.
    await expect(page.getByText('Added “Grafana” from Add to HOPS — save to keep it.')).toBeVisible();
    await expect(page.getByText('Grafana', { exact: true })).toBeVisible();
    await expect(bar(page).getByRole('status')).toHaveText(/Unsaved changes/);
    await bar(page).getByRole('button', { name: /Undo/ }).click();
    await expect(page.getByText('Grafana', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Mine First', { exact: true })).toBeVisible();
    await expect(bar(page).getByRole('status')).toHaveText(/Unsaved changes/);
    expect(puts).toEqual([]);
    expect((await storedDash(page, d.id)).revision).toBe(rev);
  } finally {
    await b.close();
  }
});

test('a clean edit in another tab: Add saves directly; that tab follows the new revision and its next Save does not conflict', async ({ page, context }) => {
  const d = await importDash(page, context);
  await openEditing(page, d.path, 'Main');
  const rev = (await storedDash(page, d.id)).revision;
  const b = await context.newPage();
  try {
    await b.goto(addUrl({ url: 'https://direct.addh.test/', name: 'Direct One' }));
    const f = addForm(b);
    await f.getByLabel('Dashboard').selectOption(d.id);
    await expect(b.getByTestId('presence-note')).toHaveText(`${d.name} is open for editing in another tab with no unsaved changes — the tile will be saved and that tab updated.`);
    await f.getByRole('button', { name: 'Add' }).click();
    await expect(b.getByText(`Added “Direct One” to ${d.name}. The tab editing it was updated.`)).toBeVisible();
    expect((await storedDash(page, d.id)).revision).toBeGreaterThan(rev);

    // A follows (still editing, still clean), then a change of its own saves without a conflict.
    await expect(page.getByText('A tile was added from Add to HOPS', { exact: false })).toBeVisible();
    await expect(page.getByText('Direct One', { exact: true })).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await addTileInEditor(page, 'After Follow');
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await bar(page).getByRole('button', { name: /Save/ }).click();
    expect((await saved).status()).toBe(200);
    const stored = await storedDash(page, d.id);
    expect(tilesNamed(stored, 'Direct One')).toBe(1);
    expect(tilesNamed(stored, 'After Follow')).toBe(1);
  } finally {
    await b.close();
  }
});

test('the hand-off is not acknowledged: a visible failure with Copy / Try again; the retry adds nothing twice', async ({ page, context }) => {
  const d = await importDash(page, context);
  const a = await context.newPage();
  await openEditing(a, d.path, 'Main');
  await addTileInEditor(a, 'Mine First');
  // A takes the tile but its ACK is lost (the tab died or hung mid-flight, as far as /add can tell).
  await a.evaluate(() => {
    const w = window as unknown as { __post: typeof BroadcastChannel.prototype.postMessage };
    w.__post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (m: { type?: string }) {
      if (m?.type !== 'added') w.__post.call(this, m);
    };
  });
  const b = await context.newPage();
  try {
    await b.goto(addUrl({ url: 'https://handoff.addh.test/', name: 'Zqx Handoff' }));
    const f = addForm(b);
    await f.getByLabel('Dashboard').selectOption(d.id);
    await expect(b.getByTestId('presence-note')).toContainText('the tile will be added to that edit');
    await f.getByRole('button', { name: 'Add' }).click();
    await expect(f.locator('#add-error')).toContainText("didn't confirm it took the tile", { timeout: 6000 });
    await expect(f.getByRole('button', { name: 'Copy the details' })).toBeVisible();
    expect(JSON.stringify(await storedDash(page, d.id))).not.toContain('Zqx Handoff');

    // The ACKs work again; Try again re-sends the same idempotency id: ACKed, not added a second time.
    await a.evaluate(() => {
      BroadcastChannel.prototype.postMessage = (window as unknown as { __post: typeof BroadcastChannel.prototype.postMessage }).__post;
    });
    await f.getByRole('button', { name: 'Try again' }).click();
    await expect(b.getByText(`Added to your edit of ${d.name} in your other tab. You can close this tab.`)).toBeVisible();
    await expect(a.getByText('Zqx Handoff', { exact: true })).toHaveCount(1);
    expect(JSON.stringify(await storedDash(page, d.id))).not.toContain('Zqx Handoff');

    // Saved from A: exactly one.
    const saved = a.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await bar(a).getByRole('button', { name: /Save/ }).click();
    expect((await saved).status()).toBe(200);
    expect(tilesNamed(await storedDash(page, d.id), 'Zqx Handoff')).toBe(1);
  } finally {
    await b.close();
    await a.close();
  }
});
