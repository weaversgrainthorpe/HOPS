import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// One set of action buttons throughout: Tab order, a Global settings row, the tile and folder
// dialogs and the dashboard edit toolbar draw Undo / Discard / Save / Cancel / Delete / Duplicate
// with the same icon and word, and a disabled one looks the same everywhere (muted, dashed edge,
// never faded). Synthetic data only.

const made: string[] = [];
async function seed(page: Page, context: BrowserContext) {
  const p = `actb${Date.now().toString(36)}`;
  const dash = {
    id: `${p}-dash`, name: `Actions ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
    tabs: [0, 1, 2].map((i) => ({ id: `${p}-t${i}`, name: `Tab ${i + 1}`, order: i, root: { columns: 24, children: i ? [] : [
      { id: `${p}-a`, kind: 'tile', type: 'link', name: 'Alpha', url: 'https://alpha.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 } },
      { id: `${p}-f`, kind: 'folder', name: 'Box', display: 'expanded', shape: 'folder-flat', size: 'medium', contentSize: 'medium', placement: { x: 4, y: 0, w: 6, h: 4 }, content: { children: [] } }
    ] } }))
  };
  const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
  const r = await page.request.post('/api/config/import', { headers: { 'X-CSRF-Token': await getCsrfToken(context) }, multipart: { file: { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } } });
  expect(r.status(), await r.text()).toBe(200);
  made.push(dash.id);
  return { p, name: dash.name };
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((x: { id: string }) => x.id === id)?.revision;
    expect(typeof rev).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, { headers: { 'X-CSRF-Token': await getCsrfToken(context) } });
    expect(r.ok()).toBeTruthy();
  }
});

test.use({ viewport: { width: 1280, height: 900 } });

/** The drawn icon (its SVG body) and the visible word of a button. */
async function look(b: Locator) {
  return b.evaluate((el) => ({
    icon: el.querySelector('svg')?.innerHTML ?? '',
    word: (el as HTMLElement).innerText.trim()
  }));
}
/** How an enabled button is drawn (colours and edges; size differs between small and normal). */
async function enabledLook(b: Locator) {
  await expect(b).toBeEnabled();
  await b.page().mouse.move(0, 0); // never hovered
  await b.page().waitForTimeout(300); // past the background transition
  return b.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius, weight: cs.fontWeight, opacity: cs.opacity };
  });
}
/** How a disabled button is drawn. */
async function disabledLook(b: Locator) {
  await expect(b).toBeDisabled();
  return b.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, outline: cs.outlineStyle, bg: cs.backgroundColor, color: cs.color };
  });
}

test('Undo, Discard and Save look the same on Tab order, a Global settings row and the edit toolbar', async ({ page, context }) => {
  const d = await seed(page, context);

  // The edit toolbar is the reference.
  await page.goto(`/${d.p}`);
  await page.locator('[aria-label="Enter edit mode"]').click();
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  await expect(bar).toBeVisible();
  const ref = {
    undo: await look(bar.getByRole('button', { name: 'Undo', exact: true })),
    discard: await look(bar.getByRole('button', { name: 'Discard', exact: true })),
    save: await look(bar.getByRole('button', { name: 'Save', exact: true }))
  };
  expect(ref.undo.icon).not.toBe('');
  const barDisabled = await disabledLook(bar.getByRole('button', { name: 'Undo', exact: true }));
  // Enabled: a secondary toolbar button (Add tile, always enabled) and the primary Save, once a change exists.
  const barSecondary = await enabledLook(bar.getByRole('button', { name: 'Add tile', exact: true }));
  // Every button on the bar is the same secondary button, the Dashboard pencil included.
  expect(await enabledLook(bar.getByRole('button', { name: 'Edit dashboard', exact: true }))).toEqual(barSecondary);
  expect(barDisabled.opacity, 'a disabled toolbar button is not faded').toBe('1');
  expect(barDisabled.outline).toBe('dashed');
  await page.locator('[aria-label="Exit edit mode"]').click();

  // Tab order: the same three, the same icons and words.
  await page.goto('/settings/dashboards');
  await page.getByRole('link', { name: `Tab order for ${d.name}` }).click();
  const tabUndo = page.getByRole('button', { name: 'Undo', exact: true });
  const tabDisabled = await disabledLook(tabUndo);
  expect(tabDisabled).toEqual(barDisabled);
  await page.getByRole('button', { name: 'Move Tab 3 to the top' }).click();
  expect(await look(tabUndo)).toEqual(ref.undo);
  // Enabled, the page's Undo is drawn exactly like the toolbar's buttons (item 15).
  expect(await enabledLook(tabUndo)).toEqual(barSecondary);
  // A hovered secondary button never takes the page colour (it vanished on the page before).
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await tabUndo.hover();
  await page.waitForTimeout(300);
  const hoverBg = await tabUndo.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(hoverBg, 'hovered Undo stays visible on the page').not.toBe(pageBg);
  expect(hoverBg, 'hover changes the fill').not.toBe(barSecondary.bg);
  await page.mouse.move(0, 0);
  expect(await look(page.getByRole('button', { name: 'Discard', exact: true }))).toEqual(ref.discard);
  expect(await look(page.getByRole('button', { name: 'Save', exact: true }))).toEqual(ref.save);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();

  // A Global settings row: Reset to default, Discard, Save.
  await page.goto('/settings/global');
  const row = page.locator('.row', { has: page.locator('input[type=number]') }).first();
  await expect(row.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
  const input = row.locator('input[type=number]').first();
  const was = await input.inputValue();
  await input.fill(String(Number(was) + 1));
  const words = await row.locator('.row-actions button').evaluateAll((bs) => bs.map((b) => (b.textContent ?? '').trim()));
  expect(words.slice(-2)).toEqual(['Discard', 'Save']);
  expect(await look(row.getByRole('button', { name: 'Discard', exact: true }))).toEqual(ref.discard);
  expect(await look(row.getByRole('button', { name: 'Save', exact: true }))).toEqual(ref.save);
  await row.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(input).toHaveValue(was);
});

test('the tile and folder dialogs: Delete and Duplicate on the left, Cancel then Save on the right, each with its icon', async ({ page, context }) => {
  const d = await seed(page, context);
  await page.goto(`/${d.p}`);
  await page.locator('[aria-label="Enter edit mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  const footers: Record<string, { word: string; icon: string }[]> = {};
  for (const [id, name] of [[`${d.p}-a`, 'Edit tile'], [`${d.p}-f`, 'Edit folder']] as const) {
    await page.locator(`.tab-canvas [data-node-id="${id}"]`).first().click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dlg = page.getByRole('dialog', { name });
    await expect(dlg).toBeVisible();
    const btns = dlg.locator('.modal-actions button');
    const all = [];
    for (let i = 0; i < await btns.count(); i++) all.push(await look(btns.nth(i)));
    expect(all.map((b) => b.word), name).toEqual(['Delete', 'Duplicate', 'Cancel', 'Save']);
    for (const b of all) expect(b.icon, `${name}: ${b.word} has an icon`).not.toBe('');
    footers[name] = all;
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dlg).toHaveCount(0);
  }
  expect(footers['Edit folder']).toEqual(footers['Edit tile']);

  // Delete is drawn one way everywhere: the Dashboards list row's bin is the dialog's red Delete.
  await page.locator(`.tab-canvas [data-node-id="${d.p}-a"]`).first().click({ button: 'right', position: { x: 12, y: 12 } });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialogDelete = await enabledLook(page.getByRole('dialog', { name: 'Edit tile' }).getByRole('button', { name: 'Delete', exact: true }));
  await page.keyboard.press('Escape');
  await page.locator('[aria-label="Exit edit mode"]').click();
  await page.goto('/settings/dashboards');
  const rowDelete = await enabledLook(page.getByRole('button', { name: `Delete ${d.name}`, exact: true }));
  expect(rowDelete.bg).toBe(dialogDelete.bg);
  expect(rowDelete.color).toBe(dialogDelete.color);
});
