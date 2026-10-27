import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCsrfToken, setSetting } from '../helpers';

// M6 §11 backup retention and the backups additions, in a REAL browser and server:
// - the retention setting works (Global settings › Server), the Backups dialog says what is kept,
//   and "Clean up now" previews what it would delete, with reasons, before deleting;
// - a backup downloads as a file;
// - a valid uploaded backup is listed (not restored); an invalid one shows a visible reason.
// Synthetic data only.

const backupsDialog = (page: Page) => page.locator('#backups');

async function openBackups(page: Page) {
	await page.goto('/settings/backups');
	await expect(backupsDialog(page).locator('.backup-item').first()).toBeVisible();
}

async function list(page: Page) {
	return (await (await page.request.get('/api/backups')).json()) as {
		backups: { name: string; protected: boolean }[];
		retention: { keepCount: number; keepDays: number; maxCount: number };
	};
}

/** n automatic backups, through real saves: each dashboard create and delete takes one. */
async function makeAutomaticBackups(page: Page, context: BrowserContext, n: number) {
	for (let i = 0; i < n; i += 2) {
		const csrf = await getCsrfToken(context);
		const p = `bk${Date.now().toString(36)}${i}`;
		const c = await page.request.post('/api/dashboards', { headers: { 'X-CSRF-Token': csrf }, data: { name: `Backups ${p}`, path: `/${p}` } });
		expect(c.status(), await c.text()).toBe(200);
		const { id, revision } = await c.json();
		const d = await page.request.delete(`/api/dashboards/${id}?revision=${revision}`, { headers: { 'X-CSRF-Token': csrf } });
		expect(d.status(), await d.text()).toBe(200);
	}
}

test.describe('M6 backups: retention, download, upload', () => {
	let keepBefore = '';

	test.afterEach(async ({ page }) => {
		if (keepBefore) await setSetting(page, 'backup.keep_count', keepBefore);
		keepBefore = '';
	});

	test('the keep setting works: the dialog says so, and Clean up now previews before deleting', async ({ page, context }) => {
		keepBefore = String((await list(page)).retention.keepCount);
		await makeAutomaticBackups(page, context, 8);

		// Set it in Global settings › Server, as the admin would.
		await page.goto('/settings/global');
		const input = page.getByLabel('Keep the newest backups', { exact: true });
		await expect(input).toBeVisible();
		await input.fill('3');
		const row = page.locator('.row').filter({ has: input });
		const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/settings/backup.keep_count'));
		await row.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await saved).status()).toBe(200);
		expect((await list(page)).retention.keepCount).toBe(3);

		await openBackups(page);
		const dlg = backupsDialog(page);
		await expect(dlg.getByTestId('backup-retention')).toContainText('Keeping the newest 3 automatic backups');
		await expect(dlg.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/settings/global#server');

		await dlg.getByRole('button', { name: /Clean up now/ }).click();
		const preview = dlg.getByRole('region', { name: 'Clean up preview' });
		await expect(preview).toContainText('would be deleted');
		await expect(preview).toContainText('not among the newest 3');
		const before = await list(page);
		const auto = before.backups.filter((b) => !b.protected);
		expect(auto.length).toBeGreaterThan(3);
		// Nothing is deleted by the preview.
		expect((await list(page)).backups.length).toBe(before.backups.length);
		await preview.getByRole('button', { name: /^Delete/ }).click();
		await expect(page.locator('.toast', { hasText: /Deleted \d+ backups?/ })).toBeVisible();
		const after = await list(page);
		expect(after.backups.filter((b) => !b.protected).length).toBe(3);
		// Protected ones (manual, uploaded, before an upgrade) are untouched and labelled.
		expect(after.backups.filter((b) => b.protected).length).toBe(before.backups.filter((b) => b.protected).length);
	});

	test('a backup downloads as one archive (.zip)', async ({ page }) => {
		await openBackups(page);
		const dlg = backupsDialog(page);
		const name = (await dlg.locator('.backup-item').first().getAttribute('data-backup-name'))!;
		const download = page.waitForEvent('download');
		await dlg.getByRole('link', { name: `Download ${name}` }).click();
		const d = await download;
		expect(d.suggestedFilename()).toBe(name.replace(/\.db$/, '.zip'));
		const file = await d.path();
		expect(fs.readFileSync(file).subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
	});

	test('a valid uploaded backup is listed; an invalid one shows why it was refused', async ({ page }) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-upload-'));
		try {
			await openBackups(page);
			const dlg = backupsDialog(page);
			// A valid one: a backup downloaded from this HOPS.
			const name = (await dlg.locator('.backup-item').first().getAttribute('data-backup-name'))!;
			const bytes = await (await page.request.get(`/api/backups/${encodeURIComponent(name)}`)).body();
			const good = path.join(dir, 'my-hops.zip');
			fs.writeFileSync(good, bytes);
			const n = (await list(page)).backups.length;
			await dlg.getByLabel('Backup file to upload').setInputFiles(good);
			await expect(page.locator('.toast', { hasText: /Uploaded as hops-backup-.*_uploaded\.db/ })).toBeVisible();
			const uploaded = dlg.locator('.backup-item[data-backup-name$="_uploaded.db"]').first();
			await expect(uploaded).toBeVisible();
			await expect(uploaded).toContainText('kept until you delete it');
			expect((await list(page)).backups.length).toBe(n + 1);

			// Not a database at all.
			const text = path.join(dir, 'notes.db');
			fs.writeFileSync(text, 'these are my notes, not a database');
			await dlg.getByLabel('Backup file to upload').setInputFiles(text);
			await expect(dlg.locator('.action-error')).toContainText("Couldn't upload the backup: This file can't be used as a backup: this file is not a HOPS backup archive (.zip) and not a SQLite database");
			// A SQLite database that isn't HOPS's.
			const other = path.join(dir, 'other.db');
			execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT)"); c.commit()', other]);
			await dlg.getByLabel('Backup file to upload').setInputFiles(other);
			await expect(dlg.locator('.action-error')).toContainText('this is not a HOPS database');
			expect((await list(page)).backups.length).toBe(n + 1);

			// Clean up after ourselves: the uploaded backup is protected, so delete it here.
			const up = (await list(page)).backups.find((b) => b.name.endsWith('_uploaded.db'))!;
			const del = await page.request.delete(`/api/backups/${encodeURIComponent(up.name)}`, { headers: { 'X-CSRF-Token': await getCsrfToken(page.context()) } });
			expect(del.status()).toBe(200);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
