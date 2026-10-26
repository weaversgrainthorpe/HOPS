import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, ADMIN_TEST_PASSWORD } from '../constants';

// Discovery re-scans show what is new / changed / gone since the previous completed scan of the
// same range. Own HOPS on its own data directory; the scans are seeded straight into its database
// (synthetic hosts only: 192.0.2.x / 198.51.100.x, documentation ranges).

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 11);
const BASE = `http://localhost:${PORT}`;
let child: ChildProcess | null = null;
let dataDir = '';

const SEED = `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
def scan(i, cidr, created, state):
    c.execute("INSERT INTO scans(id, created_at, cidr, intensity, state, finished_at) VALUES(?,?,?,?,?,?)", (i, created, cidr, 'light', state, created))
def res(sid, n, host, port, det, name, cur='pending'):
    c.execute("INSERT INTO scan_results(id, scan_id, host, port, detector_id, confidence, suggested_name, suggested_url, curate_state, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
              (sid + '-' + str(n), sid, host, port, det, 'high', name, 'http://' + host + ':' + str(port), cur, '2026-10-01T00:00:00Z'))
scan('old', '192.0.2.0/24', '2026-10-12T10:00:00Z', 'complete')
res('old', 1, '192.0.2.1', 80, 'x/web', 'Web')
res('old', 2, '192.0.2.2', 8080, 'x/grafana', 'Grafana')
res('old', 3, '192.0.2.3', 443, 'x/nas', 'NAS', 'promoted')
res('old', 4, '192.0.2.4', 9000, 'x/ctr', 'Containers')
scan('rescan', '192.0.2.0/24', '2026-10-20T10:00:00Z', 'complete')
res('rescan', 1, '192.0.2.1', 80, 'x/web', 'Web')
res('rescan', 2, '192.0.2.2', 8080, 'x/other', 'Other')
res('rescan', 3, '192.0.2.9', 3000, 'x/gitea', 'Gitea')
res('rescan', 4, '192.0.2.10', 3001, 'x/wiki', 'Wiki')
res('rescan', 5, '192.0.2.11', 3002, 'x/dns', 'DNS')
scan('lonely', '198.51.100.0/24', '2026-10-15T10:00:00Z', 'complete')
res('lonely', 1, '198.51.100.1', 80, 'x/web', 'Web')
c.commit()
`;

test.describe.configure({ mode: 'serial' });

test.describe('Discovery re-scans: what is new', () => {
	let ctx: BrowserContext;
	let page: Page;

	test.beforeAll(async ({ browser }) => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-discnew-'));
		execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
c.execute("INSERT OR REPLACE INTO app_settings(key, value) VALUES('server.port', ?)", (sys.argv[2],))
c.commit()
`, path.join(dataDir, 'hops.db'), PORT]);
		child = spawn(path.join(REPO, 'backend/hops-testdev'), ['--data', dataDir, '--frontend', path.join(REPO, 'frontend/build'), '--host', '127.0.0.1'], { stdio: 'ignore' });
		const deadline = Date.now() + 20_000;
		for (;;) {
			try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ }
			if (Date.now() > deadline) throw new Error('the discovery-new HOPS did not start');
			await new Promise((r) => setTimeout(r, 200));
		}
		execFileSync('python3', ['-c', SEED, path.join(dataDir, 'hops.db')]);

		ctx = await browser.newContext({ baseURL: BASE, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
		page = await ctx.newPage();
		await page.goto('/settings/discovery');
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
		if (child?.pid) process.kill(child.pid, 'SIGTERM');
		child = null;
		if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
	});

	test('a re-scan opens on New, with counts and the scan used; All and Gone switch the view', async () => {
		await page.goto('/settings/discovery/rescan');
		await expect(page.getByTestId('diff-summary')).toContainText('3 new, 2 gone, 1 changed');
		await expect(page.getByTestId('diff-summary')).toContainText('since the');
		// Default filter: New only = new + changed rows (3 new + 1 changed), the unchanged one is hidden.
		const rows = page.locator('table.results tbody tr');
		await expect(rows).toHaveCount(4);
		await expect(page.getByText('192.0.2.1', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^All/ })).toContainText('(5)');

		await page.getByRole('button', { name: /^All/ }).click();
		await expect(rows).toHaveCount(5);
		await expect(page.getByTestId('diff-state').filter({ hasText: 'unchanged' })).toHaveCount(1);

		await page.getByRole('button', { name: /^Gone/ }).click();
		const gone = page.getByTestId('gone-table');
		await expect(gone.locator('tbody tr')).toHaveCount(2);
		// The promoted one is clearly marked: its tile may be dead.
		await expect(gone.locator('tr', { hasText: '192.0.2.3' })).toContainText('promoted — tile may be dead');
		await expect(gone.locator('tr', { hasText: '192.0.2.4' })).not.toContainText('tile may be dead');
	});

	test('the scans list shows +N / −M for the re-scan and nothing for the first scan', async () => {
		await page.goto('/settings/discovery');
		const newRow = page.locator('table.scans tbody tr').filter({ hasText: '192.0.2.0/24' }).first();
		await expect(newRow.locator('td.since')).toContainText('+3');
		await expect(newRow.locator('td.since')).toContainText('−2');
	});

	test('a first scan of a range says there is nothing to compare', async () => {
		await page.goto('/settings/discovery/lonely');
		await expect(page.getByTestId('diff-summary')).toHaveText(/First scan of this range — nothing to compare/);
		await expect(page.locator('table.results tbody tr')).toHaveCount(1);
	});

	test('a comparison that cannot load is a visible error, not "nothing new"', async () => {
		await page.route('**/api/discovery/scans/rescan/diff', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Failed to compare with the previous scan"}' }));
		await page.goto('/settings/discovery/rescan');
		await expect(page.getByTestId('diff-error')).toContainText('Could not compare with the previous scan');
		await expect(page.getByTestId('nothing-new')).toHaveCount(0);
		await expect(page.locator('table.results tbody tr')).toHaveCount(5);
	});
});
