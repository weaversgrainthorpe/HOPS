import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken, deleteDashboardsNamed, setSetting } from '../helpers';

// In a REAL browser: a tile's status check is On or Off, and a Disabled dashboard, tab or folder
// stops every check beneath it. The badge follows what the server resolves, the dialogs say when a
// Disabled gate above makes a setting have no effect, and the dashboard dialog saves its gate.
// Synthetic dashboards only, deleted afterwards; the global setting is set Enabled and put back.

let seq = 0;
const placement = (x: number, y: number, w = 2, h = 2) => ({ x, y, w, h });
const nulls = { statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null };

async function importDash(page: Page, context: BrowserContext, dash: Record<string, unknown>) {
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'gates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
}

/**
 * An Enabled dashboard: a tile On, a tile with no setting (Off), an old Inherit (enabled null:
 * Off), and a Disabled folder holding a tile that is On.
 */
async function setup(page: Page, context: BrowserContext, names: string[], dashboardGate: boolean | null = null) {
  const p = `gt${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const tile = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    id: id(key), kind: 'tile', type: 'link', name, url: `https://${key}.${p}.example.lan/`, icon: 'mdi:lan',
    openMode: 'newtab', size: 'medium', order: 0, ...extra
  });
  const on = { type: 'http', enabled: true, interval: 60 };
  const name = `Gates ${p}`;
  await importDash(page, context, {
    id: id('dash'), name, order: 0, path: `/${p}`, revision: 1,
    settings: { statusChecksEnabled: dashboardGate, ...nulls },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0,
      root: { columns: 24, children: [
        tile('on', 'Checked', { placement: placement(0, 0), statusCheck: on }),
        tile('unset', 'Plain', { placement: placement(2, 0) }),
        tile('inh', 'Old inherit', { placement: placement(4, 0), statusCheck: { type: 'http', enabled: null, interval: 60 } }),
        {
          id: id('lab'), kind: 'folder', name: 'Lab', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
          statusChecksEnabled: false, placement: placement(0, 2, 12, 9),
          content: { children: [tile('in', 'Inner', { statusCheck: on })] }
        }
      ] }
    }]
  });
  names.push(name);
  return { p, id, name, path: `/${p}`, dashId: id('dash') };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function withFixture(
  page: Page, context: BrowserContext, body: (f: Fixture) => Promise<void>, dashboardGate: boolean | null = null
) {
  const names: string[] = [];
  const before = await setSetting(page, 'status.checks_enabled', 'true');
  try {
    await body(await setup(page, context, names, dashboardGate));
  } finally {
    await setSetting(page, 'status.checks_enabled', before);
    await deleteDashboardsNamed(page, names);
  }
}

async function dashboardOf(page: Page, dashId: string) {
  const cfg = await (await page.request.get('/api/config')).json();
  return cfg.dashboards.find((d: { id: string }) => d.id === dashId);
}

