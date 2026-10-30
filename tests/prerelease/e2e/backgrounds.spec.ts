import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// In a REAL browser: jsdom has no layout, so
// "the failure badge never covers content" is checked here. (The maximised panel
// and its backdrop are gone; folders open in place.)

let seq = 0;
let made: { id: string } | null = null;

const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });
// The stored form: 24-column grid tabs (a Medium tile is 2 x 2 cells); folder contents ordered, unplaced.
/** A tile inside a folder: no placement. */
const kid = (id: string, name: string) => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0
});
/** A Medium tile at the tab's top-left. */
const tile = (id: string, name: string) => ({ ...kid(id, name), placement: placement(0, 0) });

/** Import one dashboard whose Main tab holds `children(id)`; returns its path and id maker. */
async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => unknown[]) {
  const p = `bg${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `backgrounds ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'backgrounds.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
}

async function importFixture(page: Page, context: BrowserContext) {
  const p = `bg${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  // A same-origin asset path that does not exist: the image fails to load.
  const broken = { type: 'image', value: `/backgrounds/${p}-missing.jpg` };
  const folder = (key: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'folder', name, display: 'expanded', shape: 'rounded', showTitle: true, size: 'medium', contentSize: 'medium',
    placement: placement(x, 2, 8, 6), background: broken,
    content: { children: [kid(id(`${key}-t`), `${name}Tile`)] }, ...extra
  });
  const dash = {
    id: id('dash'), name: `backgrounds ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: {
        columns: 24,
        children: [
          tile(id('anchor'), 'Anchor'),
          folder('ft', 'Titled', 0),
          folder('fu', 'Untitled', 8, { showTitle: false }),
          folder('fc', 'Collapsed', 16, { display: 'collapsed', placement: placement(16, 2, 4, 6) })
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
    multipart: { file: { name: 'backgrounds.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made = { id: id('dash') };
  return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
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

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

test.describe('backgrounds in a real browser', () => {
  test('the failed-image badge never covers a folder\'s content (edit mode)', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.id('anchor')}"]`)).toBeVisible();
    // View mode: no badge.
    await expect(page.locator('[data-bg-failed]')).toHaveCount(0);
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();

    const node = (k: string) => `[data-node-id="${f.id(k)}"]`;
    const cases: [string, string][] = [
      ['ft', `${node('ft')} > .folder-body`],
      ['fu', `${node('fu')} > .folder-body`],
      ['fc', `${node('fc')} .folder-collapsed-tile`]
    ];
    for (const [k, content] of cases) {
      const badge = page.locator(`${node(k)} [data-bg-failed="folder"]`);
      await expect(badge, `badge on ${k}`).toBeVisible();
      await expect(badge).toContainText("Background image couldn't be loaded");
      const bb = await badge.boundingBox();
      expect(bb, `badge box for ${k}`).toBeTruthy();
      expect(intersects(bb!, await boxOf(page, content)), `badge on ${k} overlaps its content`).toBe(false);
    }
  });

  test('no maximise and no backdrop: an open folder is drawn in place over the live dashboard', async ({ page, context }) => {
    const f = await importFixture(page, context);
    await page.goto(f.path);
    const titled = page.locator(`[data-node-id="${f.id('ft')}"]`);
    await expect(titled).toBeVisible();
    await expect(titled.getByRole('button', { name: 'Maximise folder' })).toHaveCount(0);
    await expect(titled.getByRole('button', { name: 'Minimise Titled' })).toBeVisible();
    await expect(page.locator('.max-host, .overlay-backdrop')).toHaveCount(0);
    // Its surface is its own (translucent) look, inside its box.
    await expect(titled.locator(':scope > .folder-shape .folder-surface')).toHaveCount(1);
  });

  // ---- the picker at folder level and the corner controls

  const PRESET = '/presets/network-grid.jpg';
  const untitledAt = (id: (s: string) => string, key: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'folder', name: `Folder ${key}`, display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
    showTitle: false, placement: placement(x, y, 8, 6),
    content: { children: [kid(id(`${key}-t`), `${key}Tile`)] }, ...extra
  });

  async function enterEdit(page: Page) {
    await page.locator('[aria-label="Enter Edit Mode"]').click();
    await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  }
  async function saveDraft(page: Page) {
    const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
    await expect(save).toBeEnabled();
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    const r = await saved;
    expect(r.status(), await r.text()).toBe(200);
  }
  async function storedFolder(page: Page, dashId: string, folderId: string) {
    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { id: string }) => x.id === dashId);
    return d.tabs[0].root.children.find((n: { id: string }) => n.id === folderId);
  }
  /** Edit mode → double-click the folder → Background… → the folder-level picker. */
  async function openFolderPicker(page: Page, folderSel: string) {
    await page.locator(folderSel).dblclick({ position: { x: 20, y: 20 } });
    const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker).toBeVisible();
    return { dlg, picker };
  }

  test('folder picker: a preset picture at 50% opacity is saved, survives a reload and is drawn', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const f = await importDash(page, context, (id) => [tile(id('anchor'), 'Anchor'), untitledAt(id, 'fp', 0, 2, { showTitle: true })]);
    const sel = `[data-node-id="${f.id('fp')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    await enterEdit(page);
    // Cancel discards a picked background (nothing reaches the draft.
    {
      const { dlg, picker } = await openFolderPicker(page, sel);
      await picker.getByRole('radio', { name: 'Its own picture' }).check();
      await picker.locator(`.image-card img[src="${PRESET}"]`).first().click();
      await picker.getByRole('button', { name: /^Save Background/ }).click();
      await expect(picker).toBeHidden();
      await expect(dlg.locator('.background-status')).toContainText(/applies when you save/);
      await dlg.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(dlg).toBeHidden();
      await expect(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ })).toBeDisabled();
      await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(0);
    }
    const { dlg, picker } = await openFolderPicker(page, sel);
    await expect(dlg.locator('.background-status')).toContainText(/No picture of its own/);
    // Folder level: no overlay or blur of its own ; pictures only.
    await picker.getByRole('radio', { name: 'Its own picture' }).check();
    await picker.getByRole('button', { name: /^Image$/ }).click();
    await expect(picker.getByText(/Overlay Darkness/i)).toHaveCount(0);
    await expect(picker.getByText(/Overlay Blur/i)).toHaveCount(0);
    await picker.locator(`.image-card img[src="${PRESET}"]`).first().click();
    await picker.getByLabel(/^Background opacity/).fill('0.5');
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(picker).toBeHidden();
    await expect(dlg.locator('.background-status')).toContainText(/Image, 50% opacity/);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await expect(dlg).toBeHidden();
    await saveDraft(page);

    const stored = await storedFolder(page, f.id('dash'), f.id('fp'));
    expect(stored.background).toMatchObject({ type: 'image', value: PRESET, opacity: 0.5 });
    expect(stored.background).not.toHaveProperty('overlayOpacity');
    expect(stored.background.inherit).toBeFalsy();

    await page.reload();
    await expect(page.locator(sel)).toBeVisible();
    const root = page.locator(`${sel} .folder-surface .background-root`);
    await expect(root).toHaveCount(1);
    await expect.poll(() => root.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
    await expect
      .poll(() => root.evaluate((el) => [...el.querySelectorAll('.background-layer')].map((l) => getComputedStyle(l).backgroundImage).join(' ')))
      .toContain('network-grid.jpg');
    // Once the picture is shown, the colour stand-in is gone (the image really loaded).
    await expect(page.locator(`${sel} .folder-surface-color`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Inherit keeps the folder picture: switched off, stored, and restored on un-inherit', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      tile(id('anchor'), 'Anchor'),
      untitledAt(id, 'fi', 0, 2, { showTitle: true, background: { type: 'image', value: PRESET, opacity: 0.8 } })
    ]);
    const sel = `[data-node-id="${f.id('fi')}"]`;
    await page.goto(f.path);
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(1);
    await enterEdit(page);

    let { dlg, picker } = await openFolderPicker(page, sel);
    const same = picker.getByRole('radio', { name: "No picture of its own — show what's behind" });
    await expect(same).not.toBeChecked();
    await same.check();
    await expect(same).toBeChecked();
    // The folder-level hint that its own picture is kept.
    await expect(picker.getByText("This folder's own picture is kept for when you switch back.")).toBeVisible();
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(dlg.locator('.background-status')).toContainText(/kept/);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    let stored = await storedFolder(page, f.id('dash'), f.id('fi'));
    expect(stored.background).toMatchObject({ inherit: true, type: 'image', value: PRESET, opacity: 0.8 });
    // Switched off: no picture drawn in the folder.
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(0);

    ({ dlg, picker } = await openFolderPicker(page, sel));
    await expect(picker.getByRole('radio', { name: "No picture of its own — show what's behind" })).toBeChecked();
    await picker.getByRole('radio', { name: 'Its own picture' }).check();
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    stored = await storedFolder(page, f.id('dash'), f.id('fi'));
    expect(stored.background).toMatchObject({ type: 'image', value: PRESET, opacity: 0.8 });
    expect(stored.background.inherit).toBeFalsy();
    await expect(page.locator(`${sel} .folder-surface .background-root`)).toHaveCount(1);
  });

  test('a row-0 untitled folder: its bar (every open folder has one) holds the controls, unclipped, clear of content and the badge', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      // Row 0, right-hand side; a broken picture so edit mode shows the failure badge too.
      untitledAt(id, 'f0', 16, 0, { background: { type: 'image', value: `/backgrounds/${id('nope')}.jpg` } }),
      tile(id('anchor'), 'Anchor')
    ]);
    const sel = `[data-node-id="${f.id('f0')}"]`;
    await page.goto(f.path);
    await expect(page.locator(sel)).toBeVisible();
    const bar = page.locator(`${sel} > .folder-header`);
    await expect(bar).toBeVisible();
    await expect(bar).not.toContainText('Folder f0'); // untitled: controls only
    const min = bar.getByRole('button', { name: 'Minimise Untitled folder' });
    await expect(min).toBeVisible();
    const cb = (await min.boundingBox())!;
    const body = await boxOf(page, `${sel} > .folder-body`);
    const folderBox = await boxOf(page, sel);
    expect(intersects(cb, body), 'the controls overlap the folder content').toBe(false);
    // Inside the folder's box, at its top-right, never clipped.
    expect(cb.y).toBeGreaterThanOrEqual(folderBox.y - 1);
    expect(cb.x + cb.width).toBeLessThanOrEqual(folderBox.x + folderBox.width + 1);
    expect(cb.x).toBeGreaterThan(folderBox.x + folderBox.width / 2);
    expect(cb.y).toBeGreaterThanOrEqual(0);
    const hit = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null),
      [cb.x + cb.width / 2, cb.y + cb.height / 2]
    );
    expect(hit).toBe('Minimise Untitled folder');
    // And it works (then Restore brings it back).
    await min.click();
    await expect(page.locator(sel)).toHaveClass(/collapsed/);
    await page.locator(sel).getByRole('button', { name: 'Restore Untitled folder' }).click();
    await expect(page.locator(`${sel} > .folder-header`)).toBeVisible();

    // Edit mode: the failure badge sits in the bar too — clear of the controls and the content.
    await enterEdit(page);
    const badge = page.locator(`${sel} [data-bg-failed="folder"]`);
    await expect(badge).toBeVisible();
    const bb = (await badge.boundingBox())!;
    const cb2 = (await page.locator(`${sel} > .folder-header`).getByRole('button', { name: 'Minimise Untitled folder' }).boundingBox())!;
    expect(intersects(bb, cb2), 'failure badge and controls would collide').toBe(false);
    expect(intersects(bb, await boxOf(page, `${sel} > .folder-body`))).toBe(false);
    expect(bb.y).toBeGreaterThanOrEqual(0);
  });
});
