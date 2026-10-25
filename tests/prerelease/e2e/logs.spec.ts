import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { setSetting } from '../helpers';

// Settings › Logs, in a REAL browser and server: the recent log lines, honest about what's missing
// (the start of the buffer, dropped lines, levels never recorded, the filter), a failed fetch is a
// visible error, and Download gives a file. The dropped notice uses a mocked answer: the buffer's
// capacity is a constant (2000), not a setting, and the Go tests cover the real wrap.

const side = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
const logList = (page: Page) => page.getByRole('log');

async function openLogs(page: Page) {
	await page.goto('/settings/logs');
	await expect(page.getByRole('heading', { name: 'Logs', level: 2, exact: true })).toBeVisible();
}

test.describe('Settings › Logs', () => {
	let levelBefore = '';
	test.afterEach(async ({ page }) => {
		if (levelBefore) await setSetting(page, 'log.level', levelBefore);
		levelBefore = '';
	});

	test('the sidebar has Logs after Backups, and it opens the page', async ({ page }) => {
		await page.goto('/settings/dashboards');
		await expect(side(page).getByRole('link', { name: 'Logs', exact: true })).toBeVisible();
		const links = side(page).locator('a.side-item');
		const labels = (await links.allTextContents()).map((t) => t.trim());
		expect(labels.indexOf('Logs')).toBe(labels.indexOf('Backups') + 1);
		await side(page).getByRole('link', { name: 'Logs', exact: true }).click();
		await expect(page).toHaveURL(/\/settings\/logs$/);
		await expect(side(page).getByRole('link', { name: 'Logs', exact: true })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { name: 'Logs', level: 2, exact: true })).toBeVisible();
	});

	test('lists real lines after an action, newest last, with the since line', async ({ page }) => {
		// An action that logs: changing a setting logs "setting updated" with its key.
		const before = await setSetting(page, 'discovery.max_parallel_probes', '63');
		await setSetting(page, 'discovery.max_parallel_probes', before);
		await openLogs(page);
		await expect(page.getByText(/^Showing lines since HOPS started at \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.$/)).toBeVisible();
		const line = logList(page).locator('li', { hasText: 'setting updated' }).filter({ hasText: 'key=discovery.max_parallel_probes' });
		await expect(line.first()).toBeVisible();
		await expect(line.first()).toHaveClass(/lvl-info/);
		// The newest line is at the bottom: the request for this page is logged after the setting change.
		const texts = await logList(page).locator('li').allTextContents();
		const lastSetting = texts.map((t) => t.includes('setting updated')).lastIndexOf(true);
		expect(lastSetting).toBeGreaterThanOrEqual(0);
		expect(texts.slice(lastSetting + 1).some((t) => t.includes('path=/api/settings'))).toBe(true);
	});

	test('the level filter hides lower levels and says so; the configured level is explained with a link', async ({ page }) => {
		await openLogs(page);
		await expect(logList(page).locator('li.lvl-info').first()).toBeVisible();
		await page.getByLabel('Level').selectOption('warn');
		await expect(logList(page).locator('li.lvl-info')).toHaveCount(0);
		await expect(page.getByText(/the level filter( \(Warn and above\))? hides \d+ (lower-level )?lines?/i)).toBeVisible();
		await page.getByLabel('Level').selectOption('debug');
		await expect(logList(page).locator('li.lvl-info').first()).toBeVisible();

		// Log level Warn: info/debug aren't recorded, and the page says where to change it.
		levelBefore = await setSetting(page, 'log.level', 'warn');
		await page.getByRole('button', { name: 'Refresh' }).click();
		const notice = page.locator('.notice', { hasText: "Log level is Warn, so info/debug lines aren't recorded" });
		await expect(notice).toBeVisible();
		await notice.getByRole('link', { name: 'Global settings › Server' }).click();
		await expect(page).toHaveURL(/\/settings\/global#server$/);
	});

	test('dropped lines are announced', async ({ page }) => {
		await page.route((u) => u.pathname === '/api/logs', async (route) => {
			const resp = await route.fetch();
			const body = await resp.json();
			await route.fulfill({ response: resp, json: { ...body, dropped: 150 } });
		});
		await openLogs(page);
		await expect(page.getByText('150 older lines were dropped to stay within the last 2000.')).toBeVisible();
	});

	test('a failed fetch is a visible error, not an empty list', async ({ page }) => {
		await page.route((u) => u.pathname === '/api/logs', (route) => route.fulfill({ status: 500, json: { error: 'logs exploded' } }));
		await openLogs(page);
		await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the log lines: logs exploded" })).toBeVisible();
		await expect(logList(page)).toHaveCount(0);
		await expect(page.getByText(/No log lines recorded yet/)).toHaveCount(0);
	});

	test('Download gives a .txt file with the header and the lines', async ({ page }) => {
		await openLogs(page);
		await expect(logList(page).locator('li').first()).toBeVisible();
		const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download/ }).click()]);
		expect(dl.suggestedFilename()).toMatch(/^hops-log-\d{8}-\d{6}\.txt$/);
		const file = await dl.path();
		const text = fs.readFileSync(file!, 'utf8');
		expect(text).toMatch(/^# HOPS log — Showing lines since HOPS started at /);
		expect(text).toMatch(/\n\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} (INFO |WARN |ERROR|DEBUG) /);
	});
	test('a level change while a slow fetch is in flight is not dropped: the list ends up at the new level', async ({ page }) => {
		let delayNext = false;
		const asked: string[] = [];
		await page.route((u) => u.pathname === '/api/logs', async (route) => {
			asked.push(new URL(route.request().url()).searchParams.get('level') ?? '');
			if (delayNext) {
				delayNext = false;
				await new Promise((r) => setTimeout(r, 1500));
			}
			await route.continue();
		});
		await openLogs(page);
		await expect(logList(page).locator('li.lvl-info').first()).toBeVisible();
		delayNext = true;
		await page.getByRole('button', { name: 'Refresh' }).click(); // the slow fetch (level debug)
		await page.getByLabel('Level').selectOption('warn');
		await expect(page.getByRole('status').filter({ hasText: 'Updating to match the filter' })).toBeVisible();
		await expect(page.getByText('Updating to match the filter')).toHaveCount(0, { timeout: 10_000 });
		await expect(logList(page).locator('li.lvl-info')).toHaveCount(0);
		await expect(page.getByLabel('Level')).toHaveValue('warn');
		expect(asked[asked.length - 1]).toBe('warn');
	});
});
