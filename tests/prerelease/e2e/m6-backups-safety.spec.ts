import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { hopsCommand } from '../hops-bin';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDashboardViaUI } from '../helpers';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';

// Backups never fail silently (M6 backups defects), in a REAL browser and server. This starts its
// own HOPS on its own data directory whose backups folder is made read-only after the first
// start, so every backup fails for real:
// - the failed startup backup is a visible notice (with its time and reason) in Settings, with no
//   Dismiss, until a backup succeeds;
// - a save still goes through, and its "backup failed" warning stays on screen in the editor;
// - a restore is refused (nothing restored) and the dialog says why.
// Synthetic data only: a fresh data directory, nothing copied from anywhere.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 9);
const BASE = `http://localhost:${PORT}`;

let child: ChildProcess | null = null;
let dataDir = '';
let backupsDir = '';

async function startServer() {
	child = spawn(...hopsCommand(dataDir), { stdio: 'ignore' });
	const deadline = Date.now() + 20_000;
	for (;;) {
		try {
			if ((await fetch(`${BASE}/api/health`)).ok) return;
		} catch { /* not up yet */ }
		if (Date.now() > deadline) throw new Error('the backups-test HOPS did not start');
		await new Promise((r) => setTimeout(r, 200));
	}
}

async function stopServer() {
	const c = child;
	child = null;
	if (!c || c.exitCode !== null) return;
	const exited = new Promise((r) => c.once('exit', r));
	c.kill('SIGTERM');
	await exited;
}

const backupFiles = () => (fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((n) => n.startsWith('hops-backup-')) : []);

test.describe.configure({ mode: 'serial' });

