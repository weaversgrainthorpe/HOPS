import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// Browser security headers: the app runs under its restrictive
// Content-Security-Policy with NO violations — the SPA boot script (allowed by hash),
// the editor, an iframe tile, the Iconify online fallback (connect-src) and Settings.
// Any `securitypolicyviolation` event or CSP console error fails the test.

const ICONIFY_PRIMARY = /api\.iconify\.design/;
const ICONIFY_FALLBACKS = /api\.(simplesvg|unisvg)\.com/;
const FRAME_URL = 'http://csp-frame-target.test/';

let made = '';

/** Collect CSP violations across navigations: as the page sees them (event, reported
 *  through a binding) and as the console reports them. */
async function watchCSP(page: Page): Promise<() => string[]> {
	const seen: string[] = [];
	await page.exposeFunction('__reportCSP', (v: string) => { seen.push(v); });
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) => {
			(window as unknown as { __reportCSP: (v: string) => void }).__reportCSP(
				`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`);
		});
	});
	page.on('console', (m) => {
		if (/Content.Security.Policy/i.test(m.text())) seen.push(m.text());
	});
	return () => [...seen];
}

async function seed(page: Page, context: BrowserContext) {
	const p = `m6csp${Date.now().toString(36)}`;
	const id = (s: string) => `${p}-${s}`;
	const tile = (n: string, extra: Record<string, unknown>, x: number) => ({
		id: id(n), kind: 'tile', type: 'link', name: n, url: 'https://anchor.example.lan/', icon: 'mdi:lan',
		openMode: 'newtab', size: 'medium', order: x, placement: { x: x * 2, y: 0, w: 2, h: 2 }, ...extra
	});
	const dash = {
		id: id('dash'), name: `CSP ${p}`, order: 0, path: `/${p}`, revision: 1,
		settings: { statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null, editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null },
		tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: [
			tile('Framed', { url: FRAME_URL, openMode: 'iframe' }, 0),
			// An icon outside the offline set: rendering it needs the Iconify API.
			tile('Online', { icon: 'tabler:rocket' }, 1)
		] } }]
	};
	const doc = { format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard', config: { layoutVersion: 2, dashboards: [dash] } };
	const r = await page.request.post('/api/config/import', {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) },
		multipart: { file: { name: 'csp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
	});
	expect(r.status(), await r.text()).toBe(200);
	made = id('dash');
	return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
	if (!made) return;
	const id = made;
	made = '';
	const cfg = await (await page.request.get('/api/config')).json();
	const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
	const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
		headers: { 'X-CSRF-Token': await getCsrfToken(context) }
	});
	expect(r.ok(), await r.text()).toBe(true);
});

test('the app, editor, iframe tile, Iconify fallback and Settings run with no CSP violations', async ({ page, context }) => {
	const violations = await watchCSP(page);

	// Iconify: the primary host is unreachable, a fallback host answers — the online
	// fallback must be allowed by connect-src.
	const iconify: string[] = [];
	await page.route(ICONIFY_PRIMARY, (route) => route.abort());
	await page.route(ICONIFY_FALLBACKS, (route) => {
		const u = new URL(route.request().url());
		iconify.push(u.host);
		const prefix = u.pathname.replace(/^\//, '').replace(/\.json$/, '');
		const names = (u.searchParams.get('icons') || '').split(',').filter(Boolean);
		return route.fulfill({
			status: 200, contentType: 'application/json',
			body: JSON.stringify({ prefix, width: 24, height: 24, icons: Object.fromEntries(names.map((n) => [n, { body: '<path d="M2 2h20v20H2z"/>' }])) })
		});
	});
	// The iframe tile's target: any http(s) host must be frameable.
	await page.route(FRAME_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>t</title><p id="framed">framed ok</p>' }));

	const { path, id } = await seed(page, context);

	// The document is served under the app CSP, its boot script allowed by hash only.
	const resp = await page.goto(path);
	const csp = resp?.headers()['content-security-policy'] ?? '';
	expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
	expect(csp).not.toContain('unsafe-eval');
	expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
	expect(resp?.headers()['referrer-policy']).toBe('same-origin');
	await expect(page.locator(`[data-node-id="${id('Framed')}"]`)).toBeVisible();

	// Iconify fallback used (the online icon rendered through a fallback host).
	await expect.poll(() => iconify.length, { message: 'an Iconify fallback host was asked' }).toBeGreaterThan(0);

	// Iframe tile opens and the framed page loads.
	await page.locator(`[data-node-id="${id('Framed')}"]`).click();
	const frame = page.frameLocator('iframe');
	await expect(frame.locator('#framed')).toHaveText('framed ok');
	await page.keyboard.press('Escape');

	// Editor, and the icon picker inside it.
	await page.locator('[aria-label="Enter Edit Mode"]').click();
	await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
	await page.locator(`[data-node-id="${id('Online')}"]`).dblclick();
	const dlg = page.getByRole('dialog', { name: 'Edit Tile' });
	await expect(dlg).toBeVisible();
	await dlg.getByRole('button', { name: 'Edit icon' }).click();
	const field = page.getByRole('combobox', { name: /Iconify icon name/ });
	await expect(field).toBeVisible();
	await field.fill('tabler:ro');
	await page.waitForTimeout(500);
	await page.keyboard.press('Escape');

	// Settings sections.
	for (const s of ['/settings/dashboards', '/settings/global', '/settings/icons', '/settings/backups', '/settings/logs', '/settings/discovery']) {
		await page.goto(s);
		await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
	}

	expect(violations(), 'CSP violations').toEqual([]);
});

test('an injected inline script is blocked and reported (the watcher above can see violations)', async ({ page }) => {
	const violations = await watchCSP(page);
	await page.goto('/');
	const ran = await page.evaluate(() => {
		const w = window as unknown as { __injected?: boolean };
		const s = document.createElement('script');
		s.textContent = 'window.__injected = true';
		document.body.appendChild(s);
		return w.__injected === true;
	});
	expect(ran, 'inline script must not run').toBe(false);
	await expect.poll(() => violations().some((v) => /script-src/.test(v))).toBe(true);
});
