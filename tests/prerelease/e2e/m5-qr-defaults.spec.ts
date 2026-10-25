import { test, expect, type Page, type Browser } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { openSettings } from '../helpers';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';

// M5 §12 (design/specs/2026-10-22-hops-v3-m5-folders-design.md): a dashboard's QR code has the HOPS
// bunny in its centre, in the modal and in the downloaded SVG, and it still decodes.
// M5 §13 (Ruling 21): upload limits still at the old v2.2.1 defaults move to the new defaults at
// startup with a one-time notice that stays, across restarts, until dismissed.

/** Render an SVG in the browser onto a white canvas and decode it with jsQR (test-only devDependency;
 *  Playwright's Chromium on Linux has no BarcodeDetector). */
async function decodeSvg(page: Page, svg: string, size: number): Promise<string | null> {
	const rgba = await page.evaluate(
		async ({ svg, size }) => {
			const img = new Image();
			const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
			await new Promise<void>((res, rej) => {
				img.onload = () => res();
				img.onerror = () => rej(new Error('the SVG did not load as an image'));
				img.src = url;
			});
			const pad = Math.round(size / 8);
			const c = document.createElement('canvas');
			c.width = c.height = size + 2 * pad;
			const ctx = c.getContext('2d')!;
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, c.width, c.height);
			ctx.drawImage(img, pad, pad, size, size);
			URL.revokeObjectURL(url);
			return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
		},
		{ svg, size }
	);
	const side = Math.sqrt(rgba.length / 4);
	return jsQR(Uint8ClampedArray.from(rgba), side, side)?.data ?? null;
}

