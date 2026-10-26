import { test, expect, type Page, type Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCsrfToken, deleteDashboardsNamed } from '../helpers';

// Settings › Icons › Packaged icons, in a REAL browser and server: one search across the icons
// that ship with HOPS, the source filter, offline drawing (the Iconify API is blocked), online-only
// previews fetched after a pause in one batch (mocked API) or "unavailable" when blocked, the
// built-in categories read-only, "where used" for a packaged icon, no edit or delete, and the
// "Offline and limits" note stating the real shipped counts.

const ICONIFY_HOSTS = /(api\.)?(iconify\.design|simplesvg\.com|unisvg\.com)/;

interface IconifyRequest { host: string; prefix: string; names: string[] }

function parseIconifyRequest(url: string): IconifyRequest {
	const u = new URL(url);
	return {
		host: u.host,
		prefix: u.pathname.replace(/^\//, '').replace(/\.json$/, ''),
		names: (u.searchParams.get('icons') || '').split(',').filter(Boolean)
	};
}

function svgResponse(r: IconifyRequest) {
	return {
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			prefix: r.prefix, width: 24, height: 24,
			icons: Object.fromEntries(r.names.map((n) => [n, { body: '<path d="M2 2h20v20H2z" fill="currentColor"/>' }]))
		})
	};
}

/** The offline bundle's real counts, read from the generated file the app registers. */
function bundleCounts(): { mdi: number; si: number } {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const src = fs.readFileSync(path.join(here, '../../../frontend/src/lib/icons/offline-bundle.ts'), 'utf8');
	const m = src.match(/const collections = (\[.*?\]);\n/s);
	if (!m) throw new Error('offline bundle not readable');
	const cols = JSON.parse(m[1]) as { prefix: string; icons: Record<string, unknown> }[];
	const n = (p: string) => Object.keys(cols.find((c) => c.prefix === p)?.icons ?? {}).length;
	return { mdi: n('mdi'), si: n('simple-icons') };
}

const fmt = (n: number) => n.toLocaleString('en-GB');
const results = (page: Page) => page.getByRole('list', { name: 'Packaged icons' });
const cardOf = (page: Page, key: string) => results(page).locator(`[data-key="${key}"]`);
const search = (page: Page) => page.getByLabel('Search packaged icons');

async function openIcons(page: Page) {
	await page.goto('/settings/icons');
	await expect(page.getByRole('heading', { name: 'Packaged icons', level: 3 })).toBeVisible();
	await expect(results(page)).toBeVisible();
}

