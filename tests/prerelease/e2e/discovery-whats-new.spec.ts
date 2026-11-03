import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { hopsCommand } from '../hops-bin';
import { expectFilterToggleLook } from '../helpers';
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

/** Run SQL against the spawned HOPS's database (a scan "progressing" while the page is open). */
function sql(stmts: string) {
	execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript(sys.argv[2])
c.commit()
`, path.join(dataDir, 'hops.db'), stmts]);
}
function rowSQL(sid: string, n: number, host: string, port: number, det: string, name: string, at: string) {
	return `INSERT INTO scan_results(id, scan_id, host, port, detector_id, confidence, suggested_name, suggested_url, curate_state, created_at) VALUES('${sid}-${n}','${sid}','${host}',${port},'${det}','high','${name}','http://${host}:${port}','pending','${at}');`;
}

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
# A range for the "scan finishes while the page is open" paths: the baseline, then a running scan.
scan('lbase', '203.0.113.0/24', '2026-10-12T10:00:00Z', 'complete')
res('lbase', 1, '203.0.113.1', 443, 'x/deco', 'Deco')
res('lbase', 2, '203.0.113.2', 443, 'x/deco', 'Deco')
res('lbase', 3, '203.0.113.3', 13378, 'x/abs', 'Audiobookshelf')
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
		child = spawn(...hopsCommand(dataDir), { stdio: 'ignore' });
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
		await signIn.getByLabel('Password', { exact: true }).fill(ADMIN_INITIAL_PASSWORD);
		await signIn.getByLabel('Password', { exact: true }).press('Enter');
		await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible({ timeout: 10_000 });
		await page.fill('input#current-password', ADMIN_INITIAL_PASSWORD);
		await page.fill('input#new-password', ADMIN_TEST_PASSWORD);
		await page.fill('input#confirm-password', ADMIN_TEST_PASSWORD);
		await page.click('button:has-text("Set password")');
		await expect(page.getByRole('heading', { name: 'Set a new password' })).toHaveCount(0, { timeout: 15_000 });
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
		// Default filter: New or changed = rows (3 new + 1 changed), the unchanged one is hidden.
		const rows = page.locator('table.results tbody tr');
		await expect(rows).toHaveCount(4);
		await expect(page.getByText('192.0.2.1', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^All/ })).toContainText('(5)');

		// The filters look like buttons: the chosen one filled, the others outlined (item 13).
		const filters = page.getByRole('group', { name: 'Show' });
		await expect(filters.getByRole('button', { name: /^New or changed/ })).toHaveAttribute('aria-pressed', 'true');
		await expectFilterToggleLook(page, filters);

		await page.getByRole('button', { name: /^All/ }).click();
		await expect(filters.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
		await expect(filters.getByRole('button', { name: /^New or changed/ })).toHaveAttribute('aria-pressed', 'false');
		await expect(rows).toHaveCount(5);
		await expect(page.getByTestId('diff-state').filter({ hasText: 'unchanged' })).toHaveCount(1);

		await page.getByRole('button', { name: /^Gone/ }).click();
		const gone = page.getByTestId('gone-table');
		await expect(gone.locator('tbody tr')).toHaveCount(2);
		// The promoted one is clearly marked: its tile may be dead.
		await expect(gone.locator('tr', { hasText: '192.0.2.3' })).toContainText('promoted — tile may be dead');
		await expect(gone.locator('tr', { hasText: '192.0.2.4' })).not.toContainText('tile may be dead');
	});

	test('with the New filter only the rows you can see are counted, and hidden ticks are called out', async () => {
		await page.goto('/settings/discovery/rescan');
		// 4 rows shown (all ticked, high confidence); the 5th is unchanged since the last scan, so it is
		// hidden and not ticked by default — it was on offer last time too.
		await expect(page.locator('table.results tbody tr')).toHaveCount(4);
		await expect(page.getByText('4 selected', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Promote 4 to dashboard' })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
		await page.getByRole('button', { name: 'All (5)' }).click();
		await expect(page.locator('table.results tbody tr')).toHaveCount(5);
		await expect(page.getByText('4 selected', { exact: true })).toBeVisible();
		// Ticking it yourself, then filtering back, is called out.
		await page.locator('table.results tbody tr:not(.selected) input[type="checkbox"]').check();
		await expect(page.getByText('5 selected', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: /^New or changed/ }).click();
		await expect(page.getByText('4 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toContainText("1 ticked result isn't shown by this filter and won't be added.");
		await page.getByTestId('hidden-ticked').getByRole('button', { name: 'Show all' }).click();
		await expect(page.locator('table.results tbody tr')).toHaveCount(5);
		await expect(page.getByText('5 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
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

	// Item 14: unchanged rows must not be ticked by default on any way into the page, not just
	// when opening a scan that has already finished.
	test('a scan that finishes while the page is open: unchanged rows are not left ticked', async () => {
		sql(`INSERT INTO scans(id, created_at, cidr, intensity, state) VALUES('live','2026-10-20T10:00:00Z','203.0.113.0/24','light','running');
			${rowSQL('live', 1, '203.0.113.1', 443, 'x/deco', 'Deco', '2026-10-20T10:00:01Z')}`);
		await page.goto('/settings/discovery/live');
		await expect(page.getByText(/Scanning 203\.0\.113\.0\/24/)).toBeVisible();
		await expect(page.locator('table.results tbody tr')).toHaveCount(1);
		sql(`${rowSQL('live', 2, '203.0.113.2', 443, 'x/deco', 'Deco', '2026-10-20T10:00:02Z')}
			${rowSQL('live', 3, '203.0.113.3', 13378, 'x/abs', 'Audiobookshelf', '2026-10-20T10:00:03Z')}
			${rowSQL('live', 4, '203.0.113.9', 3000, 'x/gitea', 'Gitea', '2026-10-20T10:00:04Z')}`);
		await expect(page.locator('table.results tbody tr')).toHaveCount(4);
		sql(`UPDATE scans SET state='complete', finished_at='2026-10-20T10:05:00Z' WHERE id='live';`);
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 0 gone');
		await expect(page.locator('table.results tbody tr')).toHaveCount(1);
		await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
		await page.getByRole('button', { name: /^All/ }).click();
		await expect(page.locator('table.results tbody tr.selected')).toHaveCount(1);
	});

	test('going back to the list and returning: unchanged rows are still not ticked', async () => {
		await page.goto('/settings/discovery/live');
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 0 gone');
		await page.locator('a.back-link').click();
		await expect(page).toHaveURL(/\/settings\/discovery$/);
		await page.locator('table.scans tbody tr').filter({ hasText: '203.0.113.0/24' }).first().getByRole('button', { name: 'Open scan draft' }).click();
		await expect(page).toHaveURL(/\/settings\/discovery\/live$/);
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 0 gone');
		await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
		await page.goBack();
		await page.goForward();
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 0 gone');
		await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
	});

	test('Re-scan from an earlier scan: the new scan runs and finishes on the same page, unchanged rows not ticked', async () => {
		sql(`INSERT INTO scans(id, created_at, cidr, intensity, state) VALUES('live2','2026-10-25T10:00:00Z','203.0.113.0/24','light','running');`);
		// Re-scan really starts a scan; here it hands back the seeded one, which then "runs".
		await page.route('**/api/discovery/scans', async (r) => {
			if (r.request().method() !== 'POST') return r.fallback();
			await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'live2', createdAt: '2026-10-25T10:00:00Z', cidr: '203.0.113.0/24', intensity: 'light', state: 'running', progressDone: 0, progressTotal: 256 }) });
		});
		await page.goto('/settings/discovery/live');
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 0 gone');
		await page.getByRole('button', { name: 'Re-scan', exact: true }).click();
		await expect(page).toHaveURL(/\/settings\/discovery\/live2$/);
		await expect(page.getByText(/Scanning 203\.0\.113\.0\/24/)).toBeVisible();
		sql(`${rowSQL('live2', 1, '203.0.113.1', 443, 'x/deco', 'Deco', '2026-10-25T10:00:01Z')}
			${rowSQL('live2', 2, '203.0.113.9', 3000, 'x/gitea', 'Gitea', '2026-10-25T10:00:02Z')}`);
		await expect(page.locator('table.results tbody tr')).toHaveCount(2);
		sql(`${rowSQL('live2', 3, '203.0.113.20', 8080, 'x/new', 'Brand new', '2026-10-25T10:00:03Z')}
			UPDATE scans SET state='complete', finished_at='2026-10-25T10:05:00Z' WHERE id='live2';`);
		await expect(page.getByTestId('diff-summary')).toContainText('1 new, 2 gone');
		await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
		await expect(page.getByTestId('hidden-ticked')).toHaveCount(0);
		await page.unroute('**/api/discovery/scans');
	});

	test('rows written in the same second as the last one seen still appear while the scan runs', async () => {
		const at = '2026-10-28T10:00:01Z';
		sql(`INSERT INTO scans(id, created_at, cidr, intensity, state) VALUES('live3','2026-10-28T10:00:00Z','203.0.113.0/24','light','running');
			${rowSQL('live3', 1, '203.0.113.1', 443, 'x/deco', 'Deco', at)}`);
		await page.goto('/settings/discovery/live3');
		await expect(page.locator('table.results tbody tr')).toHaveCount(1);
		// Two more rows in that same second, after the page has seen the first.
		sql(`${rowSQL('live3', 2, '203.0.113.30', 8080, 'x/a', 'Alpha', at)}
			${rowSQL('live3', 3, '203.0.113.31', 8081, 'x/b', 'Beta', at)}`);
		await expect(page.locator('table.results tbody tr')).toHaveCount(3);
		sql(`UPDATE scans SET state='complete' WHERE id='live3';`);
		await expect(page.getByRole('button', { name: /^All/ })).toHaveText('All (3)');
	});
});
