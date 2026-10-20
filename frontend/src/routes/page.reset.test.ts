import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	resetConfig: vi.fn(async () => ({})),
	getConfig: vi.fn(() => new Promise(() => {})),
	listBackups: vi.fn(async () => ({ backups: [] })),
	getBackendVersion: vi.fn(async () => ({ version: 'test' }))
}));

import * as api from '$lib/utils/api';
import { isAuthenticated } from '$lib/stores/auth';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import Page from './+page.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	isAuthenticated.set(true);
});

describe('admin page Factory Reset', () => {
	it('the confirmation describes the v3 content (folders and tiles), and Cancel resets nothing', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Factory Reset/ }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		const msg = get(confirmModalState).options?.message ?? "";
		expect(msg).toMatch(/dashboards, tabs, folders and tiles/);
		expect(msg).not.toMatch(/groups|entries/i);
		closeConfirmModal(false);
		await new Promise((r) => setTimeout(r, 0));
		expect(api.resetConfig).not.toHaveBeenCalled();
	});
});
