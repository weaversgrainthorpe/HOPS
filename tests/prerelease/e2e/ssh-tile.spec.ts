import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as net from 'node:net';
import { uniqueName, createDashboardViaUI, deleteDashboardsNamed, getCsrfToken, setSetting } from '../helpers';

// SSH tile preset: Host / Port / User build an ssh:// link; clicking it opens the
// computer's SSH app in place (no new tab, the dashboard stays); the iframe and popup
// modes are unavailable; the status dot is a TCP connect to host:port.

const made: string[] = [];
let madeId: string | null = null;

test.afterEach(async ({ page, context }) => {
  await deleteDashboardsNamed(page, made.splice(0));
  if (madeId) {
    const id = madeId;
    madeId = null;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup ${id}: ${r.status()}`).toBeTruthy();
  }
});

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing' });
const tileNamed = (page: Page, name: string) => page.locator('[data-node-id]', { hasText: name });

async function saveDraft(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await toolbar(page).getByRole('button', { name: /Save/ }).click();
  expect((await saved).status()).toBe(200);
}

test('SSH preset: dialog builds the URL, errors are visible, modes are unavailable, edit reopens the fields', async ({ page }) => {
  const dashName = uniqueName('SSH');
  await createDashboardViaUI(page, dashName, undefined, made);
  await toolbar(page).getByRole('button', { name: 'Add tile' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Tile' });
  await dlg.locator('#entry-type').selectOption('ssh');
  await expect(dlg.getByText("Opens your computer's SSH app. On Windows you may need to set one up first (e.g. PuTTY or Windows Terminal).")).toBeVisible();
  await expect(dlg.locator('input#url')).toHaveCount(0);
  await expect(dlg.locator('#ssh-port')).toHaveValue('22');
  // The iframe / popup modes are unavailable, and the dialog says why.
  await expect(dlg.locator('#openMode')).toBeDisabled();
  await expect(dlg.locator('#openMode option[value="iframe"], #openMode option[value="popup"]')).toHaveCount(0);
  await expect(dlg.getByText("SSH opens your computer's SSH app")).toBeVisible();
  await dlg.locator('input#name').fill('Pi');

  // Bad input: visible errors, nothing saved.
  await dlg.locator('#ssh-host').fill('my host/x');
  await dlg.locator('#ssh-port').fill('70000');
  await dlg.locator('#ssh-user').fill('a b');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#ssh-host-error')).toBeVisible();
  await expect(dlg.locator('#ssh-port-error')).toBeVisible();
  await expect(dlg.locator('#ssh-user-error')).toBeVisible();

  await dlg.locator('#ssh-host').fill('10.0.0.5');
  await dlg.locator('#ssh-port').fill('2222');
  await dlg.locator('#ssh-user').fill('pi');
  await expect(dlg.getByTestId('ssh-url-preview')).toHaveText('ssh://pi@10.0.0.5:2222');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(tileNamed(page, 'Pi')).toBeVisible();
  await saveDraft(page);

  const dash = (await (await page.request.get('/api/config')).json()).dashboards.find((d: { name: string }) => d.name === dashName);
  const stored = JSON.stringify(dash);
  expect(stored).toContain('"url":"ssh://pi@10.0.0.5:2222"');
  expect(stored).toContain('"icon":"mdi:console"');

  // Editing reopens the SSH fields; port 22 is left out of the URL.
  await tileNamed(page, 'Pi').dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Tile' });
  await expect(edit.locator('#entry-type')).toHaveValue('ssh');
  await expect(edit.locator('#ssh-host')).toHaveValue('10.0.0.5');
  await expect(edit.locator('#ssh-port')).toHaveValue('2222');
  await expect(edit.locator('#ssh-user')).toHaveValue('pi');
  await edit.locator('#ssh-port').fill('22');
  await expect(edit.getByTestId('ssh-url-preview')).toHaveText('ssh://pi@10.0.0.5');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await saveDraft(page);
  const again = JSON.stringify((await (await page.request.get('/api/config')).json()).dashboards.find((d: { name: string }) => d.name === dashName));
  expect(again).toContain('"url":"ssh://pi@10.0.0.5"');
});

async function importSshDash(page: Page, context: BrowserContext, port: number, openMode = 'iframe') {
  const p = `ssh${Date.now().toString(36)}`;
  const tileId = `${p}-t`;
  const dash = {
    id: `${p}-dash`, name: `SSH ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{
      id: `${p}-tab`, name: 'Main', order: 0,
      root: {
        columns: 24,
        children: [{
          // A plain link tile whose URL is ssh:// (stored as iframe mode) is treated as SSH.
          id: tileId, kind: 'tile', type: 'link', name: 'Box', url: `ssh://admin@127.0.0.1:${port}`, icon: 'mdi:console',
          openMode, size: 'medium', order: 0, placement: { x: 0, y: 0, w: 2, h: 2 },
          statusCheck: { type: 'http', enabled: true, interval: 60 }
        }]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'ssh.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  madeId = dash.id;
  return { path: `/${p}`, tileId };
}

test('clicking an ssh:// tile opens no new page and the dashboard stays loaded', async ({ page, context }) => {
  const f = await importSshDash(page, context, 2222);
  await page.goto(f.path);
  const tile = page.locator(`[data-node-id="${f.tileId}"] button.entry`);
  await expect(tile).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 42; });
  let newPages = 0;
  context.on('page', () => newPages++);
  await tile.click();
  await page.waitForTimeout(1000);
  expect(newPages).toBe(0);
  expect(context.pages()).toHaveLength(1);
  // Same document (not reloaded or replaced), no iframe/popup modal, still on the dashboard.
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42);
  expect(page.url()).toContain(f.path);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile).toBeVisible();
});

test('status dot: a TCP connect to host:port shows Online while it listens (down and blocked: Go tests)', async ({ page, context }) => {
  const server = net.createServer((s) => s.destroy());
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as net.AddressInfo).port;
  const f = await importSshDash(page, context, port, 'newtab');
  // Toggling the global switch runs a pass at once (the tile is explicitly on either way).
  const prev = await setSetting(page, 'status.checks_enabled', 'false');
  try {
    await setSetting(page, 'status.checks_enabled', 'true');
    await expect.poll(async () => (await (await page.request.get(`/api/status/${f.tileId}`)).json()).status, { timeout: 15_000 }).toBe('up');
    await page.goto(f.path);
    await expect(page.locator(`[data-node-id="${f.tileId}"] .status-indicator`)).toHaveAttribute('title', /^Online/);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    await setSetting(page, 'status.checks_enabled', prev);
  }
});
