import { test, expect } from '@playwright/test';

// The About dialog lists v3's features, each with its icon drawn from the offline bundle
// (no request to the Iconify API), and says nothing about folder shapes or the v2 upgrade.

const FEATURES = [
  'Multiple dashboards', 'Tabbed organization', 'Drag-and-drop editing', 'Backgrounds & slideshows',
  '8 theme presets', 'Status checks, on or off at any level', 'Custom icon uploads', 'Homer / Dashy / Heimdall import',
  'Dashboard QR codes', 'Automatic safety backups', 'CSRF + bcrypt security', 'Text size controls',
  'Folders (nested, paged)', 'Network Discovery', 'Add to HOPS from any web page', 'Home & away addresses',
  'SSH and note tiles', 'Dead link & duplicate finder', 'Search & keyboard navigation', 'Undo / redo while editing',
  "Add to your phone's home screen", 'Animations (optional)'
];

test('About lists v3 features with offline icons', async ({ page }) => {
  const iconify: string[] = [];
  page.on('request', (r) => {
    if (/iconify\.design|api\.simplesvg|api\.unisvg/.test(r.url())) iconify.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'About HOPS' }).click();
  const dlg = page.getByRole('dialog', { name: 'HOPS' });
  await expect(dlg).toBeVisible();
  const items = dlg.locator('.features li');
  await expect(items).toHaveText(FEATURES);
  for (let i = 0; i < FEATURES.length; i++) {
    await expect(items.nth(i).locator('svg'), `${FEATURES[i]} has its icon`).toBeVisible();
  }
  await expect(dlg.locator('.features')).not.toContainText(/shape|v2|upgrade/i);
  expect(iconify, 'no icon fetched from the network').toEqual([]);
});
