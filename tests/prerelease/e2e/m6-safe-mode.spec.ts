import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fix round 3: when an interrupted restore leaves files HOPS can't resolve with certainty, it
// does NOT open (create) a database: it serves a self-contained help page on its last port,
// every route 503, and stays up. Synthetic files only.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = String(Number(process.env.HOPS_TEST_PORT || '18080') + 10);
const BASE = `http://localhost:${PORT}`;

test('a refused start serves the help page (503) and never creates a database', async ({ browser }) => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hops-safemode-'));
	let child: ChildProcess | null = null;
	try {
		fs.writeFileSync(path.join(dataDir, '.last-port'), `${PORT}\n`);
		// A file moved aside by a restore, with no journal: ambiguous.
		fs.writeFileSync(path.join(dataDir, 'hops.db.pre-apply'), 'the original database (synthetic)');
		child = spawn(path.join(REPO, 'backend/hops'), ['--data', dataDir, '--host', '127.0.0.1'], { stdio: 'ignore' });
		const deadline = Date.now() + 20_000;
		for (;;) {
			try {
				const r = await fetch(`${BASE}/api/health`);
				expect(r.status).toBe(503);
				const h = await r.json();
				expect(h.status).toBe('unsafe-to-start');
				expect(h.reason).toContain('Nothing was deleted');
				break;
			} catch (e) {
				if (Date.now() > deadline) throw e;
				await new Promise((res) => setTimeout(res, 200));
			}
		}
		const ctx = await browser.newContext({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });
		const page = await ctx.newPage();
		const resp = await page.goto(`${BASE}/settings/backups`);
		expect(resp?.status()).toBe(503);
		await expect(page.getByRole('heading', { name: "HOPS can't start safely" })).toBeVisible();
		await expect(page.getByText('Nothing was deleted.')).toBeVisible();
		await expect(page.locator('code', { hasText: path.join(dataDir, 'hops.db.pre-apply') })).toBeVisible();
		await expect(page.locator('ol li').last()).toHaveText('start HOPS again');
		await ctx.close();
		expect(fs.existsSync(path.join(dataDir, 'hops.db')), 'no database was created').toBe(false);
		expect(child.exitCode, 'still running (no restart loop)').toBeNull();
	} finally {
		if (child && child.exitCode === null) {
			const exited = new Promise((r) => child!.once('exit', r));
			child.kill('SIGTERM');
			await exited;
		}
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});
