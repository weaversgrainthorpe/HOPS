import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken, flourishesDone } from '../helpers';

// M3 editor, in a REAL browser (Ruling 29). The jsdom suites stub hit-testing and layout, so they
// cannot see CSS stacking (tab controls over a tab button), real store wiring (the context menu
// nulling its own request), or where the dragged ghost sits relative to the pointer. These flows
// regressed exactly there:
//   1. merge: a tile grabbed off-centre and aimed with its ghost must make a folder;
//   2. drag to another tab: hold over the tab button, the tab switches, drop in its canvas;
//   3. the item context menu's Edit / Move-Copy / Delete for tiles and folders;
//   plus a plain click on a short tab in edit mode switches tab.
//
// Each test imports its own small v3 dashboard (unique ids + path) into the fresh test server.

let seq = 0;

interface Fixture {
  path: string;
  id: (s: string) => string;
}

function placement(x: number, y: number, w = 2, h = 2) {
  return { x, y, w, h };
}

// The M6 stored form (layoutVersion 2): 24-column grid tabs, a Medium tile 2 x 2 cells; folder contents
// are an ordered list with no placements; folders carry size and contentSize.
/** A tile inside a folder: no placement. */
function kid(id: string, name: string, order = 0) {
  return {
    id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order
  };
}

/** A Medium tile on a tab at cell (x, y). */
function tile(id: string, name: string, x: number, y: number, order: number) {
  return { ...kid(id, name, order), placement: placement(x, y) };
}

async function importFixture(page: Page, context: BrowserContext): Promise<Fixture> {
  const p = `m3e${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'),
    name: `M3 editing ${p}`,
    order: 0,
    path: `/${p}`,
    revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [
      {
        id: id('tab-grid'), name: 'Grid', order: 0,
        root: {
          columns: 24,
          children: [
            tile(id('a'), 'Alpha', 0, 0, 0),
            tile(id('b'), 'Bravo', 2, 0, 1),
            tile(id('c'), 'Charlie', 4, 0, 2),
            {
              id: id('fk'), kind: 'folder', name: 'Kept', display: 'collapsed', shape: 'rounded', size: 'medium', contentSize: 'medium',
              showTitle: true, placement: placement(12, 0, 6, 6),
              content: { children: [kid(id('k1'), 'Kilo')] }
            },
            {
              id: id('fe'), kind: 'folder', name: 'Open folder', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
              showTitle: true, placement: placement(0, 4, 12, 6),
              content: { children: [kid(id('e1'), 'Echo')] }
            }
          ]
        }
      },
      {
        id: id('tab-two'), name: 'Two', order: 1,
        root: { columns: 24, children: [tile(id('t1'), 'Tango', 0, 0, 0)] }
      }
    ]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
}

/** Open the dashboard in edit mode; collects page errors (any is a failure). */
async function openEditing(page: Page, f: Fixture): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(f.path);
  await expect(node(page, f.id('a'))).toBeVisible();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.locator('[aria-label="Exit Edit Mode"]')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  return errors;
}

const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`).first();
const tabButton = (page: Page, name: string) => page.getByRole('tab', { name: `Switch to ${name} tab` });

async function box(page: Page, id: string) {
  await flourishesDone(page); // §9: boxes at rest
  const b = await node(page, id).boundingBox();
  if (!b) throw new Error(`no box for ${id}`);
  return b;
}

/** A human-ish mouse drag: press at (x0,y0), travel in small steps to (x1,y1). */
async function dragTo(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
}

async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
}

type AnyNode = { id: string; kind: string; name?: string; content?: { children: AnyNode[] } };
async function storedTabs(page: Page, f: Fixture): Promise<{ id: string; root: { children: AnyNode[] } }[]> {
  const r = await page.request.get('/api/config');
  expect(r.status()).toBe(200);
  const cfg = await r.json();
  const d = cfg.dashboards.find((x: { id: string }) => x.id === f.id('dash'));
  expect(d, 'imported dashboard present').toBeTruthy();
  return d.tabs;
}

let made: { id: string } | null = null;