async function editMode(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

test.describe('status checks: tiles On / Off, gates above', () => {
  test('only an On tile under Enabled gates has a badge; the editor names the Disabled gate', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      const node = (k: string) => page.locator(`[data-node-id="${f.id(k)}"]`);
      const innerStatus = page.waitForResponse((r) => r.url().endsWith(`/api/status/${f.id('in')}`));
      await page.goto(f.path);
      await expect(node('on').locator('.status-badge .status-indicator')).toBeVisible();
      await expect(node('unset')).toBeVisible();
      await expect(node('unset').locator('.status-badge')).toHaveCount(0);
      await expect(node('inh').locator('.status-badge')).toHaveCount(0);
      const inner = await (await innerStatus).json();
      expect(inner).toMatchObject({ status: 'disabled', source: 'folder', sourceId: f.id('lab') });
      await expect(node('in').locator('.status-badge')).toHaveCount(0);

      await editMode(page);
      await expect(node('in').locator('.status-badge .status-indicator')).toHaveAttribute(
        'title', 'Not checked: status monitoring is disabled on folder Lab'
      );
    });
  });

  test('tile dialog: On / Off (no Inherit), the blocked note, and Off keeps the other fields', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      const node = (k: string) => page.locator(`[data-node-id="${f.id(k)}"]`);
      await page.goto(f.path);
      await editMode(page);

      await node('in').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      let dlg = page.getByRole('dialog');
      let group = dlg.getByRole('group', { name: 'Status check' });
      await expect(group.getByRole('radio', { name: 'On' })).toBeChecked();
      await expect(group.getByRole('radio', { name: 'Inherit' })).toHaveCount(0);
      await expect(group).toContainText('Not checked: status monitoring is disabled on folder Lab');
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(dlg).toHaveCount(0);

      // The old Inherit reads as Off.
      await node('inh').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      dlg = page.getByRole('dialog');
      group = dlg.getByRole('group', { name: 'Status check' });
      await expect(group.getByRole('radio', { name: 'Off' })).toBeChecked();
      await dlg.getByRole('button', { name: 'Cancel' }).click();

      // Switch the checked tile Off and save the dashboard.
      await node('on').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      dlg = page.getByRole('dialog');
      await dlg.getByRole('group', { name: 'Status check' }).getByRole('radio', { name: 'Off' }).check();
      await dlg.getByRole('button', { name: /^Save$/ }).click();
      await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await dashboardOf(page, f.dashId)).tabs[0].root.children[0].statusCheck)
        .toEqual({ type: 'http', enabled: false, interval: 60 });
    });
  });

  test('folder dialog: Enabled / Disabled; Enabled removes the key and the inner tile is checked', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      await page.goto(f.path);
      await editMode(page);
      await page.locator(`[data-node-id="${f.id('lab')}"]`).first().click({ button: 'right', position: { x: 12, y: 12 } });
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      const dlg = page.getByRole('dialog');
      const group = dlg.getByRole('group', { name: 'Status checks for tiles in this folder' });
      await expect(group.getByRole('radio', { name: 'Disabled' })).toBeChecked();
      await expect(group).toContainText('No tile in this folder is checked, whatever its own setting.');
      await group.getByRole('radio', { name: 'Enabled' }).check();
      await dlg.getByRole('button', { name: /^Save$/ }).click();
      await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => 'statusChecksEnabled' in (await dashboardOf(page, f.dashId)).tabs[0].root.children[3]).toBe(false);

      await page.goto(f.path);
      await expect(page.locator(`[data-node-id="${f.id('in')}"] .status-badge .status-indicator`)).toBeVisible();
    });
  });

  test('dashboard dialog: the gate saves as false, and a Disabled dashboard makes the tab setting have no effect', async ({ page, context }) => {
    await withFixture(page, context, async (f) => {
      await page.goto(f.path);
      await editMode(page);
      await page.getByRole('button', { name: 'Edit Dashboard' }).click();
      const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
      await dlg.getByRole('tab', { name: 'Settings' }).click();
      const group = dlg.getByRole('group', { name: 'Status checks for tiles in this dashboard' });
      await expect(group.getByRole('radio', { name: 'Enabled' })).toBeChecked();
      await group.getByRole('radio', { name: 'Disabled' }).check();
      await expect(group).toContainText('No tile in this dashboard is checked, whatever its own setting.');
      await dlg.getByRole('button', { name: 'Save' }).click();
      await expect(dlg).toHaveCount(0);
      const s = await (await page.request.get(`/api/dashboards/${encodeURIComponent(f.dashId)}/settings`)).json();
      expect(s.overrides.statusChecksEnabled).toBe(false);

      await page.getByRole('tab', { name: 'Switch to Main tab' }).dblclick();
      const tabDlg = page.getByRole('dialog', { name: 'Edit Tab' });
      await expect(tabDlg.getByRole('group', { name: 'Status checks for tiles in this tab' }))
        .toContainText(`Status monitoring is disabled on dashboard ${f.name}, so this setting has no effect`);
    });
  });
});
