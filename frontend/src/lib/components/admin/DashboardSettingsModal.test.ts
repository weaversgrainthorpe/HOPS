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
import { config, migrationFailure } from '$lib/stores/config';

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

function serverSettings(overrides = {}, eff = effective) {
	return { overrides: { ...allNull, ...overrides }, effective: eff, revision: 4 };
}

beforeEach(() => {
	vi.clearAllMocks();
	migrationFailure.set(null);
	config.set({
		dashboards: [{ id: 'd1', name: 'D', path: '/d', tabs: [], order: 0, revision: 4 }],
		theme: { mode: 'auto' },
		settings: { searchHotkey: '/', defaultView: 'd1' },
		dashboardRevisions: { d1: 4 }
	} as never);
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
		vi.mocked(api.saveDashboardSettings).mockResolvedValue({ revision: 5 });
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
		vi.mocked(api.saveDashboardSettings).mockResolvedValue({ revision: 5 });
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
		vi.mocked(api.saveDashboardSettings).mockResolvedValue({ revision: 5 });
		render(DashboardSettingsModal, { props: { dashboardId: 'd1', onClose: () => {} } });
		await screen.findByText('Check timeout (seconds)');
		await fireEvent.click(screen.getByLabelText('Override for this dashboard: Edit mode idle timeout (minutes)'));
		await fireEvent.input(screen.getByLabelText('Edit mode idle timeout (minutes)'), { target: { value: '30' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(get(config)!.dashboards[0].revision).toBe(5));
		expect(get(config)!.dashboardRevisions!.d1).toBe(5);
		expect(get(config)!.dashboards[0].settings?.editIdleTimeoutMinutes).toBe(30);
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
});
