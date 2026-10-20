import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => {
	const actual = await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api');
	return {
		ConflictError: actual.ConflictError,
		MigrationFailedError: actual.MigrationFailedError,
		getDashboardSettings: vi.fn(),
		saveDashboardSettings: vi.fn()
	};
});

import * as api from '$lib/utils/api';
import DashboardSettingsModal from './DashboardSettingsModal.svelte';
import { config, migrationFailure, saveConflict } from '$lib/stores/config';

const allNull = {
	statusChecksEnabled: null,
	statusCheckIntervalMinutes: null,
	statusCheckTimeoutSeconds: null,
	editIdleTimeoutMinutes: null,
	animatedFolderBackgrounds: null,
	defaultLayout: null
};

const effective = {
	statusChecksEnabled: true,
	statusCheckIntervalMinutes: 5,
	statusCheckTimeoutSeconds: 10,
	editIdleTimeoutMinutes: 15,
	animatedFolderBackgrounds: false,
	defaultLayout: 'grid'
};

// A settings save's response: the new revision and the committed document.
function saved(revision: number, settings: Record<string, unknown> = {}) {
	return {
		revision,
		layout: { schemaVersion: 3 as const, dashboards: [{ id: 'd1', name: 'D', path: '/d', tabs: [], order: 0, revision, settings: { ...allNull, ...settings } }] }
	};
}

function serverSettings(overrides = {}, eff = effective) {
	return { overrides: { ...allNull, ...overrides }, effective: eff, revision: 4 };
}

beforeEach(() => {
	vi.clearAllMocks();
	migrationFailure.set(null);
	saveConflict.set(null);
	config.set({ schemaVersion: 3, dashboards: [{ id: 'd1', name: 'D', path: '/d', tabs: [], order: 0, revision: 4 }] });
});

describe('DashboardSettingsModal', () => {
	it('shows inherited value when override is null', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		expect(await screen.findByText('Inherited: 15')).toBeInTheDocument();
		expect(screen.getByText('Inherited: 5')).toBeInTheDocument();
		expect(screen.getByText('Inherited: grid')).toBeInTheDocument();
		expect(screen.getByText('Edit mode idle timeout (minutes)')).toBeInTheDocument();
		expect(screen.getByText('Default layout for new tabs')).toBeInTheDocument();
	});

	it('save sends only changed overrides with revision', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(
			serverSettings({ statusCheckTimeoutSeconds: 20 }, { ...effective, statusCheckTimeoutSeconds: 20 })
		);
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		const onClose = vi.fn();
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose } });
		await screen.findByText('Check timeout (seconds)');

		// Override idle timeout and set to 30.
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		const input = screen.getByLabelText('Edit mode idle timeout (minutes)');
		await fireEvent.input(input, { target: { value: '30' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(api.saveDashboardSettings).toHaveBeenCalled());
		expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { editIdleTimeoutMinutes: 30 }, 4);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it('reset to inherit sends an explicit null', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(
			serverSettings({ statusCheckTimeoutSeconds: 20 }, { ...effective, statusCheckTimeoutSeconds: 20 })
		);
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByRole('button', { name: 'Reset to inherit: Check timeout (seconds)' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(api.saveDashboardSettings).toHaveBeenCalledWith('d1', { statusCheckTimeoutSeconds: null }, 4)
		);
	});

	it('updates the store revision and settings after a successful save', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockResolvedValue(saved(5, { editIdleTimeoutMinutes: 30 }));
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '30' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(get(config)!.dashboards[0].revision).toBe(5));
		expect((get(config)!.dashboards[0].settings as Record<string, unknown>).editIdleTimeoutMinutes).toBe(30);
		expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(4);
	});

	it('cancel sends nothing', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		const onClose = vi.fn();
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('shows an inline error on conflict and does not apply or close', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.ConflictError('d1', 9));
		const onClose = vi.fn();
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/i);
		expect(onClose).not.toHaveBeenCalled();
		expect(get(config)!.dashboards[0].revision).toBe(4);
	});

	it('sends the store revision, not the freshly fetched one (C1)', async () => {
		// The page's store is at 4; another browser has since moved the server to 6.
		vi.mocked(api.getDashboardSettings).mockResolvedValue({ ...serverSettings(), revision: 6 });
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.ConflictError('d1', 6));
		const onClose = vi.fn();
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/i);
		expect(vi.mocked(api.saveDashboardSettings).mock.calls[0][2]).toBe(4);
		expect(get(saveConflict)).toEqual({ dashboardId: 'd1' });
		expect(get(config)!.dashboards[0].revision).toBe(4);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('shows the server message on a 400', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new Error('interval must be at least 1'));
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Check interval (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('interval must be at least 1');
	});

	it('routes a migration failure to the migrationFailure store', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		vi.mocked(api.saveDashboardSettings).mockRejectedValue(new api.MigrationFailedError('boom'));
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Check interval (minutes)'));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(get(migrationFailure)).toBe('boom'));
	});

	it('shows an inline error when loading fails, not default rows', async () => {
		vi.mocked(api.getDashboardSettings).mockRejectedValue(new Error('nope'));
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		expect(await screen.findByRole('alert')).toHaveTextContent('nope');
		expect(screen.queryByText('Check timeout (seconds)')).not.toBeInTheDocument();
	});

	it('rejects an emptied number field inline and disables Save', async () => {
		vi.mocked(api.getDashboardSettings).mockResolvedValue(serverSettings());
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '' } });
		expect(await screen.findByText(/whole number/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
		expect(api.saveDashboardSettings).not.toHaveBeenCalled();
	});
});
