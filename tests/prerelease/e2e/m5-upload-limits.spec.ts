import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken, setSetting } from '../helpers';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';

// M5 §10 (design/specs/2026-10-22-hops-v3-m5-folders-design.md): the upload limits read plainly,
// in MB, with no "min"; a value under 1 MB (or empty/invalid) is refused and not saved; a stored
// value above a new ceiling is lowered on load with a visible notice; and an upload over a limit
// is refused with a message naming the limit and the file's size. In a REAL browser and server.

const MB = 1048576;
const KEYS = {
	import: 'upload.max_bytes_import',
	background: 'upload.max_bytes_background',
	icon: 'upload.max_bytes_icon'
};

async function storedValue(page: Page, key: string): Promise<string> {
	const list = await (await page.request.get('/api/settings')).json();
	return String(list.settings.find((s: { key: string }) => s.key === key).value);
}

async function rowFor(page: Page, label: string) {
	const input = page.getByLabel(label, { exact: true });
	await expect(input).toBeVisible();
	return { input, row: page.locator('.row').filter({ has: input }) };
}

test.describe('M5 §10 upload limits in the settings page', () => {
	test('each limit is labelled plainly and shown in MB, with no "min"', async ({ page }) => {
		await page.goto('/settings/global');
		await expect(page.getByRole('heading', { name: 'Uploads', level: 3 })).toBeVisible();
		const cases: [string, string, string][] = [
			['Largest import', '50', '200 MB'],
			['Largest background upload', '25', '100 MB'],
			['Largest icon upload', '2', '10 MB']
		];
		for (const [label, value, ceiling] of cases) {
			const { input, row } = await rowFor(page, label);
			await expect(input).toHaveValue(value);
			await expect(row).toContainText('MB');
			await expect(row).toContainText(`can be set up to ${ceiling}`);
			await expect(row).not.toContainText(/\bmin\b/i);
			await expect(row).not.toContainText(String(Number(value) * MB));
		}
	});

	test('a value under 1 MB, empty or invalid is refused with a message and not saved; a good one saves in bytes', async ({ page }) => {
		await page.goto('/settings/global');
		const { input, row } = await rowFor(page, 'Largest import');
		const before = await storedValue(page, KEYS.import);
		for (const bad of ['0.5', '', 'abc']) {
			await input.fill(bad);
			await row.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(row.locator('.error.inline')).toHaveText('Must be at least 1 MB');
			expect(await storedValue(page, KEYS.import), `"${bad}" must not be saved`).toBe(before);
		}
		await input.fill('75');
		await row.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(row.locator('.error.inline')).toHaveCount(0);
		await expect.poll(() => storedValue(page, KEYS.import)).toBe(String(75 * MB));
		// Back to the default through the UI.
		await row.getByRole('button', { name: 'Reset to default' }).click();
		await expect(input).toHaveValue('50');
		await row.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.poll(() => storedValue(page, KEYS.import)).toBe(String(50 * MB));
	});
});

