import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// /settings/dashboards (M5 §9): the dashboard list, its own page under the settings shell.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import { config, migrationFailure } from '$lib/stores/config';
import Page from './+page.svelte';
import type { Config } from '$lib/types';

beforeEach(() => {
	migrationFailure.set(null);
	config.set({ schemaVersion: 3, dashboards: [{ id: 'd', name: 'Home', path: '/home', revision: 1, tabs: [] }] } as unknown as Config);
});

describe('/settings/dashboards', () => {
	it('shows the dashboard list with New Dashboard', () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Dashboards', level: 2 })).toBeTruthy();
		expect(screen.getByRole('button', { name: /New Dashboard/ })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Home', level: 3 })).toBeTruthy();
	});

	it('a failed migration: says the dashboards cannot be shown; never an empty list as if there were none', () => {
		migrationFailure.set('could not migrate');
		config.set(null);
		render(Page);
		expect(screen.getByRole('heading', { name: 'Dashboards', level: 2 })).toBeTruthy();
		expect(screen.getByText(/can't be shown until the configuration is restored/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /New Dashboard/ })).toBeNull();
	});

	it('holds only the dashboards: no global settings, backups or factory reset here', () => {
		render(Page);
		expect(screen.queryByRole('button', { name: /Factory Reset/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Open Backups/ })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Global settings' })).toBeNull();
	});
});