test.describe('M6 backups never fail silently', () => {
	let ctx: BrowserContext;
	let page: Page;

	test.beforeAll(async ({ browser }) => {
		test.skip(process.getuid?.() === 0, 'root ignores directory permissions');
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-backups-'));
		backupsDir = path.join(dataDir, 'backups');
		execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
		// First start: a working startup backup (a real HOPS database to try restoring later).
		await startServer();
		await expect.poll(() => backupFiles().length, { timeout: 10_000 }).toBeGreaterThan(0);
		await stopServer();
		// Second start with a read-only backups folder: the startup backup fails.
		fs.chmodSync(backupsDir, 0o555);
		await startServer();

		ctx = await browser.newContext({ baseURL: BASE, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
		page = await ctx.newPage();
		await page.goto('/settings');
		const signIn = page.getByRole('dialog', { name: 'Sign in' });
		await signIn.getByLabel('Username').fill(ADMIN_USERNAME);
		await signIn.getByLabel('Password').fill(ADMIN_INITIAL_PASSWORD);
		await signIn.getByLabel('Password').press('Enter');
		await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible({ timeout: 10_000 });
		await page.fill('input#current-password', ADMIN_INITIAL_PASSWORD);
		await page.fill('input#new-password', ADMIN_TEST_PASSWORD);
		await page.fill('input#confirm-password', ADMIN_TEST_PASSWORD);
		await page.click('button:has-text("Set Password")');
		await expect(page.getByRole('heading', { name: 'Set a New Password' })).toHaveCount(0, { timeout: 15_000 });
	});

	test.afterAll(async () => {
		await ctx?.close();
		await stopServer();
		if (backupsDir && fs.existsSync(backupsDir)) fs.chmodSync(backupsDir, 0o755);
		if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
	});

	const startupNotice = () => page.locator('.server-notice.warning', { hasText: 'The automatic backup taken when HOPS started failed at' });

	test('the failed startup backup is a visible notice with its time and reason, and no Dismiss', async () => {
		await page.goto('/settings/dashboards');
		const n = startupNotice();
		await expect(n).toBeVisible();
		await expect(n).toHaveAttribute('role', 'alert');
		await expect(n).toContainText(/started failed at \d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2}/);
		await expect(n).toContainText(/unable to open|permission denied/);
		await expect(n.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
		// It persists across a reload (it lasts until a backup succeeds).
		await page.reload();
		await expect(startupNotice()).toBeVisible();
	});

	test('a save still goes through, and its backup warning stays on screen in the editor', async () => {
		await createDashboardViaUI(page, 'Backup safety');
		// Clear any earlier toasts so the one checked is the editor save's.
		const closers = page.locator('.toast .toast-close');
		while ((await closers.count()) > 0) await closers.first().click();
		const toolbar = page.getByRole('toolbar', { name: 'Editing' });
		await toolbar.getByRole('button', { name: 'Add tile' }).click();
		const dlg = page.getByRole('dialog', { name: 'New Tile' });
		await dlg.locator('input#name').fill('Router');
		await dlg.locator('input#url').fill('https://router.example.lan/');
		await dlg.getByRole('button', { name: 'Create' }).click();
		const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
		await toolbar.getByRole('button', { name: /Save/ }).click();
		const resp = await saved;
		expect(resp.status(), 'the save is not blocked by the failed backup').toBe(200);
		expect((await resp.json()).warning).toContain('Pre-update backup failed');
		const warn = page.locator('.toast.toast-warning', { hasText: 'Pre-update backup failed' });
		await expect(warn).toBeVisible();
		await expect(warn).toContainText('Config saved anyway');
		// Not a 4-second flash: still there well after an ordinary toast would have gone.
		await page.waitForTimeout(6_000);
		await expect(warn).toBeVisible();
		const stored = await (await page.request.get('/api/config')).json();
		expect(JSON.stringify(stored)).toContain('https://router.example.lan/');
	});

	test('a restore is refused when the safety backup fails, and the dialog says so', async () => {
		await page.goto('/settings/backups');
		const modal = page.locator('#backups');
		const name = backupFiles()[0];
		await modal.getByRole('button', { name: `Restore ${name}` }).click();
		const confirmDlg = page.locator('[aria-labelledby="confirm-title"]');
		await confirmDlg.getByRole('button', { name: 'Restore', exact: true }).click();
		const msg = modal.locator('.action-error');
		await expect(msg).toBeVisible();
		await expect(msg).toContainText("Couldn't take a safety backup first, so nothing was restored:");
		await expect(msg).toContainText(/unable to open|permission denied/);
		// Nothing was staged and the server is still up (no restart).
		expect(fs.existsSync(path.join(dataDir, 'hops.db.restore-pending'))).toBe(false);
		expect((await fetch(`${BASE}/api/health`)).ok).toBe(true);
	});

	test('the notice goes once a backup works again', async () => {
		fs.chmodSync(backupsDir, 0o755);
		const modal = page.locator('#backups');
		await modal.getByRole('button', { name: 'Create Backup' }).click();
		await expect(page.locator('.toast', { hasText: 'Backup created' })).toBeVisible();
		await expect(modal.locator('.problem')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.locator('.server-notice.warning')).toHaveCount(0);
	});

	test('a working restore takes its safety backup, restarts, and is applied on the next start', async () => {
		// The dashboard made above exists now; the backup just created holds it. Delete it, then
		// restore that backup: the dashboard comes back.
		const before = await (await page.request.get('/api/config')).json();
		const dash = before.dashboards.find((d: { name: string }) => d.name === 'Backup safety');
		expect(dash).toBeTruthy();
		const csrf = (await ctx.cookies()).find((c) => c.name === 'hops_csrf')?.value ?? '';
		const del = await page.request.delete(`/api/dashboards/${dash.id}?revision=${dash.revision}`, { headers: { 'X-CSRF-Token': csrf } });
		expect(del.ok()).toBe(true);
		const manual = backupFiles().filter((n) => n.endsWith('_manual.db')).sort().pop()!;
		const exited = new Promise<number | null>((r) => child!.once('exit', (code) => r(code)));
		await page.goto('/settings/backups');
		const modal = page.locator('#backups');
		await modal.getByRole('button', { name: `Restore ${manual}` }).click();
		await page.locator('[aria-labelledby="confirm-title"]').getByRole('button', { name: 'Restore', exact: true }).click();
		await expect(page.locator('.toast', { hasText: 'restarting to apply it' })).toBeVisible();
		expect(await exited, 'the server exits for its service manager to restart it').toBe(75);
		child = null;
		expect(backupFiles().some((n) => n.endsWith('_pre-restore.db')), 'the safety backup was taken').toBe(true);
		await startServer();
		expect(fs.existsSync(path.join(dataDir, 'hops.db.restore-pending')), 'the staged restore was applied').toBe(false);
		const after = await (await page.request.get('/api/config')).json();
		expect(after.dashboards.some((d: { name: string }) => d.name === 'Backup safety'), 'the restored data is live').toBe(true);
	});
});
