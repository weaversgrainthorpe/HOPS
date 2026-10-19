import { describe, it, expect, beforeEach, vi } from 'vitest';

const { current } = vi.hoisted(() => ({ current: { v: null as unknown } }));
vi.mock('./config', async () => {
	const { writable } = await import('svelte/store');
	current.v = writable<{ id: string } | null>(null);
	return { currentDashboard: current.v };
});
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	listSettings: vi.fn(),
	getDashboardSettings: vi.fn()
}));

import * as api from '$lib/utils/api';
import { refreshTimeoutFromSettings, getIdleTimeoutMs } from './editModeIdleWatcher';

const globalList = { settings: [{ key: 'editmode.idle_timeout_minutes', value: '15' }] };

const cur = () => current.v as import('svelte/store').Writable<{ id: string } | null>;

beforeEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
	cur().set(null);
	vi.mocked(api.listSettings).mockResolvedValue(globalList as never);
});

describe('refreshTimeoutFromSettings', () => {
	it('uses the current dashboard effective timeout', async () => {
		cur().set({ id: 'd1' });
		vi.mocked(api.getDashboardSettings).mockResolvedValue({
			overrides: {}, revision: 1, effective: { editIdleTimeoutMinutes: 3 }
		} as never);
		await refreshTimeoutFromSettings();
		expect(api.getDashboardSettings).toHaveBeenCalledWith('d1');
		expect(getIdleTimeoutMs()).toBe(3 * 60 * 1000);
	});

	it('uses the global lookup when no dashboard is current', async () => {
		vi.mocked(api.listSettings).mockResolvedValue({
			settings: [{ key: 'editmode.idle_timeout_minutes', value: '7' }]
		} as never);
		await refreshTimeoutFromSettings();
		expect(api.getDashboardSettings).not.toHaveBeenCalled();
		expect(getIdleTimeoutMs()).toBe(7 * 60 * 1000);
	});

	it('falls back to the global lookup with a warning when the dashboard lookup fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		cur().set({ id: 'd1' });
		vi.mocked(api.getDashboardSettings).mockRejectedValue(new Error('down'));
		vi.mocked(api.listSettings).mockResolvedValue({
			settings: [{ key: 'editmode.idle_timeout_minutes', value: '9' }]
		} as never);
		await refreshTimeoutFromSettings();
		expect(warn).toHaveBeenCalled();
		expect(getIdleTimeoutMs()).toBe(9 * 60 * 1000);
	});
});
