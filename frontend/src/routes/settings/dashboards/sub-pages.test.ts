import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// The Dashboards sub-pages: Dead links and Duplicates each have their own page (moved off the
// list page), as does Blocked status checks.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	getDeadLinks: vi.fn(() => new Promise(() => {})),
	listSettings: vi.fn(() => new Promise(() => {})),
	getDashboardSettings: vi.fn(() => new Promise(() => {}))
}));

import { config, migrationFailure } from '$lib/stores/config';
import ListPage from './+page.svelte';
import DeadLinksPage from './dead-links/+page.svelte';
import DuplicatesPage from './duplicates/+page.svelte';
import BlockedPage from './blocked-status-checks/+page.svelte';
import { load as oldOverridesLoad } from './status-overrides/+page';
import type { Config } from '$lib/types';

beforeEach(() => {
	migrationFailure.set(null);
	config.set({ schemaVersion: 3, dashboards: [{ id: 'd', name: 'Home', path: '/home', revision: 1, tabs: [] }] } as unknown as Config);
});

describe('Dashboards sub-pages', () => {
	it('the list page no longer carries Dead links or Duplicates', () => {
		render(ListPage);
		expect(screen.queryByRole('heading', { name: 'Dead links' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Duplicates' })).toBeNull();
	});

	it('Dead links page shows the Dead links section', () => {
		render(DeadLinksPage);
		expect(screen.getByRole('heading', { name: 'Dead links' })).toBeTruthy();
	});

	it('Duplicates page shows the Duplicates section', () => {
		render(DuplicatesPage);
		expect(screen.getByRole('heading', { name: 'Duplicates' })).toBeTruthy();
	});

	it('Blocked status checks page shows its section', () => {
		render(BlockedPage);
		expect(screen.getByRole('heading', { name: 'Blocked status checks' })).toBeTruthy();
		expect(screen.getByTestId('blocked-status-checks')).toBeTruthy();
	});

	it('the earlier Status check overrides address redirects to it', () => {
		expect(() => oldOverridesLoad()).toThrow(expect.objectContaining({ location: '/settings/dashboards/blocked-status-checks' }));
	});

	for (const [name, Page] of [['Dead links', DeadLinksPage], ['Duplicates', DuplicatesPage], ['Blocked status checks', BlockedPage]] as const) {
		it(`${name}: a failed migration says it cannot be shown, never an empty result`, () => {
			migrationFailure.set('could not migrate');
			config.set(null);
			render(Page);
			expect(screen.getByRole('heading', { name, level: 2 })).toBeTruthy();
			expect(screen.getByText(/can't be shown until the configuration is restored/)).toBeTruthy();
		});
	}
});
