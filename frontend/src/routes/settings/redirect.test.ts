import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page';

// /settings is not a page of its own any more: it goes to its first section, so the gear,
// old bookmarks and every "Open Settings" link keep working.
describe('/settings', () => {
	it('redirects to /settings/dashboards', () => {
		let thrown: unknown;
		try {
			(load as unknown as () => unknown)();
		} catch (e) {
			thrown = e;
		}
		expect(isRedirect(thrown)).toBe(true);
		const r = thrown as { status: number; location: string };
		expect(r.location).toBe('/settings/dashboards');
		expect([301, 302, 303, 307, 308]).toContain(r.status);
	});
});
