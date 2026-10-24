import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// /settings/backups (M5 §9): opens the backups dialog, which the settings shell owns (so the
// MigrationFailed notice can open the same dialog from any settings page).
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	getBackendVersion: vi.fn(async () => { throw new TypeError('Failed to fetch'); })
}));

import { backendStatus } from '$lib/stores/backendStatus';
import { SETTINGS_SHELL, type SettingsShell } from '../settingsShell';
import Page from './+page.svelte';

let shell: SettingsShell;
beforeEach(() => {
	shell = { openBackups: vi.fn() };
});
const renderPage = () => render(Page, { context: new Map([[SETTINGS_SHELL, shell]]) });

describe('/settings/backups', () => {
	it('has its heading and explanation, and Open Backups opens the shell\'s backups dialog', async () => {
		renderPage();
		expect(screen.getByRole('heading', { name: 'Backups', level: 2 })).toBeTruthy();
		expect(screen.getByText(/backs up the database on startup/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /Open Backups/ }));
		expect(shell.openBackups).toHaveBeenCalledTimes(1);
	});

	it('Open Backups is disabled while the backend is offline', async () => {
		await backendStatus.check(); // the version probe fails: offline
		renderPage();
		expect((screen.getByRole('button', { name: /Open Backups/ }) as HTMLButtonElement).disabled).toBe(true);
		backendStatus.reset();
	});
});