test.describe('Settings › Icons › Packaged icons', () => {
	const madeDashes: string[] = [];

	test.beforeEach(async ({ page }) => {
		// No test may reach the internet: Iconify is refused unless a test routes it itself.
		await page.route(ICONIFY_HOSTS, (route) => route.abort());
	});

	test.afterEach(async ({ page }) => {
		if (madeDashes.length) await deleteDashboardsNamed(page, madeDashes.splice(0));
	});

	test('searching "plex" finds the Dashboard Icons logo first, drawn offline', async ({ page }) => {
		await openIcons(page);
		await search(page).fill('plex');
		const first = results(page).getByRole('listitem').first();
		await expect(first).toHaveAttribute('data-key', 'dashboard:plex');
		await expect(first).toContainText('Dashboard Icons');
		await expect(first).toContainText('Offline');
		const img = first.locator('img');
		await expect(img).toHaveAttribute('src', '/api/icons/dashboard/plex.svg');
		await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
		// An offline Material Design icon draws too, with the API blocked.
		await search(page).fill('mdi:server');
		const srv = cardOf(page, 'mdi:server');
		await expect(srv).toContainText('Offline');
		await expect(srv.locator('[data-preview="ready"] svg')).toBeVisible();
	});

	test('the source filter narrows the results to one set', async ({ page }) => {
		await openIcons(page);
		await search(page).fill('plex');
		await expect(results(page).locator('[data-source="dashboard"]').first()).toBeVisible();
		for (const [label, src] of [['Simple Icons', 'simple-icons'], ['Dashboard Icons', 'dashboard'], ['Material Design', 'mdi']] as const) {
			await page.getByLabel('Source', { exact: true }).selectOption({ label });
			const cards = results(page).getByRole('listitem');
			await expect(cards.first()).toHaveAttribute('data-source', src);
			const sources = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-source')));
			expect(new Set(sources)).toEqual(new Set([src]));
		}
		await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Preset library' });
		await search(page).fill('zz-nothing-zz');
		await expect(page.getByText('No packaged icons match "zz-nothing-zz" in Preset library.')).toBeVisible();
	});

	test('results come one page at a time', async ({ page }) => {
		await openIcons(page);
		await expect(page.getByText(/^Showing 1–48 of [\d,]+/)).toBeVisible();
		await expect(results(page).getByRole('listitem')).toHaveCount(48);
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText(/^Showing 49–96 of [\d,]+/)).toBeVisible();
		await expect(results(page).getByRole('listitem')).toHaveCount(48);
	});

	test('an online-only name previews after a pause, in one batch, with a mocked API', async ({ page }) => {
		const requests: IconifyRequest[] = [];
		await page.route(ICONIFY_HOSTS, (route: Route) => {
			const r = parseIconifyRequest(route.request().url());
			requests.push(r);
			return route.fulfill(svgResponse(r));
		});
		await openIcons(page);
		// The first page (Dashboard Icons, offline) asks for nothing; wait for the full name list.
		await expect(page.getByText(/still loading/)).toHaveCount(0);
		await page.waitForTimeout(600);
		expect(requests).toEqual([]);
		await search(page).pressSequentially('account-cowboy-hat', { delay: 40 });
		const card = cardOf(page, 'mdi:account-cowboy-hat');
		await expect(card).toContainText('Online only');
		await expect(card.locator('[data-preview="ready"] svg')).toBeVisible({ timeout: 10_000 });
		// Nothing per keystroke: only whole names from the final results, one request per prefix.
		const visible = await results(page).getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
		expect(requests.length).toBeGreaterThan(0);
		expect(requests.length).toBe(1);
		for (const r of requests) for (const n of r.names) expect(visible).toContain(`${r.prefix}:${n}`);
	});

	test('an online-only name shows "Preview unavailable" when the API is blocked, never a blank', async ({ page }) => {
		await openIcons(page);
		await expect(page.getByText(/still loading/)).toHaveCount(0);
		await search(page).fill('account-cowboy-hat');
		const slot = cardOf(page, 'mdi:account-cowboy-hat').locator('[data-preview]');
		await expect(slot).toHaveAttribute('data-preview', 'unavailable', { timeout: 15_000 });
		await expect(slot).toHaveAttribute('aria-label', 'Preview unavailable');
		await expect(slot.locator('svg')).toBeVisible();
	});

	test('the built-in categories are listed with counts, read-only, and can be viewed', async ({ page }) => {
		await openIcons(page);
		const cats = page.getByRole('list', { name: 'Built-in categories' });
		const media = cats.getByRole('listitem').filter({ hasText: 'Media & Streaming' });
		await expect(media).toContainText(/[1-9][\d,]* packaged icons/);
		await expect(cats.getByRole('button', { name: /Rename|Delete/ })).toHaveCount(0);
		await media.getByRole('button', { name: 'Show Media & Streaming' }).click();
		await expect(page.getByLabel('Built-in category')).toHaveValue('media');
		const cards = results(page).getByRole('listitem');
		await expect(cards.first()).toContainText('Media & Streaming');
		const texts = await cards.allTextContents();
		for (const t of texts) expect(t).toContain('Media & Streaming');
	});

	test('"where used" works for a packaged icon used by a seeded tile', async ({ page }) => {
		const p = `pkg${Date.now().toString(36)}`;
		const dashName = `Packaged e2e ${p}`;
		const dash = {
			id: `${p}-dash`, name: dashName, order: 0, path: `/${p}`, revision: 1,
			settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
			tabs: [{ id: `${p}-tab`, name: 'Main', order: 0, root: { columns: 24, children: [
				{ id: `${p}-t1`, kind: 'tile', type: 'link', name: 'Logo tile', url: 'https://synthetic.example.lan/', iconUrl: '/api/icons/dashboard/1337x.svg',
					openMode: 'newtab', size: 'small', order: 0, placement: { x: 0, y: 0, w: 1, h: 1 } },
				{ id: `${p}-t2`, kind: 'tile', type: 'link', name: 'Name tile', url: 'https://synthetic2.example.lan/', icon: 'mdi:abacus',
					openMode: 'newtab', size: 'small', order: 1, placement: { x: 1, y: 0, w: 1, h: 1 } }
			] } }]
		};
		const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
		const r = await page.request.post('/api/config/import', {
			headers: { 'X-CSRF-Token': await getCsrfToken(page.context()) },
			multipart: { file: { name: 'pkg.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
		});
		expect(r.status(), await r.text()).toBe(200);
		madeDashes.push(dashName);

		await openIcons(page);
		await search(page).fill('1337x');
		await expect(cardOf(page, 'dashboard:1337x')).toContainText(`Used by 1 tile on ${dashName}`);
		await search(page).fill('mdi:abacus');
		await expect(cardOf(page, 'mdi:abacus')).toContainText(`Used by 1 tile on ${dashName}`);
		await search(page).fill('13ft');
		await expect(cardOf(page, 'dashboard:13ft')).toContainText('Not used');
	});

	test('packaged icons have no edit or delete controls; "Copy name" copies', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await openIcons(page);
		await search(page).fill('plex');
		await expect(cardOf(page, 'dashboard:plex')).toBeVisible();
		await expect(results(page).getByRole('button', { name: /Edit|Delete|Rename/ })).toHaveCount(0);
		await expect(results(page).locator('input, select, textarea')).toHaveCount(0);
		await cardOf(page, 'dashboard:plex').getByRole('button', { name: 'Copy name plex' }).click();
		await expect(page.getByText('Copied "plex"')).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('plex');
	});

	test('the "Offline and limits" note states the real shipped counts', async ({ page }) => {
		const info = await (await page.request.get('/api/icons/packaged')).json();
		// The real Dashboard Icons collection: over two thousand SVGs, not the library's subset.
		expect(info.dashboardIcons.count).toBeGreaterThan(2000);
		expect(info.presetRows).toBeGreaterThan(100);
		const b = bundleCounts();
		await openIcons(page);
		const note = page.getByTestId('shipped-counts');
		await expect(note).toHaveText(
			`Shipped with HOPS: ${fmt(info.dashboardIcons.count)} Dashboard Icons (including light and dark variants of some logos), served by this HOPS server; ` +
				`${fmt(info.presetRows)} preset library icons; ${fmt(b.mdi + b.si)} Iconify icons in the offline bundle (${fmt(b.mdi)} Material Design, ${fmt(b.si)} Simple Icons).`,
			{ useInnerText: true }
		);
	});

	test('a failed count says "couldn\'t be counted", never 0', async ({ page }) => {
		await page.route('**/api/icons/packaged', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"embedded files unreadable"}' }));
		await openIcons(page);
		await expect(page.getByTestId('shipped-counts')).toContainText("Dashboard Icons and preset library icons: couldn't be counted");
		await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the Dashboard Icons list from the server" })).toBeVisible();
	});

	test('phone width: no sideways scrolling', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openIcons(page);
		await search(page).fill('plex');
		await expect(cardOf(page, 'dashboard:plex')).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
