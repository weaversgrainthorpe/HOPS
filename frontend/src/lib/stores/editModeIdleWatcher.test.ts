import { describe, it, expect, beforeEach, vi } from 'vitest';

const { current } = vi.hoisted(() => ({ current: { v: null as unknown } }));
vi.mock('./config', async () => {
	const actual = await vi.importActual<object>('./config');
	const { writable } = await import('svelte/store');
	current.v = writable<unknown>(undefined);
	return { ...actual, currentRoute: current.v };
});
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	listSettings: vi.fn(),
	getDashboardSettings: vi.fn()
}));

import * as api from '$lib/utils/api';
import { refreshTimeoutFromSettings, getIdleTimeoutMs, initEditModeIdleWatcher } from './editModeIdleWatcher';
import { editMode } from './editMode';
import { get } from 'svelte/store';

const globalList = { settings: [{ key: 'editmode.idle_timeout_minutes', value: '15' }] };

// The route's dashboard (the v3 dashboard itself, or undefined off a dashboard).
const route = () => current.v as import('svelte/store').Writable<unknown>;
const cur = () => ({
	set: (d: ({ id: string; settings?: unknown; [k: string]: unknown }) | null) => route().set(d ?? undefined)
});
// The Showcase: a free-layout dashboard (once "view-only (v3)").
const showcase = {
	id: 'sc-dash', name: 'Showcase', path: '/showcase', revision: 3,
	tabs: [{ id: 'sc-tab-free', name: 'Free', root: { columns: 24, children: [] } }]
};

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

	it('uses the Showcase (a free-layout dashboard) like any other', async () => {
		cur().set(showcase);
		vi.mocked(api.getDashboardSettings).mockResolvedValue({
			overrides: {}, revision: 1, effective: { editIdleTimeoutMinutes: 5 }
		} as never);
		await refreshTimeoutFromSettings();
		expect(api.getDashboardSettings).toHaveBeenCalledWith('sc-dash');
		expect(getIdleTimeoutMs()).toBe(5 * 60 * 1000);
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

describe('re-resolving while in edit mode', () => {
	it('refreshes when the dashboard changes or its settings are saved', async () => {
		vi.mocked(api.getDashboardSettings).mockImplementation(async (id: string) => ({
			overrides: {}, revision: 1,
			effective: { editIdleTimeoutMinutes: id === 'd1' ? 4 : 6 }
		}) as never);
		cur().set({ id: 'd1' });
		initEditModeIdleWatcher();
		editMode.set(true);
		await vi.waitFor(() => expect(getIdleTimeoutMs()).toBe(4 * 60 * 1000));

		cur().set({ id: 'd2' });
		await vi.waitFor(() => expect(getIdleTimeoutMs()).toBe(6 * 60 * 1000));

		vi.mocked(api.getDashboardSettings).mockResolvedValue({
			overrides: {}, revision: 2, effective: { editIdleTimeoutMinutes: 9 }
		} as never);
		cur().set({ id: 'd2', settings: { editIdleTimeoutMinutes: 9 } } as never);
		await vi.waitFor(() => expect(getIdleTimeoutMs()).toBe(9 * 60 * 1000));
		editMode.set(false);
	});

	it('times edit mode out on the Showcase', async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(api.getDashboardSettings).mockResolvedValue({
				overrides: {}, revision: 3, effective: { editIdleTimeoutMinutes: 1 }
			} as never);
			cur().set(showcase);
			initEditModeIdleWatcher();
			editMode.set(true);
			await vi.advanceTimersByTimeAsync(0);
			expect(getIdleTimeoutMs()).toBe(60 * 1000);
			expect(get(editMode)).toBe(true);
			await vi.advanceTimersByTimeAsync(60 * 1000 + 10);
			expect(get(editMode)).toBe(false);
		} finally {
			editMode.set(false);
			vi.useRealTimers();
		}
	});

	it('warns when the global setting is missing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(api.listSettings).mockResolvedValue({ settings: [] } as never);
		await refreshTimeoutFromSettings();
		expect(warn).toHaveBeenCalled();
	});
});
