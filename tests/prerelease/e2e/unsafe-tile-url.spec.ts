import { test, expect, type Page } from '@playwright/test';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed } from '../helpers';

// Pentest L1: the server refuses a javascript: tile url on every write, but
// stored data may predate that. Such a tile (served by GET /api/config, here
// stood in for by rewriting the response) is shown, never opened: a click
// runs nothing, opens no frame, and says why; edit mode marks it "Unsafe address".

const made: string[] = [];
test.afterEach(async ({ page }) => {
  await page.unroute('**/api/config');
  await deleteDashboardsNamed(page, made.splice(0));
});

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });
const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });

test('a stored javascript: tile cannot run and is marked unsafe in edit mode', async ({ page }) => {
  const dashName = uniqueName('Unsafe');
  await createDashboardViaUI(page, dashName, undefined, made);
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Tile' });
  await dlg.locator('input#name').fill('Evil');
  await dlg.locator('input#url').fill('https://example.com');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(tileNamed(page, 'Evil')).toBeVisible();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
  await page.locator('[aria-label="Exit Edit Mode"]').click();
  await expect(page.locator('[aria-label="Enter Edit Mode"]')).toBeVisible();

  // The stored tile now carries a javascript: address in iframe mode (as legacy data would).
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const walk = (n: any) => {
      if (n && typeof n === 'object') {
        if (n.kind === 'tile' && n.name === 'Evil') {
          n.url = 'javascript:window.__pwned=1;alert(document.domain)';
          n.openMode = 'iframe';
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(body);
    await route.fulfill({ response: res, json: body });
  });
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  await page.reload();
  await page.waitForLoadState('networkidle');

  await tileNamed(page, 'Evil').click();
  await expect(page.getByText(/"Evil" was not opened/)).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(alerted).toBe(false);

  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.locator('[aria-label="Exit Edit Mode"]')).toBeVisible();
  await expect(tileNamed(page, 'Evil').getByTestId('tile-url-problem')).toHaveText('Unsafe address: this tile will not open');
  await page.locator('[aria-label="Exit Edit Mode"]').click();
});
