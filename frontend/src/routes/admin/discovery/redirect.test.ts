import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load, _discoveryRedirect } from './[...rest]/+page';

// M5 §11: Discovery moved to /settings/discovery…; every old /admin/discovery… address goes to
// the matching new page (bookmarks keep working), with its query string.
function redirectOf(rest: string, href: string): { status: number; location: string } {
	let thrown: unknown;
	try {
		(load as unknown as (e: unknown) => unknown)({ params: { rest }, url: new URL(href) });
	} catch (e) {
		thrown = e;
	}
	expect(isRedirect(thrown)).toBe(true);
	return thrown as { status: number; location: string };
}

describe('/admin/discovery… redirects', () => {
	it.each([
		['', 'http://h/admin/discovery', '/settings/discovery'],
		['new', 'http://h/admin/discovery/new', '/settings/discovery/new'],
		['diagnostics', 'http://h/admin/discovery/diagnostics', '/settings/discovery/diagnostics'],
		['detectors', 'http://h/admin/discovery/detectors', '/settings/discovery/detectors'],
		['abc123', 'http://h/admin/discovery/abc123', '/settings/discovery/abc123'],
		['new', 'http://h/admin/discovery/new?targets=10.0.0.0%2F24&intensity=light', '/settings/discovery/new?targets=10.0.0.0%2F24&intensity=light']
	])('%s (%s) → %s', (rest, href, to) => {
		const r = redirectOf(rest, href);
		expect(r.location).toBe(to);
		expect([301, 302, 303, 307, 308]).toContain(r.status);
	});

	it('builds the address without a trailing slash for the index', () => {
		expect(_discoveryRedirect('')).toBe('/settings/discovery');
	});
});
