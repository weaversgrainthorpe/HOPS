import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => {
	const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
	return {
		ConflictError: actual.ConflictError,
		MigrationFailedError: actual.MigrationFailedError,
		getDashboardSettings: vi.fn(),
		saveDashboardSettings: vi.fn(),
		getBackgrounds: vi.fn(() => Promise.resolve({ categories: [], images: [] }))
	};
});

import * as api from '$lib/utils/api';
import DashboardEditModal from './DashboardEditModal.svelte';
import { config, migrationFailure, saveConflict } from '$lib/stores/config';
import { session, undo, redo, dirty, resetEditSessionForTests } from '$lib/stores/editSession';
import { startSession } from './editorTestKit';
import type { LayoutDashboard } from '$lib/types/layout';

const allNull = {
	statusChecksEnabled: null,
	statusCheckIntervalMinutes: null,
	statusCheckTimeoutSeconds: null,
	editIdleTimeoutMinutes: null,
	animatedFolderBackgrounds: null
};

const effective = {
	statusChecksEnabled: true,
	statusCheckIntervalMinutes: 5,
	statusCheckTimeoutSeconds: 10,
	editIdleTimeoutMinutes: 15,
	animatedFolderBackgrounds: false
};

const HEADER = { centerTitle: 'Saved title' };
const BACKGROUND = { type: 'color' as const, value: '#112233' };

function dash(revision: number, settings: Record<string, unknown> = {}) {
	return {
		id: 'd1', name: 'D', path: '/d', order: 0, revision, header: HEADER, background: BACKGROUND,
		settings: { ...allNull, ...settings },
		tabs: [{ id: 't1', name: 'Main', root: { columns: 24, children: [] } }]
	};
}

// A settings save's response: the new revision and the committed document.
function saved(revision: number, settings: Record<string, unknown> = {}) {
	return { revision, layout: { schemaVersion: 3 as const, dashboards: [dash(revision, settings)] } };
}

function serverSettings(overrides = {}, eff = effective) {
	return { overrides: { ...allNull, ...overrides }, effective: eff, revision: 4 };
}

const draft = () => get(session)!.draft as LayoutDashboard & { header?: unknown; background?: unknown };
const undoDepth = () => get(session)!.undo.length;

function open(onClose: () => void = () => {}) {
	return render(DashboardEditModal, {
		props: { dashboardId: 'd1', header: HEADER, background: BACKGROUND, onClose }
	});
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const section = (name: 'Header' | 'Background' | 'Settings') =>
	fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
	vi.clearAllMocks();
	resetEditSessionForTests();
	migrationFailure.set(null);
	saveConflict.set(null);
	config.set({ schemaVersion: 3, dashboards: [dash(4)] } as never);
	startSession('d1');
	vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
});

