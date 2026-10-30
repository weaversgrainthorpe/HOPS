import { test, expect, type Page } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed } from '../helpers';

// Found in install trials: a folder's colour set back to "None" and saved stayed coloured, because
// the cleared field was lost on the way to the draft. Clearing a tile's away address had the same
// flaw. Each test clears a field in its dialog, saves, reloads, and checks it is really gone.

const made: string[] = [];
test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });

async function saveDraft(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
}

async function savedDashboard(page: Page, name: string) {
  const cfg = await (await page.request.get('/api/config')).json();
  return cfg.dashboards.find((d: { name: string }) => d.name === name);
}

test('a folder colour set back to None is gone after Save and reload', async ({ page }) => {
  const dashName = uniqueName('ClearColour');
  await createDashboardViaUI(page, dashName, undefined, made);
  await toolbar(page).getByRole('button', { name: 'Add folder' }).click();
  const create = page.getByRole('dialog', { name: 'New Folder' });
  await create.locator('#folder-name').fill('Cerise');
  await create.getByRole('button', { name: 'Pink', exact: true }).click();
  await create.getByRole('button', { name: /Create/ }).click();
  const folder = page.getByRole('group', { name: 'Cerise folder' });
  await expect(folder).toBeVisible();
  await saveDraft(page);
  expect(JSON.stringify(await savedDashboard(page, dashName))).toContain('"color":"#ec4899"');

  await folder.click({ button: 'right', position: { x: 8, y: 8 } });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Folder' });
  await edit.getByRole('button', { name: /^None/ }).first().click();
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await saveDraft(page);

  expect(JSON.stringify(await savedDashboard(page, dashName))).not.toContain('#ec4899');
  await page.reload();
  const bg = await page.getByRole('group', { name: 'Cerise folder' }).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--group-bg'));
  expect(bg.toLowerCase()).not.toBe('#ec4899');
});

test("a tile's away address cleared in the dialog is gone after Save", async ({ page }) => {
  const dashName = uniqueName('ClearAway');
  await createDashboardViaUI(page, dashName, undefined, made);
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const create = page.getByRole('dialog', { name: 'New Tile' });
  await create.locator('input#name').fill('NAS');
  await create.locator('input#url').fill('http://nas.example.lan/');
  await create.locator('#away-url').fill('https://nas.away.example/');
  await create.getByRole('button', { name: 'Create' }).click();
  await saveDraft(page);
  expect(JSON.stringify(await savedDashboard(page, dashName))).toContain('nas.away.example');

  await page.locator('[data-node-id]', { hasText: 'NAS' }).dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Tile' });
  await edit.locator('#away-url').fill('');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await saveDraft(page);
  expect(JSON.stringify(await savedDashboard(page, dashName))).not.toContain('nas.away.example');
});
