import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import { getCsrfToken, uniqueName, deleteDashboardsNamed } from '../helpers';

// Settings › Dashboards: Export all saves every dashboard in one file, and Import reads it back,
// asking for each dashboard whose name is already used: Replace, Keep both ("Name (2)") or Skip.
// Nothing changes until the admin confirms; a summary says what happened. Synthetic data only.

const made: string[] = [];

test.afterEach(async ({ page }) => {
  await deleteDashboardsNamed(page, made.splice(0));
});

test.use({ viewport: { width: 1280, height: 900 } });

type Dash = { id: string; name: string; revision: number; tabs: { id: string; name: string }[] };

async function config(page: Page): Promise<{ dashboards: Dash[] }> {
  return (await page.request.get('/api/config')).json();
}

async function create(page: Page, context: BrowserContext, name: string): Promise<string> {
  const r = await page.request.post('/api/dashboards', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context), 'Content-Type': 'application/json' },
    data: JSON.stringify({ name, path: `/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` })
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(name);
  return (await r.json()).id;
}

/** Collect every id inside one dashboard (dashboard, tabs, folders and tiles). */
function idsIn(d: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string') out.add(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(d);
  return out;
}

test('Export all, then import it back with one Replace, one Keep both and Skips', async ({ page, context }) => {
  const [a, b, c, gone] = [uniqueName('Replace me'), uniqueName('Keep me'), uniqueName('Skip me'), uniqueName('Gone since')];
  const aId = await create(page, context, a);
  await create(page, context, b);
  await create(page, context, c);
  const goneId = await create(page, context, gone);

  await page.goto('/settings/dashboards');
  await expect(page.getByTestId('export-all-note')).toContainText('It is not a backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all' }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^hops-all-dashboards-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const env = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = await config(page);
  expect(env.exportType).toBe('dashboards');
  expect(env.config.dashboards.map((d: Dash) => d.id).sort()).toEqual(before.dashboards.map((d) => d.id).sort());

  // Change A after the export, so the Replace visibly brings the file's version back.
  const aNow = before.dashboards.find((d) => d.id === aId)!;
  const tabName = aNow.tabs[0].name;
  const edited = { ...aNow, tabs: [{ ...aNow.tabs[0], name: 'Changed after export' }] };
  const put = await page.request.put(`/api/dashboards/${encodeURIComponent(aId)}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context), 'Content-Type': 'application/json' },
    data: JSON.stringify({ schema: 3, dashboard: edited, revision: aNow.revision, layoutVersion: 2 })
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  const bIds = idsIn(env.config.dashboards.find((d: Dash) => d.name === b));
  // Delete one after the export: in the file it no longer clashes, so it is offered as Add, or Skip.
  const goneNow = before.dashboards.find((d) => d.id === goneId)!;
  const del = await page.request.delete(`/api/dashboards/${encodeURIComponent(goneId)}?revision=${goneNow.revision}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) }
  });
  expect(del.ok(), await del.text()).toBeTruthy();
  made.splice(made.indexOf(gone), 1);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('import-file').setInputFiles(file);
  await page.getByRole('button', { name: 'Next' }).click();
  const rows = page.getByTestId('import-row');
  await expect(rows).toHaveCount(before.dashboards.length); // every one is listed
  const confirm = page.getByTestId('import-confirm');
  await expect(confirm).toBeDisabled(); // a choice is needed for each clash

  const row = (name: string) => page.locator(`[data-testid="import-row"][data-name="${name}"]`);
  // The one with no clash starts as Add, and can be skipped like any other.
  await expect(row(gone).getByRole('radio', { name: /^Add/ })).toBeChecked();
  await expect(row(gone).getByRole('radio', { name: /^Replace/ })).toHaveCount(0);
  // Skip everything: the Import button stays off and says nothing would be imported.
  for (const r of await rows.all()) await r.getByRole('radio', { name: /^Skip/ }).check();
  await expect(page.getByTestId('import-nothing')).toContainText('Nothing would be imported');
  await expect(confirm).toBeDisabled();
  await row(a).getByRole('radio', { name: /^Replace/ }).check();
  await row(b).getByRole('radio', { name: /^Keep both/ }).check();
  for (const r of await rows.all()) {
    const n = await r.getAttribute('data-name');
    if (n !== a && n !== b) await r.getByRole('radio', { name: /^Skip/ }).check();
  }
  // Nothing has been written while choosing (the deleted one is still gone).
  expect((await config(page)).dashboards.length).toBe(before.dashboards.length - 1);
  await expect(page.getByTestId('import-nothing')).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const summary = page.getByTestId('import-summary');
  await expect(summary).toContainText(`Replaced: ${a}`);
  await expect(summary).toContainText(`Kept both: ${b}, the new one is "${b} (2)"`);
  await expect(summary).toContainText(c);
  made.push(`${b} (2)`);

  const after = await config(page);
  expect(after.dashboards.length).toBe(before.dashboards.length); // -1 deleted, +1 kept both
  expect(after.dashboards.find((d) => d.name === gone), 'the skipped new one is not imported').toBeFalsy();
  await expect(summary).toContainText(gone);
  const aAfter = after.dashboards.find((d) => d.id === aId)!;
  expect(aAfter.tabs[0].name).toBe(tabName); // replaced, same id
  const kept = after.dashboards.find((d) => d.name === `${b} (2)`)!;
  expect(kept).toBeTruthy();
  for (const id of idsIn(kept)) expect(bIds.has(id), `Keep both reused ${id}`).toBe(false);
  expect(after.dashboards.filter((d) => d.name === c)).toHaveLength(1);

  // The list behind the dialog shows the new dashboard once it is closed.
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByRole('heading', { name: `${b} (2)`, level: 3 })).toBeVisible();
});

test('fields HOPS does not recognise are imported, and named before and after', async ({ page }) => {
  const name = uniqueName('Odd fields');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const file = {
    dashboards: [{
      id: slug, name, path: `/${slug}`, mood: 'sunny',
      tabs: [{ id: `${slug}-t`, name: 'Main', groups: [{ id: `${slug}-g`, name: 'Apps',
        entries: [{ id: `${slug}-e`, name: 'Example', url: 'https://example.com', custom: 7 }] }] }]
    }]
  };
  await page.goto('/settings/dashboards');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'odd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file))
  });
  await page.getByRole('button', { name: 'Next' }).click();
  const where = 'mood; tab "Main" › folder "Apps" › tile "Example" › custom';
  await expect(page.getByTestId('import-row-unknown')).toHaveText(
    `2 fields HOPS doesn't recognise will be kept but not used: ${where}`
  );
  await page.getByTestId('import-confirm').click();
  made.push(name);
  // Imported, but shown as something to check, never a plain success.
  const box = page.getByTestId('import-warning');
  await expect(box).toContainText(`Dashboard "${name}": 2 fields HOPS doesn't recognise were kept but are not used: ${where}`);
  await expect(box).toContainText(`Added: ${name}`);
  const stored = (await config(page)).dashboards.find((d) => d.name === name) as unknown as Record<string, unknown>;
  expect(stored?.mood).toBe('sunny');
});

test('a backup file is refused by name, and nothing is imported', async ({ page }) => {
  const before = (await config(page)).dashboards.length;
  await page.goto('/settings/dashboards');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'hops-backup.json', mimeType: 'application/octet-stream',
    buffer: Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)])
  });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('import-error')).toContainText('HOPS backup');
  expect((await config(page)).dashboards.length).toBe(before);
});