test.describe('M5 §12 QR code with the HOPS bunny', () => {
	test('the modal shows the bunny centred, the download has it, and it decodes to the dashboard URL', async ({ page }) => {
		const cfg = await (await page.request.get('/api/config')).json();
		const dash = cfg.dashboards[0];
		expect(dash, 'the test server has a dashboard').toBeTruthy();
		await openSettings(page);
		await page.getByRole('button', { name: `Show QR code for ${dash.name}`, exact: true }).click();
		const dlg = page.getByRole('dialog', { name: 'QR Code' });
		// Walkthrough: the dashboard name labels the code, so it is large (>= 22px) and full-contrast text.
		const nameEl = dlg.locator('.dashboard-name');
		await expect(nameEl).toHaveText(dash.name);
		expect(parseFloat(await nameEl.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(22);
		await expect(dlg).toBeVisible();

		// The bunny is drawn, in the centre, no wider than 20% of the code, on its dark blue backing.
		const qr = dlg.locator('.qr-frame > svg');
		const logo = qr.locator('svg[data-qr-logo]');
		const backing = qr.locator('rect[data-qr-backing]');
		await expect(logo).toBeVisible();
		await expect(backing).toBeVisible();
		// Measure once the dialog's opening animation has finished.
		await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
		const q = (await qr.boundingBox())!;
		const l = (await logo.boundingBox())!;
		expect(Math.abs(l.x + l.width / 2 - (q.x + q.width / 2))).toBeLessThan(1);
		expect(Math.abs(l.y + l.height / 2 - (q.y + q.height / 2))).toBeLessThan(1);
		expect(l.width).toBeLessThanOrEqual(q.width * 0.2 + 0.5);
		expect(await backing.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(30, 41, 59)');

		// The URL the modal shows (and the code must carry): this server's origin + the dashboard.
		const shown = (await dlg.locator('.url-text').getAttribute('title'))!;
		expect(shown.startsWith(new URL(page.url()).origin + '/')).toBe(true);
		expect(shown.endsWith(dash.path.replace(/^\//, ''))).toBe(true);

		// The downloaded SVG contains the bunny and decodes to the URL the modal shows.
		const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download SVG' }).click()]);
		const file = await download.path();
		const svg = fs.readFileSync(file!, 'utf8');
		expect(svg).toContain('data-qr-logo');
		expect(svg).toContain('data-qr-backing');
		expect(svg).toContain('hopsqr-bunnyGradient');
		// Labelled with the dashboard's name above the code, so a printed copy says what it opens.
		expect(svg).toContain('data-qr-name');
		expect(svg).toContain(`>${dash.name}</text>`);
		for (const size of [320, 200]) {
			expect(await decodeSvg(page, svg, size), `decodes at ${size}px`).toBe(shown);
		}
		// The modal's own SVG is the same code.
		const inline = await qr.evaluate((el) => el.outerHTML);
		expect(await decodeSvg(page, inline, 320)).toBe(shown);
	});
});

// The old defaults can only be found before the server loads its settings, so this starts its own
// HOPS on its own data directory, seeded with a v2.2.1-shaped settings table.
test.describe('M5 §13 settings at an old default move to the new default', () => {
	const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 8);
	const MB = 1048576;
	let child: ChildProcess | null = null;
	let dataDir = '';

	async function start() {
		child = spawn(path.join(REPO, 'backend/hops'), ['--data', dataDir, '--frontend', path.join(REPO, 'frontend/build'), '--host', '127.0.0.1'], { stdio: 'ignore' });
		const deadline = Date.now() + 20_000;
		for (;;) {
			try {
				if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break;
			} catch { /* not up yet */ }
			if (Date.now() > deadline) throw new Error('the defaults-test HOPS did not start');
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	async function stop() {
		const c = child;
		child = null;
		if (!c?.pid) return;
		const gone = new Promise((r) => c.once('exit', r));
		process.kill(c.pid, 'SIGTERM');
		await gone;
	}

	test.beforeAll(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-defaults-'));
		// Every v2.2.1 setting at its v2.2.1 default, except the icon limit, which the admin set.
		execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
rows = {
  'server.port': sys.argv[2], 'log.level': 'info', 'proxy.trusted_cidrs': '[]',
  'auth.login_rate_limit_per_min': '20', 'auth.session_lifetime_hours': '8760',
  'editmode.idle_timeout_minutes': '15', 'status.checks_enabled': 'true',
  'status.check_interval_minutes': '5', 'status.check_timeout_seconds': '10',
  'upload.max_bytes_import': '52428800', 'upload.max_bytes_background': '52428800',
  'upload.max_bytes_icon': str(4 * 1048576),
  'http.read_header_timeout_seconds': '10', 'http.read_timeout_seconds': '60',
  'http.write_timeout_seconds': '120', 'http.idle_timeout_seconds': '120',
  'discovery.max_parallel_probes': '128', 'discovery.per_host_timeout_seconds': '1',
}
for k, v in rows.items():
  c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES(?, ?)", (k, v))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
		await start();
	});

	test.afterAll(async () => {
		await stop();
		if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
	});

	async function signIn(browser: Browser) {
		const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}`, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
		const page = await ctx.newPage();
		await page.goto('/settings/global');
		const dlg = page.getByRole('dialog', { name: 'Sign in' });
		await dlg.getByLabel('Username').fill(ADMIN_USERNAME);
		await dlg.getByLabel('Password').fill(ADMIN_INITIAL_PASSWORD);
		await dlg.getByLabel('Password').press('Enter');
		await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible({ timeout: 10_000 });
		await page.fill('input#current-password', ADMIN_INITIAL_PASSWORD);
		await page.fill('input#new-password', ADMIN_TEST_PASSWORD);
		await page.fill('input#confirm-password', ADMIN_TEST_PASSWORD);
		await page.click('button:has-text("Set Password")');
		await expect(page.getByRole('heading', { name: 'Set a New Password' })).toHaveCount(0, { timeout: 15_000 });
		await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Global settings', exact: true }).click();
		await expect(page).toHaveURL(/\/settings\/global$/);
		return { ctx, page };
	}

	test('moves the untouched background limit, keeps the admin-set icon limit, and says so until dismissed', async ({ browser }) => {
		const { ctx, page } = await signIn(browser);
		try {
			const text =
				'Upload limits updated to the new defaults: Largest background image 50 MB → 25 MB. Limits you had changed yourself were left as they were.';
			const notice = page.locator('.server-notice').filter({ hasText: 'Upload limits updated to the new defaults' });
			await expect(notice).toHaveCount(1);
			await expect(notice).toContainText(text);

			const bg = page.getByLabel('Largest background image', { exact: true });
			await expect(bg).toHaveValue('25');
			await expect(page.locator('.row').filter({ has: bg })).toContainText('Default 25 MB');
			await expect(page.getByLabel('Largest icon file', { exact: true })).toHaveValue('4');
			await expect(page.getByLabel('Largest file you can import', { exact: true })).toHaveValue('50');
			const list = await (await page.request.get('/api/settings')).json();
			const val = (k: string) => String(list.settings.find((s: { key: string }) => s.key === k).value);
			expect(val('upload.max_bytes_background')).toBe(String(25 * MB));
			expect(val('upload.max_bytes_icon')).toBe(String(4 * MB));
			expect(val('upload.max_bytes_import')).toBe(String(50 * MB));

			// A restart before dismissing: the notice is still there, the values unchanged.
			await stop();
			await start();
			await page.reload();
			await expect(notice).toHaveCount(1);
			await expect(notice).toContainText(text);
			await expect(page.getByLabel('Largest background image', { exact: true })).toHaveValue('25');
			await expect(page.getByLabel('Largest icon file', { exact: true })).toHaveValue('4');

			// Dismissed: gone, and still gone after a reload and a restart.
			await notice.getByRole('button', { name: 'Dismiss' }).click();
			await expect(notice).toHaveCount(0);
			await page.reload();
			await expect(page.getByLabel('Largest background image', { exact: true })).toHaveValue('25');
			await expect(notice).toHaveCount(0);
			await stop();
			await start();
			await page.reload();
			await expect(page.getByLabel('Largest background image', { exact: true })).toHaveValue('25');
			await expect(notice).toHaveCount(0);
		} finally {
			await ctx.close();
		}
	});
});