describe('DashboardEditModal (walkthrough §4C): one dialog, one Save, one Cancel', () => {
	it('has three sections: Header, Background and Settings', async () => {
		open();
		const dlg = screen.getByRole('dialog', { name: 'Edit Dashboard' });
		expect(within(dlg).getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Header', 'Background', 'Settings']);
		expect(screen.getByRole('tab', { name: 'Header' })).toHaveAttribute('aria-selected', 'true');
		await section('Settings');
		expect(await screen.findByText('Inherited: 15')).toBeVisible();
	});

	it('one Save applies the header and background to the draft as ONE undo step', async () => {
		open();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'New title' } });
		await section('Background');
		await fireEvent.input(screen.getByLabelText('Background Color'), { target: { value: '#445566' } });
		const before = undoDepth();
		await save();
		await waitFor(() => expect((draft().header as { centerTitle?: string }).centerTitle).toBe('New title'));
		expect(draft().background).toEqual({ type: 'color', value: '#445566' });
		expect(undoDepth()).toBe(before + 1);
		expect(api.saveDashboardSettings).not.toHaveBeenCalled(); // settings unchanged: not saved
		undo();
		expect(draft().header).toEqual(HEADER);
		expect(draft().background).toEqual(BACKGROUND);
		expect(get(dirty)).toBe(false);
		redo();
		expect((draft().header as { centerTitle?: string }).centerTitle).toBe('New title');
		expect(draft().background).toEqual({ type: 'color', value: '#445566' });
	});

	it('a Save with nothing changed adds no undo step and sends nothing', async () => {
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await save();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(undoDepth()).toBe(0);
		expect(get(dirty)).toBe(false);
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
	});

	it('settings save first, then the draft; both in one Save', async () => {
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'Both' } });
		await section('Settings');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '30' } });
		await save();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { editIdleTimeoutMinutes: 30 }, 4);
		expect((draft().header as { centerTitle?: string }).centerTitle).toBe('Both');
		expect(undoDepth()).toBe(1);
	});

	it('a failed settings save is shown in the dialog, which stays open; the draft is untouched', async () => {
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new Error('disk full'));
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'Not applied' } });
		await section('Settings');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await section('Header'); // the error must come into view by itself
		const before = draft();
		await save();
		expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
		expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
		expect(onClose).not.toHaveBeenCalled();
		expect(draft()).toBe(before);
		expect(undoDepth()).toBe(0);
		expect(get(dirty)).toBe(false);
	});

	it('Cancel discards everything: no request, no draft change', async () => {
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		const before = draft();
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'Gone' } });
		await section('Settings');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalled();
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
		expect(draft()).toBe(before);
		expect(undoDepth()).toBe(0);
	});

	it('a background that cannot be saved stops the Save before anything is written', async () => {
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5));
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await section('Settings');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await section('Background');
		await fireEvent.click(screen.getByRole('button', { name: /^Image$/ }));
		await section('Header');
		await save();
		expect(await screen.findByRole('alert')).toHaveTextContent(/Choose an image/);
		expect(screen.getByRole('tab', { name: 'Background' })).toHaveAttribute('aria-selected', 'true');
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		expect(undoDepth()).toBe(0);
	});

	it('while settings are saving it cannot be closed (Cancel, X, Escape), says so, and a late success still applies once', async () => {
		let finish!: (v: unknown) => void;
		vi.mocked(api.saveDashboardSettings).mockReturnValueOnce(new Promise((r) => (finish = r)) as never);
		const onClose = vi.fn();
		open(onClose);
		try {
			await screen.findByText('Check timeout (seconds)');
			await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'During' } });
			await section('Settings');
			await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
			await save();
			await waitFor(() => expect(api.saveDashboardSettings).toHaveBeenCalled());
			expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
			const cancel = screen.getByRole('button', { name: 'Cancel' });
			expect(cancel).toBeDisabled();
			await fireEvent.click(cancel);
			await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
			await fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings' }), { key: 'Escape' });
			expect(onClose).not.toHaveBeenCalled();
			expect(undoDepth()).toBe(0);
			finish(saved(5, { editIdleTimeoutMinutes: 15 }));
			await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
			expect((draft().header as { centerTitle?: string }).centerTitle).toBe('During');
			expect(undoDepth()).toBe(1);
		} finally {
			finish?.(saved(5, { editIdleTimeoutMinutes: 15 })); // never leave the save queue blocked
		}
	});

	it('Enter in a header text field saves', async () => {
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		const title = screen.getByLabelText(/Custom Title/);
		await fireEvent.input(title, { target: { value: 'By Enter' } });
		await fireEvent.keyDown(title, { key: 'Enter' });
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect((draft().header as { centerTitle?: string }).centerTitle).toBe('By Enter');
	});

	it('Ctrl+Enter saves from the Settings section', async () => {
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'By Ctrl' } });
		await section('Settings');
		await fireEvent.keyDown(screen.getByLabelText('Override for this dashboard: Status checks'), { key: 'Enter', ctrlKey: true });
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect((draft().header as { centerTitle?: string }).centerTitle).toBe('By Ctrl');
	});

	it('the dialog\'s Escape cancels it (no request, no draft change)', async () => {
		const onClose = vi.fn();
		open(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.input(screen.getByLabelText(/Custom Title/), { target: { value: 'Gone' } });
		await fireEvent.keyDown(screen.getByLabelText(/Custom Title/), { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
		expect(undoDepth()).toBe(0);
	});
});

// The Settings section: the old DashboardSettingsModal's behaviour, now inside the one dialog.
describe('DashboardEditModal Settings section', () => {
	async function openSettings(onClose: () => void = () => {}) {
		open(onClose);
		await section('Settings');
	}

	it('shows inherited value when override is null', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		await openSettings();
		expect(await screen.findByText('Inherited: 15')).toBeInTheDocument();
		expect(screen.getByText('Inherited: 5')).toBeInTheDocument();
		expect(screen.getByText('Edit mode idle timeout (minutes)')).toBeInTheDocument();
		// M5: free layout is gone, and with it the dashboard's default layout setting (Ruling 4).
		expect(screen.queryByText('Default layout for new tabs')).toBeNull();
	});

	it('save sends only changed overrides with revision', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(
			serverSettings({ statusCheckTimeoutSeconds: 20 }, { ...effective, statusCheckTimeoutSeconds: 20 })
		);
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		const onClose = vi.fn();
		await openSettings(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '30' } });
		await save();
		await waitFor(() => expect(api.saveDashboardSettings).toHaveBeenCalled());
		expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { editIdleTimeoutMinutes: 30 }, 4);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it('reset to inherit sends an explicit null', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(
			serverSettings({ statusCheckTimeoutSeconds: 20 }, { ...effective, statusCheckTimeoutSeconds: 20 })
		);
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { statusCheckTimeoutSeconds: null }));
		await openSettings();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByRole('button', { name: 'Reset to inherit: Check timeout (seconds)' }));
		await save();
		await waitFor(() =>
			expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { statusCheckTimeoutSeconds: null }, 4)
		);
	});

	it('updates the store revision and settings after a successful save (the session follows)', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		await openSettings();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '30' } });
		await save();
		await waitFor(() => expect(get(config)!.dashboards[0].revision).toBe(5));
		expect((get(config)!.dashboards[0].settings as Record<string, unknown>).editIdleTimeoutMinutes).toBe(30);
		expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(4);
		expect(get(session)!.baseRevision).toBe(5);
	});

	it('shows an inline error on conflict and does not apply or close', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.ConflictError('d1', 9));
		const onClose = vi.fn();
		await openSettings(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await save();
		expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/i);
		expect(onClose).not.toHaveBeenCalled();
		expect(get(config)!.dashboards[0].revision).toBe(4);
	});

	it('sends the store revision, not the freshly fetched one (C1)', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue({ ...serverSettings(), revision: 6 });
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.ConflictError('d1', 6));
		const onClose = vi.fn();
		await openSettings(onClose);
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await save();
		expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/i);
		expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(4);
		expect(get(saveConflict)).toEqual({ dashboardId: 'd1' });
		expect(get(config)!.dashboards[0].revision).toBe(4);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('shows the server message on a 400', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new Error('interval must be at least 1'));
		await openSettings();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Check interval (minutes)'));
		await save();
		expect(await screen.findByRole('alert')).toHaveTextContent('interval must be at least 1');
	});

	it('routes a migration failure to the migrationFailure store', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.MigrationFailedError('boom'));
		await openSettings();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Check interval (minutes)'));
		await save();
		await waitFor(() => expect(get(migrationFailure)).toBe('boom'));
	});

	it('shows an inline error when loading fails, not default rows; the Settings tab says so', async () => {
		vi.mocked(api.getDashboardSettings).mockRejectedValue(new Error('nope'));
		open();
		const tab = screen.getByRole('tab', { name: /Settings/ });
		await waitFor(() => expect(tab.getAttribute('aria-describedby')).toBe('dash-edit-settings-failed'));
		expect(document.getElementById('dash-edit-settings-failed')).toHaveTextContent(/couldn't load/i);
		await section('Settings');
		expect(await screen.findByRole('alert')).toHaveTextContent('nope');
		expect(screen.queryByText('Check timeout (seconds)')).not.toBeInTheDocument();
	});

	it('rejects an emptied number field inline and disables Save', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		await openSettings();
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '' } });
		expect(await screen.findByText(/whole number/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
	});
});
