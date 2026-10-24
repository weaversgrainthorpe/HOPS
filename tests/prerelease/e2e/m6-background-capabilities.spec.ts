import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// M6 §8.2 (design/specs/2026-10-23-hops-v3-m6-folder-shapes-design.md): one background dialog,
// driven by a capability table — no control where it has no effect. In a REAL browser:
//  - a folder slideshow on a dashboard with "Animated folder backgrounds" off shows the note (with a
//    way to Dashboard settings) and no transition picker, interval or duration;
//  - that link opens the one Dashboard dialog on Settings; turning the setting on shows the controls, live;
//  - a see-through tab: a note in place of darkness and blur (the dashboard's are used);
//  - the dashboard and tab pickers are unchanged;
//  - reduced motion: the same kind of note at every level;
//  - a Save with the controls hidden keeps the stored timing exactly.

let seq = 0;
const made: string[] = [];
const IMGS = ['/presets/network-grid.jpg', '/presets/dark-gradient.jpg'];
const SLIDESHOW = { type: 'slideshow', images: IMGS, interval: 42, transition: 'flip', transitionDuration: 2.5 };

async function importDash(page: Page, context: BrowserContext, animated: boolean | null, folderBg: Record<string, unknown> = SLIDESHOW) {
  const p = `m6bg${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M6 bg caps ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: animated
    },
    background: { ...SLIDESHOW },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, background: { ...SLIDESHOW },
      root: {
        columns: 24,
        children: [
          {
            id: id('f'), kind: 'folder', name: 'Pics', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
            placement: { x: 0, y: 0, w: 10, h: 8 }, background: folderBg,
            content: { children: [{ id: id('k'), kind: 'tile', type: 'link', name: 'Inside', url: 'https://inside.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0 }] }
          },
          { id: id('t'), kind: 'tile', type: 'link', name: 'Anchor', url: 'https://anchor.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 12, y: 0, w: 2, h: 2 } }
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
    multipart: { file: { name: 'm6bg.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function openFolderPicker(page: Page, folderId: string) {
  await page.locator(`.tab-canvas [data-node-id="${folderId}"]`).first().click({ button: 'right', position: { x: 12, y: 12 } });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /^Background/ }).click();
  const picker = page.getByRole('dialog', { name: 'Folder background' });
  await expect(picker).toBeVisible();
  return { dlg, picker };
}
async function openTabPicker(page: Page) {
  await page.getByRole('tab', { name: 'Switch to Main tab' }).dblclick();
  await page.getByRole('dialog', { name: 'Edit Tab' }).getByRole('button', { name: /Configure Tab Background/ }).click();
  const picker = page.getByRole('dialog', { name: 'Tab background' });
  await expect(picker).toBeVisible();
  return picker;
}
async function openDashboardBackground(page: Page) {
  await page.getByRole('button', { name: 'Edit Dashboard' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
  await dlg.getByRole('tab', { name: 'Background' }).click();
  return dlg.getByRole('tabpanel', { name: 'Background' });
}

const FOLDER_NOTE = "Pictures show as the first image, still, on this dashboard. Turn on 'Animated folder backgrounds' in Dashboard settings to play them.";
const REDUCED_NOTE = /on this device, because it asks for reduced motion/;

/** The full set of slideshow motion controls is (shown = true) or is not on screen. */
async function expectMotion(scope: ReturnType<Page['getByRole']>, shown: boolean) {
  const n = shown ? 1 : 0;
  await expect(scope.getByRole('group', { name: 'Transition Effect' })).toHaveCount(n);
  await expect(scope.getByLabel(/^Rotation Interval/)).toHaveCount(n);
  await expect(scope.getByLabel(/^Transition Duration/)).toHaveCount(n);
  await expect(scope.getByRole('button', { name: 'Ken Burns' })).toHaveCount(n);
}

test.describe('M6 §8.2 background dialog driven by the capability table', () => {
  test('folder, folder animations off: the note with a way to Dashboard settings, and no transition picker', async ({ page, context }) => {
    const f = await importDash(page, context, false);
    await page.goto(f.path);
    await enterEdit(page);
    const { picker } = await openFolderPicker(page, f.id('f'));
    await expect(picker.getByText(FOLDER_NOTE)).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Open Dashboard settings' })).toBeVisible();
    await expect(picker.getByText(/kept as they are/)).toBeVisible();
    await expectMotion(picker, false);
    // What does apply is still offered.
    await expect(picker.getByRole('group', { name: /Picture type/ }).getByRole('button')).toHaveText(['Image', 'Slideshow']);
    await expect(picker.getByLabel(/^Background opacity/)).toBeVisible();
    await expect(picker.getByText(/^Overlay Darkness/)).toHaveCount(0);
  });

  test('the note opens THE Dashboard dialog on Settings; turning the setting on shows the controls (live)', async ({ page, context }) => {
    const f = await importDash(page, context, false);
    await page.goto(f.path);
    await enterEdit(page);
    const { dlg, picker } = await openFolderPicker(page, f.id('f'));
    await picker.getByRole('button', { name: 'Open Dashboard settings' }).click();
    // The one Dashboard dialog (no separate settings dialog), opened at its Settings section.
    const dash = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await expect(dash).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Dashboard settings' })).toHaveCount(0);
    await expect(dash.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    const panel = dash.getByRole('tabpanel', { name: 'Settings' });
    // The setting the note named is brought into view and marked; the dialog is on top, so its
    // controls take the clicks.
    await expect(panel.locator('.row.asked-for')).toContainText('Animated folder backgrounds');
    await expect(panel.locator('.row.asked-for')).toBeInViewport();
    const override = panel.getByRole('checkbox', { name: 'Override for this dashboard: Animated folder backgrounds' });
    await expect(override).toBeChecked();
    const value = panel.getByRole('checkbox', { name: 'Animated folder backgrounds', exact: true });
    await expect(value).not.toBeChecked();
    await value.check();
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/settings/.test(r.url()));
    await dash.getByRole('button', { name: /^Save/ }).click();
    expect((await saved).status()).toBe(200);
    await expect(dash).toHaveCount(0);
    // Back in the picker (still open): the motion controls, the note gone.
    await expect(picker).toBeVisible();
    await expect(dlg).toBeVisible();
    await expect(picker.getByText(FOLDER_NOTE)).toHaveCount(0);
    await expectMotion(picker, true);
    await expect(picker.getByRole('group', { name: 'Transition Effect' }).getByRole('button', { name: 'Flip' })).toHaveClass(/active/);
    // The untouched header and background did not make the draft dirty.
    await expect(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /^Save/ })).toBeDisabled();
    // Saved on the server.
    const cfg = await (await page.request.get('/api/config')).json();
    expect(cfg.dashboards.find((d: { id: string }) => d.id === f.id('dash')).display.animatedFolderBackgrounds).toBe(true);
  });

  test('the toolbar still opens the Dashboard dialog on Header', async ({ page, context }) => {
    const f = await importDash(page, context, false);
    await page.goto(f.path);
    await enterEdit(page);
    // Opened at Settings from a folder first, then closed: the toolbar opens it as before.
    const { dlg, picker } = await openFolderPicker(page, f.id('f'));
    await picker.getByRole('button', { name: 'Open Dashboard settings' }).click();
    await page.getByRole('dialog', { name: 'Edit Dashboard' }).getByRole('button', { name: 'Cancel' }).click();
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Dashboard' }).getByRole('tab', { name: 'Header' })).toHaveAttribute('aria-selected', 'true');
  });

  test('tab: a see-through tab shows the note in place of darkness and blur, live with the slider', async ({ page, context }) => {
    const f = await importDash(page, context, true);
    await page.goto(f.path);
    await enterEdit(page);
    const tab = await openTabPicker(page);
    const note = tab.getByText("A see-through tab uses the dashboard's darkness and blur.");
    await expect(tab.getByText(/^Overlay Darkness/)).toBeVisible();
    await expect(note).toHaveCount(0);
    const slider = tab.getByLabel(/^Background opacity/);
    await slider.fill('0.5');
    await expect(note).toBeVisible();
    await expect(tab.getByText(/^Overlay Darkness/)).toHaveCount(0);
    await expect(tab.getByText(/^Overlay Blur/)).toHaveCount(0);
    await slider.fill('1');
    await expect(note).toHaveCount(0);
    await expect(tab.getByText(/^Overlay Darkness/)).toBeVisible();
  });

  test('folder, folder animations on: the controls, no note', async ({ page, context }) => {
    const f = await importDash(page, context, true);
    await page.goto(f.path);
    await enterEdit(page);
    const { picker } = await openFolderPicker(page, f.id('f'));
    await expectMotion(picker, true);
    await expect(picker.getByText(FOLDER_NOTE)).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Open Dashboard settings' })).toHaveCount(0);
  });

  test('the dashboard and tab pickers are unchanged (folder animations off has no say there)', async ({ page, context }) => {
    const f = await importDash(page, context, false);
    await page.goto(f.path);
    await enterEdit(page);
    const tab = await openTabPicker(page);
    await expect(tab.getByRole('group', { name: /Background Type/ }).getByRole('button')).toHaveText(['None', 'Color', 'Image', 'Slideshow']);
    await expectMotion(tab, true);
    await expect(tab.getByText(/^Overlay Darkness/)).toBeVisible();
    await expect(tab.getByText(/^Overlay Blur/)).toBeVisible();
    await expect(tab.getByLabel(/^Background opacity/)).toBeVisible();
    await expect(tab.locator('[data-motion-notes]')).toHaveCount(0);
    await tab.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog', { name: 'Edit Tab' }).getByRole('button', { name: 'Cancel' }).click();

    const dash = await openDashboardBackground(page);
    await expect(dash.getByRole('switch', { name: 'Show background picture' })).toBeChecked();
    await expect(dash.getByRole('group', { name: /Background Type/ }).getByRole('button')).toHaveText(['None', 'Color', 'Image', 'Slideshow']);
    await expectMotion(dash, true);
    await expect(dash.getByText(/^Overlay Darkness/)).toBeVisible();
    await expect(dash.locator('[data-motion-notes]')).toHaveCount(0);
  });

  test('reduced motion: a note in place of the motion controls at every level', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await importDash(page, context, true);
    await page.goto(f.path);
    await enterEdit(page);
    const { picker, dlg } = await openFolderPicker(page, f.id('f'));
    await expect(picker.getByText(REDUCED_NOTE)).toBeVisible();
    await expect(picker.getByText(FOLDER_NOTE)).toHaveCount(0);
    await expectMotion(picker, false);
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await dlg.getByRole('button', { name: 'Cancel' }).click();

    const tab = await openTabPicker(page);
    await expect(tab.getByText(REDUCED_NOTE)).toBeVisible();
    await expectMotion(tab, false);
    await expect(tab.getByText(/^Overlay Darkness/)).toBeVisible(); // still has an effect
  });

  test('Save with the motion controls hidden keeps the stored timing exactly', async ({ page, context }) => {
    // An out-of-range interval a visible control would clamp (Ruling 14): hidden, it is kept.
    const bg = { ...SLIDESHOW, interval: 1, transitionDuration: 99 };
    const f = await importDash(page, context, false, bg);
    await page.goto(f.path);
    await enterEdit(page);
    const { dlg, picker } = await openFolderPicker(page, f.id('f'));
    await picker.getByRole('button', { name: 'Contain' }).click(); // a real change elsewhere
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(picker).toHaveCount(0);
    await dlg.getByRole('button', { name: /^Save/ }).click();
    const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
    await save.click();
    expect((await put).status()).toBe(200);
    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { id: string }) => x.id === f.id('dash'));
    const folder = d.tabs[0].root.children.find((n: { id: string }) => n.id === f.id('f'));
    expect(folder.background).toEqual({ ...bg, fit: 'contain' });
  });
});
