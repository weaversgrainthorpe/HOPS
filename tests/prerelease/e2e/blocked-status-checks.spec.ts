import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken, deleteDashboardsNamed, setSetting } from '../helpers';

// In a real browser: Settings › Dashboards › Blocked status checks lists the tiles that are On but
// stopped by a Disabled dashboard, tab or folder, names the outermost one ("+N more" for the rest)
// and links to the dashboard. With the global setting Disabled it says only that. Synthetic
// dashboards only, deleted afterwards; the global setting is put back.

const PAGE = '/settings/dashboards/blocked-status-checks';
const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });
const nulls = { statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null };

async function setup(page: Page, context: BrowserContext, names: string[]) {
  const p = `bs${Date.now().toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const on = { type: 'http', enabled: true, interval: 60 };
  const tile = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'tile', type: 'link', name, url: `https://${key}.${p}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, ...extra
  });
  const name = `Blocked ${p}`;
  const dash = {
    id: id('dash'), name, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: null, ...nulls },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: { columns: 24, children: [
        tile('free', 'Free', { placement: placement(0, 0), statusCheck: on }),
        tile('offed', 'Off one', { placement: placement(2, 0), statusCheck: { type: 'http', enabled: false } }),
        {
          id: id('lab'), kind: 'folder', name: 'Lab', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
          statusChecksEnabled: false, placement: placement(0, 2, 12, 9),
          content: { children: [
            tile('in', 'Inner', { statusCheck: on }),
            tile('inoff', 'Inner off')
          ] }
        }
      ] }
    }, {
      id: id('tab2'), name: 'Quiet', order: 1, statusChecksEnabled: false,
      root: { columns: 24, children: [{
        id: id('deep'), kind: 'folder', name: 'Deep', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
        statusChecksEnabled: false, placement: placement(0, 0, 12, 9),
        content: { children: [tile('q', 'Quiet tile', { statusCheck: on })] }
      }] }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'bs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  names.push(name);
  return { id, name, path: `/${p}`, dashId: id('dash') };
}

test.describe('Blocked status checks page', () => {
  test('lists On tiles stopped by a Disabled gate, the outermost named, with a link to the dashboard', async ({ page, context }) => {
    const names: string[] = [];
    const before = await setSetting(page, 'status.checks_enabled', 'true');
    try {
      const f = await setup(page, context, names);
      await page.goto('/settings/dashboards');
      await page.getByRole('list', { name: 'Dashboards pages' }).getByRole('link', { name: 'Blocked status checks' }).click();
      await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
      const group = page.locator(`[data-bsc-group="${f.dashId}"]`);
      await expect(group.getByTestId('bsc-row')).toHaveCount(2);
      const inner = group.locator(`[data-key="${f.dashId}:${f.id('in')}"]`);
      await expect(inner).toContainText('Inner');
      await expect(inner).toContainText(`${f.name} › Main › Lab`);
      await expect(inner).toContainText('Blocked by folder Lab');
      const quiet = group.locator(`[data-key="${f.dashId}:${f.id('q')}"]`);
      await expect(quiet).toContainText('Blocked by tab Quiet +1 more');
      await expect(group.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', new RegExp(`${f.path}$`));
      // No bulk edits on this page.
      await expect(page.getByTestId('blocked-status-checks').getByRole('checkbox')).toHaveCount(0);
      // The tile's own link reveals it on its dashboard.
      await inner.getByRole('button', { name: 'Inner' }).click();
      await expect(page).toHaveURL(new RegExp(`${f.path}$`));
      await expect(page.locator(`[data-node-id="${f.id('in')}"]`)).toBeVisible();
    } finally {
      await setSetting(page, 'status.checks_enabled', before);
      await deleteDashboardsNamed(page, names);
    }
  });

  test('global Disabled: one line, with a link to the setting', async ({ page, context }) => {
    const names: string[] = [];
    const before = await setSetting(page, 'status.checks_enabled', 'false');
    try {
      await setup(page, context, names);
      await page.goto(PAGE);
      const section = page.getByTestId('blocked-status-checks');
      await expect(section).toContainText('Status monitoring is disabled in Settings, so nothing is checked.');
      await expect(section.getByTestId('bsc-row')).toHaveCount(0);
      await expect(section.getByRole('link')).toHaveAttribute('href', '/settings/global#status-checks');
    } finally {
      await setSetting(page, 'status.checks_enabled', before);
      await deleteDashboardsNamed(page, names);
    }
  });

  test('the earlier address redirects here', async ({ page }) => {
    await page.goto('/settings/dashboards/status-overrides');
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { name: 'Blocked status checks' })).toBeVisible();
  });

  test('phone width: no sideways scrolling', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const names: string[] = [];
    const before = await setSetting(page, 'status.checks_enabled', 'true');
    try {
      const f = await setup(page, context, names);
      await page.goto(PAGE);
      await expect(page.locator(`[data-bsc-group="${f.dashId}"]`).getByTestId('bsc-row')).toHaveCount(2);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scroll: doc.scrollWidth, client: doc.clientWidth };
      });
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    } finally {
      await setSetting(page, 'status.checks_enabled', before);
      await deleteDashboardsNamed(page, names);
    }
  });
});
