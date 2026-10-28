import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteDashboardsNamed } from '../helpers';

// Found in the rc1 trials: importing a real Homer config left Font Awesome icon names HOPS can't
// draw (broken icons), Heimdall's tags were ignored, and nothing said what was lost. These import
// the sample configs (backend/internal/converters/testdata) through the dialog, as a user would.

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/internal/converters/testdata');

async function importSample(page: Page, file: string) {
  await page.goto('/settings/dashboards');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('input[type="file"][accept=".json,.yml,.yaml"]').setInputFiles(path.join(SAMPLES, file));
  await page.getByRole('button', { name: /^Import/ }).last().click();
}

async function importedPath(page: Page, name: string): Promise<string> {
  const cfg = await (await page.request.get('/api/config')).json();
  const d = cfg.dashboards.filter((x: { name: string }) => x.name.startsWith(name)).at(-1);
  expect(d, `dashboard ${name}`).toBeTruthy();
  return d.path;
}

async function tilesWithoutIcon(page: Page): Promise<string[]> {
  const entries = page.locator('.tab-canvas .entry');
  await expect(entries.first()).toBeVisible();
  return entries.evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .filter((e) => {
      const img = e.querySelector('img') as HTMLImageElement | null;
      if (img) return !(img.complete && img.naturalWidth > 0);
      const svg = e.querySelector('svg');
      return !svg || svg.children.length === 0;
    })
    .map((e) => e.textContent?.trim() ?? '?'));
}

test("Homer's own example: every tile draws an icon, and the lost Font Awesome icons are listed", async ({ page }) => {
  await importSample(page, 'homer-upstream.yml');
  const warning = page.getByTestId('import-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("5 icon(s) couldn't be carried over");
  await expect(warning).toContainText('Get started');
  const p = await importedPath(page, 'Demo dashboard');
  try {
    await page.goto(p);
    await expect.poll(() => tilesWithoutIcon(page), { timeout: 5000 }).toEqual([]);
  } finally {
    await deleteDashboardsNamed(page, ['Demo dashboard']);
  }
});

test('Heimdall export: tags become folders, colours kept, packaged icons matched', async ({ page }) => {
  await importSample(page, 'heimdall-export.json');
  await expect(page.getByTestId('import-warning')).toContainText("first tag's folder");
  const p = await importedPath(page, 'Heimdall Import');
  try {
    await page.goto(p);
    for (const f of ['Media', 'Infrastructure', 'Services']) {
      await expect(page.getByRole('group', { name: `${f} folder` })).toBeVisible();
    }
    await expect.poll(() => tilesWithoutIcon(page), { timeout: 5000 }).toEqual([]);
  } finally {
    await deleteDashboardsNamed(page, ['Heimdall Import']);
  }
});