test.afterEach(async ({ page, context }) => {
  // Remove this test's dashboard so the next one starts with a short dashboard nav (a long one
  // widens the page and shifts the canvas). A failed delete is reported, not ignored.
  if (!made) return;
  const id = made.id;
  made = null;
  const cfg = await (await page.request.get('/api/config')).json();
  const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
  expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
  const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) }
  });
  expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
});

test.describe('M3 editor in a real browser', () => {
  test('merge: a tile grabbed off-centre, its ghost centred on another tile, held → a folder of both', async ({ page, context }) => {
    const f = await importFixture(page, context);
    const errors = await openEditing(page, f);
    const a = await box(page, f.id('a'));
    const b = await box(page, f.id('c'));
    // Grab A near its bottom-left (where its label is), not its centre.
    const gx = a.x + a.width * 0.15;
    const gy = a.y + a.height * 0.85;
    // Put the ghost's centre on C's centre: pointer = C centre + (grab − A centre).
    const tx = b.x + b.width / 2 + (gx - (a.x + a.width / 2));
    const ty = b.y + b.height / 2 + (gy - (a.y + a.height / 2));
    await dragTo(page, gx, gy, tx, ty);
    // The "hold to make a folder" cue shows before the dwell ripens…
    await expect(page.locator('.drag-layer .cue')).toContainText(/hold to make a folder/i);
    await page.waitForTimeout(700);
    // …and then the commit cue.
    await expect(page.locator('.drag-layer .cue')).toContainText(/make a folder/i);
    await page.mouse.up();
    // The new folder's dialog opens; keep its name.
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#folder-name')).toHaveValue('New folder');
    await dlg.locator('#folder-name').fill('Merged');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    await saveDraft(page);
    const root = (await storedTabs(page, f))[0].root.children;
    const made = root.find((n) => n.kind === 'folder' && n.name === 'Merged');
    expect(made, 'a folder named Merged exists').toBeTruthy();
    expect(made!.content!.children.map((n) => n.id).sort()).toEqual([f.id('a'), f.id('c')].sort());
    expect(errors).toEqual([]);
  });

  test('drag to another tab: hold over the tab button, the tab switches, drop in its canvas', async ({ page, context }) => {
    const f = await importFixture(page, context);
    const errors = await openEditing(page, f);
    const c = await box(page, f.id('c'));
    const tb = await tabButton(page, 'Two').boundingBox();
    if (!tb) throw new Error('no tab box');
    // Aim at the middle of the (short) tab button.
    await dragTo(page, c.x + c.width / 2, c.y + c.height / 2, tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.waitForTimeout(800);
    await expect(tabButton(page, 'Two')).toHaveAttribute('aria-selected', 'true');
    // Continue into the new tab's canvas: right of Tango.
    const t1 = await box(page, f.id('t1'));
    const dx = t1.x + t1.width * 3.5;
    const dy = t1.y + t1.height / 2;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(tb.x + tb.width / 2 + ((dx - tb.x - tb.width / 2) * i) / 10, tb.y + tb.height / 2 + ((dy - tb.y - tb.height / 2) * i) / 10);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(100);
    await page.mouse.up();
    await expect(tabButton(page, 'Two')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, f.id('c'))).toBeVisible();
    await saveDraft(page);
    const tabs = await storedTabs(page, f);
    expect(tabs[1].root.children.map((n) => n.id)).toContain(f.id('c'));
    expect(tabs[0].root.children.map((n) => n.id)).not.toContain(f.id('c'));
    expect(errors).toEqual([]);
  });

  test('context menu Edit on a tile, an expanded folder and a collapsed folder opens its dialog; saving renames it', async ({ page, context }) => {
    const f = await importFixture(page, context);
    const errors = await openEditing(page, f);

    // Tile
    await node(page, f.id('a')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const tileDlg = page.getByRole('dialog');
    await expect(tileDlg.locator('input#name')).toBeVisible();
    await tileDlg.locator('input#name').fill('Alpha renamed');
    await tileDlg.getByRole('button', { name: /^Save$/ }).click();
    await expect(node(page, f.id('a'))).toContainText('Alpha renamed');

    // Expanded folder (right-click its title bar)
    const fe = await box(page, f.id('fe'));
    await page.mouse.click(fe.x + fe.width / 2, fe.y + 10, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    let dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.locator('#folder-name').fill('Open renamed');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();

    // Collapsed folder
    await node(page, f.id('fk')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.locator('#folder-name').fill('Kept renamed');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();

    await saveDraft(page);
    const root = (await storedTabs(page, f))[0].root.children;
    expect(root.find((n) => n.id === f.id('a'))?.name).toBe('Alpha renamed');
    expect(root.find((n) => n.id === f.id('fe'))?.name).toBe('Open renamed');
    expect(root.find((n) => n.id === f.id('fk'))?.name).toBe('Kept renamed');
    expect(errors).toEqual([]);
  });

  test('context menu Move/Copy to… and Delete work for a tile and a folder', async ({ page, context }) => {
    const f = await importFixture(page, context);
    const errors = await openEditing(page, f);

    // Move tile C to tab "Two".
    await node(page, f.id('c')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move/Copy to…' }).click();
    let dlg = page.getByRole('dialog', { name: 'Move or copy' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('treeitem', { name: /^Two/ }).click();
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(dlg).toBeHidden();
    await expect(node(page, f.id('c'))).toHaveCount(0);

    // Move the collapsed folder to tab "Two" too.
    await node(page, f.id('fk')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move/Copy to…' }).click();
    dlg = page.getByRole('dialog', { name: 'Move or copy' });
    await dlg.getByRole('treeitem', { name: /^Two/ }).click();
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(dlg).toBeHidden();

    // Delete tile B.
    await node(page, f.id('b')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: /Delete/ });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(node(page, f.id('b'))).toHaveCount(0);

    // Delete the expanded folder.
    const fe = await box(page, f.id('fe'));
    await page.mouse.click(fe.x + fe.width / 2, fe.y + 10, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: /Delete/ }).getByRole('button', { name: 'Delete' }).click();
    await expect(node(page, f.id('fe'))).toHaveCount(0);

    await saveDraft(page);
    const tabs = await storedTabs(page, f);
    const t0 = tabs[0].root.children.map((n) => n.id);
    const t1 = tabs[1].root.children.map((n) => n.id);
    expect(t0).not.toContain(f.id('b'));
    expect(t0).not.toContain(f.id('fe'));
    expect(t1).toContain(f.id('c'));
    expect(t1).toContain(f.id('fk'));
    expect(errors).toEqual([]);
  });

  test('a plain click on a short tab in edit mode switches tab', async ({ page, context }) => {
    const f = await importFixture(page, context);
    const errors = await openEditing(page, f);
    await tabButton(page, 'Two').click({ timeout: 5_000 });
    await expect(tabButton(page, 'Two')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, f.id('t1'))).toBeVisible();
    await tabButton(page, 'Grid').click({ timeout: 5_000 });
    await expect(tabButton(page, 'Grid')).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
});

// Dragging into and out of folders (dragout-debug, 2026-10-21). A container's drop area is the
// whole space it is drawn in, not just the rows its items happen to fill:
//   - the dashboard canvas below its last row is the canvas (it was "not allowed");
//   - an expanded folder's empty space below its items is that folder (it went to the canvas).
// Each test is a real mouse drag; the result is checked in the saved document.
test.describe('M3 editor: dragging into and out of folders', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  /** Row 0: Alpha, Bravo, Charlie. Row 2-4: expanded folders One (Echo) and Two (Golf). */
  async function importFolders(page: Page, context: BrowserContext): Promise<Fixture> {
    const p = `m3f${Date.now().toString(36)}${(seq++).toString(36)}`;
    const id = (s: string) => `${p}-${s}`;
    const folder = (fid: string, name: string, x: number, inner: ReturnType<typeof kid>) => ({
      id: fid, kind: 'folder', name, display: 'expanded', shape: 'rounded', showTitle: true, size: 'medium', contentSize: 'medium',
      placement: placement(x, 4, 10, 6), content: { children: [inner] }
    });
    const dash = {
      id: id('dash'), name: `M3 folders ${p}`, order: 0, path: `/${p}`, revision: 1,
      settings: {
        statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
        editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
      },
      tabs: [{
        id: id('tab'), name: 'Grid', order: 0,
        root: {
          columns: 24,
          children: [
            tile(id('a'), 'Alpha', 0, 0, 0), tile(id('b'), 'Bravo', 2, 0, 1), tile(id('c'), 'Charlie', 4, 0, 2),
            folder(id('f1'), 'One', 0, kid(id('e1'), 'Echo')),
            folder(id('f2'), 'Two', 12, kid(id('g1'), 'Golf'))
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
      multipart: { file: { name: 'm3f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
    });
    expect(r.status(), await r.text()).toBe(200);
    made = { id: id('dash') };
    return { path: `/${p}`, id };
  }

  /** The id of the folder holding `id` in the saved document, or 'canvas' at the tab root. */
  async function savedParent(page: Page, f: Fixture, id: string): Promise<string | null> {
    const find = (ns: AnyNode[], parent: string): string | null => {
      for (const n of ns) {
        if (n.id === id) return parent;
        const r = n.content ? find(n.content.children, n.id) : null;
        if (r) return r;
      }
      return null;
    };
    return find((await storedTabs(page, f))[0].root.children, 'canvas');
  }

  /** The saved order of folder `folderId`'s items (M5: a folder's content is an ordered list). */
  async function savedOrder(page: Page, f: Fixture, folderId: string): Promise<string[]> {
    const find = (ns: AnyNode[]): AnyNode | undefined => {
      for (const n of ns) {
        if (n.id === folderId) return n;
        const r = n.content ? find(n.content.children) : undefined;
        if (r) return r;
      }
      return undefined;
    };
    const folder = find((await storedTabs(page, f))[0].root.children);
    expect(folder, `folder ${folderId} is saved`).toBeTruthy();
    return (folder!.content?.children ?? []).map((n) => n.id);
  }

  /** Drag the CENTRE of `id` to (x, y), let the frame resolve, check the highlight is allowed, drop. */
  async function dropAt(page: Page, id: string, x: number, y: number) {
    const s = await box(page, id);
    await dragTo(page, s.x + s.width / 2, s.y + s.height / 2, x, y);
    await page.waitForTimeout(150);
    await expect(page.locator('.drag-layer')).not.toContainText(/not allowed|Drop it on the dashboard/i);
    await page.mouse.up();
  }

  /** An empty canvas point one row below the folders (below every item on the tab). */
  async function belowEverything(page: Page, f: Fixture) {
    const f2 = await box(page, f.id('f2'));
    return { x: f2.x + f2.width / 2, y: f2.y + f2.height + 60 };
  }

  /** Merge Alpha onto Charlie (a collapsed "New folder"); returns the new folder's slot. */
  async function mergeAlphaIntoCharlie(page: Page, f: Fixture) {
    const a = await box(page, f.id('a'));
    const c = await box(page, f.id('c'));
    await dragTo(page, a.x + a.width / 2, a.y + a.height / 2, c.x + c.width / 2, c.y + c.height / 2);
    await page.waitForTimeout(700);
    await page.mouse.up();
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    const slot = page.locator('.folder-slot.collapsed', { hasText: 'New folder' });
    await expect(slot).toBeVisible();
    return slot;
  }

  const editModeOn = (page: Page) => expect(page.locator('[aria-label="Exit Edit Mode"]')).toBeVisible();

  test('a tile dragged out of an existing folder onto empty canvas lands on the canvas', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    const to = await belowEverything(page, f);
    await dropAt(page, f.id('e1'), to.x, to.y);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('e1'))).toBe('canvas');
    expect(errors).toEqual([]);
  });

  test('a tile dragged from the canvas into an expanded folder\'s empty space lands in that folder, at the end of its order', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    const f1 = await box(page, f.id('f1'));
    // Below Echo, inside One's body: the folder's empty space (M5: the end of the page shown).
    await dropAt(page, f.id('b'), f1.x + f1.width - 80, f1.y + f1.height - 60);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('b'))).toBe(f.id('f1'));
    expect(await savedOrder(page, f, f.id('f1'))).toEqual([f.id('e1'), f.id('b')]);
    expect(errors).toEqual([]);
  });

  test('a tile dragged from one folder into another folder\'s empty space lands in the other folder, at the end of its order', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    const f2 = await box(page, f.id('f2'));
    await dropAt(page, f.id('e1'), f2.x + f2.width - 80, f2.y + f2.height - 60);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('e1'))).toBe(f.id('f2'));
    expect(await savedOrder(page, f, f.id('f2'))).toEqual([f.id('g1'), f.id('e1')]);
    expect(await savedOrder(page, f, f.id('f1'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('merge, Open the new folder from its menu (in place, no pop-over), drag a tile out onto empty canvas', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    const slot = await mergeAlphaIntoCharlie(page, f);
    await slot.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open' }).click();
    // M5 §3a.8: it opens in place, into the space it kept (edit mode: its saved default).
    await expect(page.locator('.folder.open', { hasText: 'New folder' })).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await editModeOn(page);
    const to = await belowEverything(page, f);
    await dropAt(page, f.id('a'), to.x, to.y);
    await editModeOn(page);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('a'))).toBe('canvas');
    expect(await savedParent(page, f, f.id('c'))).not.toBe('canvas');
    expect(errors).toEqual([]);
  });

  test('merge, Enter on the new folder opens it in place (edit mode stays on), drag a tile out onto empty canvas', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    const slot = await mergeAlphaIntoCharlie(page, f);
    await slot.locator('.folder-collapsed-tile').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.folder.open', { hasText: 'New folder' })).toBeVisible();
    await editModeOn(page);
    const to = await belowEverything(page, f);
    await dropAt(page, f.id('a'), to.x, to.y);
    await editModeOn(page);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('a'))).toBe('canvas');
    expect(errors).toEqual([]);
  });

  test('minimise then Open (its menu) in edit mode keeps edit mode and the draft; a tile then drags out', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    // A change first (Charlie into Two), so a lost draft would show.
    const f2 = await box(page, f.id('f2'));
    await dropAt(page, f.id('c'), f2.x + f2.width - 80, f2.y + f2.height - 60);
    const one = page.locator(`[data-node-id="${f.id('f1')}"]`);
    await one.getByRole('button', { name: 'Minimise One' }).click();
    await expect(page.locator('.folder-slot.collapsed', { hasText: 'One' })).toBeVisible();
    await editModeOn(page);
    await page.locator('.folder-slot.collapsed', { hasText: 'One' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open' }).click();
    await expect(page.locator('.folder.open', { hasText: 'One' })).toBeVisible();
    await editModeOn(page);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    const to = await belowEverything(page, f);
    await dropAt(page, f.id('e1'), to.x, to.y);
    await editModeOn(page);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('c'))).toBe(f.id('f2'));
    expect(await savedParent(page, f, f.id('e1'))).toBe('canvas');
    expect(errors).toEqual([]);
  });

  test('no Maximise any more (M5): the bar has Minimise only; the draft is kept and a tile then drags out', async ({ page, context }) => {
    const f = await importFolders(page, context);
    const errors = await openEditing(page, f);
    // A change first, so a lost draft would show.
    const f1 = await box(page, f.id('f1'));
    await dropAt(page, f.id('b'), f1.x + f1.width - 80, f1.y + f1.height - 60);
    const two = page.locator(`[data-node-id="${f.id('f2')}"]`);
    await expect(two.getByRole('button', { name: 'Maximise folder' })).toHaveCount(0);
    await expect(two.getByRole('button', { name: 'Minimise Two' })).toBeVisible();
    await editModeOn(page);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    const to = await belowEverything(page, f);
    await dropAt(page, f.id('g1'), to.x, to.y);
    await editModeOn(page);
    await saveDraft(page);
    expect(await savedParent(page, f, f.id('b'))).toBe(f.id('f1'));
    expect(await savedParent(page, f, f.id('g1'))).toBe('canvas');
    expect(errors).toEqual([]);
  });
});
