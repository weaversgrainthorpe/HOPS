import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';

// M6 §12 (Option B): backups keep their images, in a REAL browser and server. This starts its own
// HOPS on its own data directory (a restore restarts the server, which the shared test server
// can't survive):
// - delete an icon, restore a backup from before the delete, and the image displays again;
// - a backup downloads as a .zip that holds the image and a manifest;
// - an uploaded archive, restored, brings its images back even when HOPS no longer has them;
// - a tampered archive is refused with a visible reason; a legacy .db upload shows its warning.
// Synthetic data only: a fresh data directory and a generated 1×1 PNG.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 11);
const BASE = `http://localhost:${PORT}`;

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

let child: ChildProcess | null = null;
let dataDir = '';
let workDir = '';

async function startServer() {
	child = spawn(path.join(REPO, 'backend/hops-testdev'), ['--data', dataDir, '--frontend', path.join(REPO, 'frontend/build'), '--host', '127.0.0.1'], { stdio: 'ignore' });
	const deadline = Date.now() + 20_000;
	for (;;) {
		try {
			if ((await fetch(`${BASE}/api/health`)).ok) return;
		} catch { /* not up yet */ }
		if (Date.now() > deadline) throw new Error('the backup-images HOPS did not start');
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

/** Python (isolated mode) on a file, for zip inspection and tampering. */
function py(script: string, ...args: string[]): string {
	return execFileSync('python3', ['-I', '-c', script, ...args], { encoding: 'utf8' });
}

function zipNames(file: string): string[] {
	return JSON.parse(py('import sys,json,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', file));
}

test.describe.configure({ mode: 'serial' });

test.describe('M6 §12 backups keep their images', () => {
	let ctx: BrowserContext;
	let page: Page;
	let iconUrl = '';
	let iconFile = '';
	let beforeDelete = '';
	let archivePath = '';
	const dashName = 'Images e2e';
	const dashPath = '/imgs';

	const csrf = async () => ({ 'X-CSRF-Token': (await ctx.cookies()).find((c) => c.name === 'hops_csrf')?.value ?? '' });
	const backupsDialog = () => page.locator('[aria-labelledby="backup-manager-title"]');
	const list = async () => (await (await page.request.get('/api/backups')).json()) as { backups: { name: string }[]; attic?: { files: number } };
	// The attic is keyed by content: attic/icons/<sha256>.
	let iconSha = '';
	const atticFile = () => path.join(dataDir, 'attic', 'icons', iconSha);
	const liveFile = () => path.join(dataDir, 'icons', iconFile);

	async function openBackups(waitForItems = true) {
		await page.goto('/settings/backups');
		await page.getByRole('button', { name: 'Open Backups' }).click();
		if (waitForItems) await expect(backupsDialog().locator('.backup-item').first()).toBeVisible();
		else await expect(backupsDialog().getByRole('button', { name: 'Create Backup' })).toBeEnabled();
	}

	/** Restore through the dialog; the server exits for its service manager, and is started again. */
	async function restoreViaUI(name: string) {
		const exited = new Promise<number | null>((r) => child!.once('exit', (code) => r(code)));
		await openBackups();
		await backupsDialog().getByRole('button', { name: `Restore ${name}` }).click();
		await page.locator('[aria-labelledby="confirm-title"]').getByRole('button', { name: 'Restore', exact: true }).click();
		await expect(page.locator('.toast', { hasText: 'restarting to apply it' })).toBeVisible();
		expect(await exited).toBe(75);
		child = null;
		await startServer();
	}

	async function dashboard() {
		const cfg = await (await page.request.get('/api/config')).json();
		return cfg.dashboards.find((d: { name: string }) => d.name === dashName) as { id: string; revision: number } | undefined;
	}

	async function expectTileImageShows() {
		await page.goto(dashPath);
		const img = page.locator(`img[src="${iconUrl}"]`).first();
		await expect(img).toBeVisible();
		await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
	}

	test.beforeAll(async ({ browser }) => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-images-'));
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-images-work-'));
		py(`
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT);
		await startServer();
		ctx = await browser.newContext({ baseURL: BASE, serviceWorkers: 'block', acceptDownloads: true, storageState: { cookies: [], origins: [] } });
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

		// An uploaded icon, used by a tile on a dashboard.
		const up = await page.request.post('/api/icons/upload', {
			headers: await csrf(),
			multipart: { categoryId: 'uploads', name: 'Synthetic router', file: { name: 'router.png', mimeType: 'image/png', buffer: PNG } }
		});
		expect(up.status(), await up.text()).toBe(200);
		iconUrl = (await up.json()).url;
		iconFile = iconUrl.replace('/icons/', '');
		iconSha = createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'icons', iconFile))).digest('hex');
		const p = 'imgs';
		const dash = {
			id: `${p}-dash`, name: dashName, order: 0, path: dashPath, revision: 1,
			settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
			tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
				{ id: `${p}-t1`, kind: 'tile', type: 'link', name: 'Router', url: 'https://router.example.lan/', iconUrl,
					openMode: 'newtab', size: 'small', order: 0, placement: { x: 0, y: 0, w: 1, h: 1 } }
			] } }]
		};
		const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
		const r = await page.request.post('/api/config/import', {
			headers: await csrf(),
			multipart: { file: { name: 'imgs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
		});
		expect(r.status(), await r.text()).toBe(200);
		await expectTileImageShows();
	});

	test.afterAll(async () => {
		await ctx?.close();
		await stopServer();
		if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
		if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
	});

	test('delete an icon, restore a backup from before the delete, and the image displays', async () => {
		// The backup from before the delete.
		await openBackups();
		await backupsDialog().getByRole('button', { name: 'Create Backup' }).click();
		await expect(page.locator('.toast', { hasText: 'Backup created' })).toBeVisible();
		beforeDelete = (await list()).backups.find((b) => b.name.endsWith('_manual.db'))!.name;

		// Delete the icon (confirmed although in use) and the dashboard that used it.
		const icons = await (await page.request.get('/api/icons')).json();
		const icon = icons.find((i: { imageUrl?: string }) => i.imageUrl === iconUrl);
		expect(icon, 'the uploaded icon is listed').toBeTruthy();
		const del = await page.request.delete(`/api/icons/${icon.id}?force=1`, { headers: await csrf() });
		expect(del.status(), await del.text()).toBe(200);
		const d = (await dashboard())!;
		const dd = await page.request.delete(`/api/dashboards/${d.id}?revision=${d.revision}`, { headers: await csrf() });
		expect(dd.status(), await dd.text()).toBe(200);

		// Moved to the attic, not destroyed: that save's backup cleanup swept the attic and kept it,
		// because the backup from before the delete still refers to it.
		expect(fs.existsSync(liveFile())).toBe(false);
		expect(fs.existsSync(atticFile()), 'the deleted image is kept in the attic').toBe(true);
		expect((await page.request.get(iconUrl)).status()).toBe(404);
		await openBackups();
		await expect(backupsDialog().getByTestId('backup-attic')).toContainText('Deleted images kept for older backups: 1 file');

		await restoreViaUI(beforeDelete);
		expect(await dashboard(), 'the restored data is live').toBeTruthy();
		expect(fs.existsSync(liveFile()), 'the image came back from the attic').toBe(true);
		await expectTileImageShows();
	});

	test('a backup downloads as a .zip holding the image and a manifest', async () => {
		await openBackups();
		const download = page.waitForEvent('download');
		await backupsDialog().getByRole('link', { name: `Download ${beforeDelete}` }).click();
		const dl = await download;
		expect(dl.suggestedFilename()).toBe(beforeDelete.replace(/\.db$/, '.zip'));
		archivePath = path.join(workDir, dl.suggestedFilename());
		await dl.saveAs(archivePath);
		const names = zipNames(archivePath);
		expect(names.sort()).toEqual(['hops.db', 'icons/' + iconFile, 'manifest.json'].sort());
		const man = JSON.parse(py('import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', archivePath));
		expect(man.format).toBe('hops-backup-archive');
		expect(man.hopsVersion).toBeTruthy();
		expect(man.missing).toEqual([]);
		expect(man.files.map((f: { path: string }) => f.path).sort()).toEqual(['hops.db', 'icons/' + iconFile].sort());
		// Nothing missing: no warning in the dialog.
		await expect(backupsDialog().locator('.action-warning')).toHaveCount(0);
	});

	test('an uploaded archive, restored, brings its images back', async () => {
		// Make HOPS forget the image entirely: delete the icon and dashboard again, then every
		// backup, so the attic sweep removes it (nothing refers to it any more).
		const icons = await (await page.request.get('/api/icons')).json();
		const icon = icons.find((i: { imageUrl?: string }) => i.imageUrl === iconUrl);
		expect((await page.request.delete(`/api/icons/${icon.id}?force=1`, { headers: await csrf() })).status()).toBe(200);
		const d = (await dashboard())!;
		expect((await page.request.delete(`/api/dashboards/${d.id}?revision=${d.revision}`, { headers: await csrf() })).status()).toBe(200);
		for (const b of (await list()).backups) {
			const r = await page.request.delete(`/api/backups/${encodeURIComponent(b.name)}`, { headers: await csrf() });
			expect(r.status(), await r.text()).toBe(200);
		}
		expect(fs.existsSync(atticFile()), 'swept once no backup refers to it').toBe(false);
		expect(fs.existsSync(liveFile())).toBe(false);

		// Upload the archive through the dialog.
		await openBackups(false);
		await backupsDialog().getByLabel('Backup file to upload').setInputFiles(archivePath);
		await expect(page.locator('.toast', { hasText: /Uploaded as hops-backup-.*_uploaded\.db/ })).toBeVisible();
		await expect(backupsDialog().locator('.action-warning')).toHaveCount(0);
		const uploaded = (await list()).backups.find((b) => b.name.endsWith('_uploaded.db'))!.name;
		expect(fs.existsSync(liveFile()), 'not installed until it is restored').toBe(false);

		await restoreViaUI(uploaded);
		expect(await dashboard()).toBeTruthy();
		// Installed from the archive (as an icon upload would store it: decoded and re-encoded).
		expect(fs.existsSync(liveFile()), 'the image came from the archive').toBe(true);
		await expectTileImageShows();
	});

	test('a tampered archive is refused with a message; a legacy .db shows its warning', async () => {
		// One byte of the image changed after the manifest was written.
		const tampered = path.join(workDir, 'tampered.zip');
		py(`
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for n in zin.namelist():
        b = zin.read(n)
        if n.startswith("icons/"):
            b = b[:-1] + bytes([b[-1] ^ 0xFF])
        zout.writestr(n, b)
`, archivePath, tampered);
		const before = (await list()).backups.length;
		await openBackups();
		await backupsDialog().getByLabel('Backup file to upload').setInputFiles(tampered);
		const err = backupsDialog().locator('.action-error');
		await expect(err).toContainText("Couldn't upload the backup: This file can't be used as a backup:");
		await expect(err).toContainText("doesn't match its SHA-256 in the manifest");
		await expect(err).toContainText('Nothing was stored');
		expect((await list()).backups.length).toBe(before);

		// A path that leaves its folder.
		const escape = path.join(workDir, 'escape.zip');
		py(`
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for n in zin.namelist():
        zout.writestr(n, zin.read(n))
    zout.writestr("../../evil.png", b"x")
`, archivePath, escape);
		await backupsDialog().getByLabel('Backup file to upload').setInputFiles(escape);
		await expect(err).toContainText('leaves its folder');
		expect((await list()).backups.length).toBe(before);

		// A legacy plain database: accepted, with the warning on screen.
		const legacy = path.join(workDir, 'legacy.db');
		py('import sys,zipfile; open(sys.argv[2],"wb").write(zipfile.ZipFile(sys.argv[1]).read("hops.db"))', archivePath, legacy);
		await backupsDialog().getByLabel('Backup file to upload').setInputFiles(legacy);
		await expect(backupsDialog().locator('.action-warning')).toContainText('This backup has no images; missing images will show as broken');
		expect((await list()).backups.length).toBe(before + 1);
	});

	test('a restore gives back the exact version of an image the backup used', async () => {
		// The review's scenario: B1 uses verx.png = A; it is deleted, a different verx.png (C) arrives
		// and is deleted too; restoring B1 must give A, never C.
		const A = PNG;
		const C = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
		expect(A.equals(C)).toBe(false);
		const url = '/backgrounds/verx.png';
		const file = path.join(dataDir, 'backgrounds', 'verx.png');
		const importWith = async (id: string, bytes: Buffer) => {
			const dash = {
				id: `${id}-dash`, name: `Version ${id}`, order: 0, path: `/${id}`, revision: 1,
				settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
				tabs: [{ id: `${id}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
					{ id: `${id}-t1`, kind: 'tile', type: 'link', name: 'Versioned', url: 'https://versioned.example.lan/', iconUrl: url,
						openMode: 'newtab', size: 'small', order: 0, placement: { x: 0, y: 0, w: 1, h: 1 } }
				] } }]
			};
			const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
				config: { layoutVersion: 2, dashboards: [dash], assets: { [url]: { contentType: 'image/png', data: bytes.toString('base64') } } } };
			const r = await page.request.post('/api/config/import', {
				headers: await csrf(),
				multipart: { file: { name: `${id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
			});
			expect(r.status(), await r.text()).toBe(200);
			expect(fs.readFileSync(file).equals(bytes), 'the import wrote the image').toBe(true);
		};
		await importWith('vera', A);
		const b1 = await page.request.post('/api/backups', { headers: await csrf(), data: { reason: 'manual' } });
		expect(b1.status(), await b1.text()).toBe(200);
		const b1Name = path.basename((await b1.json()).path);
		const delBg = async () => {
			const r = await page.request.delete('/api/backgrounds/verx', { headers: await csrf() });
			expect(r.status(), await r.text()).toBe(200);
			expect(fs.existsSync(file)).toBe(false);
		};
		await delBg();
		await importWith('verc', C);
		await delBg();

		await restoreViaUI(b1Name);
		expect(fs.readFileSync(file).equals(A), 'the restored image is version A').toBe(true);
		const served = await page.request.get(url);
		expect(served.status()).toBe(200);
		expect(Buffer.from(await served.body()).equals(A)).toBe(true);
	});

	test('unknown images after a lost attic index: kept, explained, and cleared only after a confirmed preview', async () => {
		test.setTimeout(60_000);
		// A dashboard uses an image that isn't in place, so HOPS can't clear unknowns by itself.
		const dash = {
			id: 'unk-dash', name: 'Unknown e2e', order: 0, path: '/unk', revision: 1,
			settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
			tabs: [{ id: 'unk-tab', name: 'Main', order: 0, root: { columns: 24, children: [
				{ id: 'unk-t1', kind: 'tile', type: 'link', name: 'Gone', url: 'https://gone.example.lan/', iconUrl: '/icons/never-there.png',
					openMode: 'newtab', size: 'small', order: 0, placement: { x: 0, y: 0, w: 1, h: 1 } }
			] } }]
		};
		const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
		const imp = await page.request.post('/api/config/import', { headers: await csrf(), multipart: { file: { name: 'unk.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } } });
		expect(imp.status(), await imp.text()).toBe(200);
		// An attic version nothing names, and a lost index.
		const bytes = Buffer.from('synthetic unknown image');
		const sha = createHash('sha256').update(bytes).digest('hex');
		const file = path.join(dataDir, 'attic', 'icons', sha);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, bytes);
		fs.rmSync(path.join(dataDir, 'attic', 'index.json'), { force: true });

		await openBackups();
		await backupsDialog().getByRole('button', { name: 'Create Backup' }).click(); // its cleanup rebuilds the index
		await expect(page.locator('.toast', { hasText: 'Backup created' })).toBeVisible();
		expect(fs.existsSync(file), 'kept while a dashboard image is missing').toBe(true);
		const notice = backupsDialog().locator('.problem', { hasText: 'rebuilt it from the backups' });
		await expect(notice).toBeVisible();
		await expect(notice).toContainText('Clean up unknown images');
		await expect(notice).not.toContainText(sha);

		await backupsDialog().getByRole('button', { name: 'Clean up unknown images' }).click();
		const preview = backupsDialog().getByRole('region', { name: 'Unknown images preview' });
		await expect(preview).toContainText('An icon');
		await expect(preview).toContainText('icons/never-there.png');
		expect(fs.existsSync(file), 'nothing deleted by the preview').toBe(true);
		await preview.getByRole('button', { name: /^Delete (it|these \d+)$/ }).click();
		await expect(page.locator('.toast', { hasText: /Cleaned up \d+ unknown images?/ })).toBeVisible();
		expect(fs.existsSync(file)).toBe(false);
	});
});
