import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// "/" shows a dashboard (spec §4D): it redirects to the first one; with none it says so and
// offers Settings; a failed load or migration is shown as such, never as "no dashboards".
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	getConfig: vi.fn(() => new Promise(() => {})),
	getBackendVersion: vi.fn(async () => ({ version: 'test' }))
}));

import { goto } from '$app/navigation';
import { config, configLoading, configError, migrationFailure } from '$lib/stores/config';
import Page from './+page.svelte';
import type { Config } from '$lib/types';

const gotoMock = goto as unknown as ReturnType<typeof vi.fn>;

function doc(dashboards: Array<{ id: string; name: string; path: string; order?: number }>): Config {
	return {
		schemaVersion: 3,
		dashboards: dashboards.map((d) => ({ ...d, revision: 1, tabs: [] }))
	} as unknown as Config;
}

beforeEach(() => {
	gotoMock.mockClear();
	config.set(null);
	configLoading.set(true);
	configError.set(null);
	migrationFailure.set(null);
});

describe('/ (the home page)', () => {
	it('redirects to the first dashboard in display order, replacing the history entry', async () => {
		config.set(doc([
			{ id: 'b', name: 'Second', path: '/second', order: 1 },
			{ id: 'a', name: 'First', path: '/first', order: 0 }
		]));
		configLoading.set(false);
		render(Page);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock).toHaveBeenCalledWith('/first', { replaceState: true });
	});

	it('a redirect that fails says so, with the reason and a plain link to the dashboard (never "Opening…" forever)', async () => {
		gotoMock.mockImplementationOnce(async () => { throw new Error('route failed to load'); });
		config.set(doc([{ id: 'a', name: 'First', path: '/first', order: 0 }]));
		configLoading.set(false);
		render(Page);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain("Couldn't open First");
		expect(alert.textContent).toContain('route failed to load');
		expect(screen.getByRole('link', { name: /Open First/ }).getAttribute('href')).toBe('/first');
		expect(screen.queryByText(/Opening First/)).toBeNull();
	});

	it('waits for the config before redirecting (no redirect, no empty state while loading)', async () => {
		render(Page);
		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock).not.toHaveBeenCalled();
		expect(screen.queryByText('No dashboards yet')).toBeNull();
		expect(screen.getByRole('status').textContent).toMatch(/Loading/);
	});

	it('with no dashboards: "No dashboards yet" and a button that opens Settings', async () => {
		config.set(doc([]));
		configLoading.set(false);
		render(Page);
		expect(screen.getByRole('heading', { name: 'No dashboards yet' })).toBeTruthy();
		expect(gotoMock).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: /Open Settings/ }));
		expect(gotoMock).toHaveBeenCalledWith('/settings');
	});

	it('a failed load is shown as a failure with Retry, never as "No dashboards yet"', async () => {
		configLoading.set(false);
		configError.set("Couldn't reach the HOPS server");
		render(Page);
		expect(screen.queryByText('No dashboards yet')).toBeNull();
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toContain("Couldn't load your dashboards");
		expect(alert.textContent).toContain("Couldn't reach the HOPS server");
		expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('a failed load with an old document held does not redirect to it', async () => {
		config.set(doc([{ id: 'a', name: 'First', path: '/first' }]));
		configLoading.set(false);
		configError.set('boom');
		render(Page);
		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toContain('boom');
	});

	it('a failed migration shows MigrationFailed (pointing at Settings → Backups), no redirect', async () => {
		configLoading.set(false);
		configError.set('migration failed');
		migrationFailure.set('could not migrate: bad tile');
		render(Page);
		expect(screen.getByRole('heading', { name: /couldn't migrate your configuration/ })).toBeTruthy();
		expect(screen.getByText('could not migrate: bad tile')).toBeTruthy();
		const link = screen.getByRole('link', { name: /Settings → Backups/ });
		expect(link.getAttribute('href')).toBe('/settings');
		expect(screen.queryByText('No dashboards yet')).toBeNull();
		expect(gotoMock).not.toHaveBeenCalled();
	});
});