test.describe('M5 §10 oversize uploads are refused with a message naming the limit and the size', () => {
	const restore: [string, string][] = [];
	let made: string | null = null;

	test.afterEach(async ({ page, context }) => {
		while (restore.length) {
			const [k, v] = restore.pop()!;
			await setSetting(page, k, v);
		}
		if (made) {
			const id = made;
			made = null;
			const cfg = await (await page.request.get('/api/config')).json();
			const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
			const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
				headers: { 'X-CSRF-Token': await getCsrfToken(context) }
			});
			expect(r.ok(), `cleanup: delete ${id}`).toBeTruthy();
		}
	});

	async function limitTo1MB(page: Page, key: string) {
		restore.push([key, await setSetting(page, key, String(MB))]);
	}

	const big = (name: string, mimeType: string) => ({ name, mimeType, buffer: Buffer.alloc(Math.round(1.5 * MB), 0x20) });

	test('the server refuses each oversize upload (413) with the limit and the size', async ({ page, context }) => {
		for (const k of Object.values(KEYS)) await limitTo1MB(page, k);
		const csrf = await getCsrfToken(context);
		const cases: [string, string, string][] = [
			['/api/config/import', 'application/json', 'largest file you can import'],
			['/api/backgrounds', 'image/png', 'largest background image'],
			['/api/icons/upload', 'image/png', 'largest icon file']
		];
		for (const [url, mime, phrase] of cases) {
			const r = await page.request.post(url, { headers: { 'X-CSRF-Token': csrf }, multipart: { file: big('big.dat', mime) } });
			expect(r.status(), url).toBe(413);
			const msg = (await r.json()).error as string;
			expect(msg).toContain('1.5 MB');
			expect(msg).toContain('is 1 MB');
			expect(msg).toContain(phrase);
		}
	});

	test('Import: an oversize file is refused in the dialog, naming the limit and the size', async ({ page }) => {
		await limitTo1MB(page, KEYS.import);
		await page.goto('/settings/dashboards');
		await page.getByRole('button', { name: 'Import' }).click();
		await page.locator('input[type="file"][accept=".json,.yml,.yaml"]').setInputFiles(big('huge.json', 'application/json'));
		await page.getByRole('button', { name: /^Import/ }).last().click();
		await expect(page.getByText(/This file is 1\.5 MB, but the largest file you can import is 1 MB/)).toBeVisible();
	});

	async function seedDash(page: Page, context: BrowserContext) {
		const p = `m5ul${Date.now().toString(36)}`;
		const id = (s: string) => `${p}-${s}`;
		const kid = (key: string, name: string) => ({
			id: id(key), kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
			openMode: 'newtab', size: 'medium', order: 0
		});
		const dash = {
			id: id('dash'), name: `Upload limits ${p}`, order: 0, path: `/${p}`, revision: 1,
			settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
			tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [
				{ ...kid('anchor', 'Anchor'), placement: { x: 0, y: 0, w: 2, h: 2 } },
				{ id: id('f'), kind: 'folder', name: 'Folder f', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
					showTitle: true, placement: { x: 0, y: 2, w: 8, h: 6 }, content: { children: [kid('ft', 'Inner')] } }
			] } }]
		};
		const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
		const r = await page.request.post('/api/config/import', {
			headers: { 'X-CSRF-Token': await getCsrfToken(context) },
			multipart: { file: { name: 'ul.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
		});
		expect(r.status(), await r.text()).toBe(200);
		made = id('dash');
		await page.goto(`/${p}`);
		await expect(page.locator(`[data-node-id="${id('anchor')}"]`)).toBeVisible();
		await page.locator('[aria-label="Enter Edit Mode"]').click();
		await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
		return id;
	}

	test('Background upload: an oversize image is refused in the picker, naming the limit and the size', async ({ page, context }) => {
		await limitTo1MB(page, KEYS.background);
		const id = await seedDash(page, context);
		await page.locator(`[data-node-id="${id('f')}"]`).dblclick({ position: { x: 20, y: 20 } });
		const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
		await dlg.getByRole('button', { name: /^Background/ }).click();
		const picker = page.getByRole('dialog', { name: 'Folder background' });
		await picker.getByRole('radio', { name: 'Its own picture' }).check();
		await picker.getByRole('button', { name: /^Image$/ }).click();
		await picker.locator('input#bg-file-upload').setInputFiles(big('huge.png', 'image/png'));
		await expect(picker.locator('.upload-error')).toContainText(/This file is 1\.5 MB, but the largest background image allowed is 1 MB/);
	});

	test('Icon upload: an oversize icon is refused in the tile editor, naming the limit and the size', async ({ page, context }) => {
		await limitTo1MB(page, KEYS.icon);
		const id = await seedDash(page, context);
		await page.locator(`[data-node-id="${id('anchor')}"]`).dblclick();
		const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
		await expect(dlg).toBeVisible();
		await dlg.getByRole('button', { name: 'Edit icon' }).click();
		await page.getByLabel('Upload custom icon image').setInputFiles(big('huge.png', 'image/png'));
		await expect(page.locator('.error-text')).toContainText(/This file is 1\.5 MB, but the largest icon file allowed is 1 MB/);
	});
});

// A stored value above its new ceiling (saved under the old 1 GB ceiling) can only exist before
// the server loads its settings, so this starts its own HOPS on its own fresh data directory.
test.describe('M5 §10 a stored limit above the new ceiling', () => {
	const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 7);
	let child: ChildProcess | null = null;
	let dataDir = '';

	test.beforeAll(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-clamp-'));
		execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('upload.max_bytes_import', ?)", (str(1 << 30),))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
		child = spawn(path.join(REPO, 'backend/hops-testdev'), ['--data', dataDir, '--frontend', path.join(REPO, 'frontend/build'), '--host', '127.0.0.1'], { stdio: 'ignore' });
		const deadline = Date.now() + 20_000;
		for (;;) {
			try {
				if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break;
			} catch { /* not up yet */ }
			if (Date.now() > deadline) throw new Error('the clamp-test HOPS did not start');
			await new Promise((r) => setTimeout(r, 200));
		}
	});

	test.afterAll(async () => {
		if (child?.pid) process.kill(child.pid, 'SIGTERM');
		child = null;
		if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
	});

	test('is lowered on load and the page says "Lowered from 1024 MB to the new maximum 200 MB" until saved', async ({ browser }) => {
		const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}`, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
		const page = await ctx.newPage();
		try {
			await page.goto('/settings/global');
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
			await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Global settings', exact: true }).click();
			await expect(page).toHaveURL(/\/settings\/global$/);

			const notice = 'Lowered from 1024 MB to the new maximum 200 MB.';
			await expect(page.locator('.adjusted-banner')).toContainText(notice);
			const { input, row } = await rowFor(page, 'Largest import');
			await expect(input).toHaveValue('200');
			await expect(row).toContainText(notice);
			// The server is already using the lowered limit.
			expect(await storedValue(page, KEYS.import)).toBe(String(200 * MB));

			// It stays until the admin saves (a reload does not lose it) …
			await page.reload();
			await expect(page.locator('.adjusted-banner')).toContainText(notice);
			// … and saving clears it.
			await row.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(page.locator('.adjusted-banner')).toHaveCount(0);
			await page.reload();
			await expect(page.getByLabel('Largest import', { exact: true })).toHaveValue('200');
			await expect(page.locator('.adjusted-banner')).toHaveCount(0);
		} finally {
			await ctx.close();
		}
	});
});
