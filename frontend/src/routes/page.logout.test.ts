import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	logout: vi.fn(async () => {}),
	getConfig: vi.fn(() => new Promise(() => {})),
	listBackups: vi.fn(async () => ({ backups: [] })),
	getBackendVersion: vi.fn(async () => ({ version: 'test' }))
}));

import * as api from '$lib/utils/api';
import { isAuthenticated } from '$lib/stores/auth';
import { config } from '$lib/stores/config';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import { begin, apply, resetEditSessionForTests, dirty } from '$lib/stores/editSession';
import { updateNode } from '$lib/editor/treeOps';
import Page from './+page.svelte';
import type { Config } from '$lib/types';
import type { LayoutNode } from '$lib/types/layout';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	vi.clearAllMocks();
	resetEditSessionForTests();
	config.set({
		dashboards: [],
		v3OnlyDashboards: [],
		layout: {
			schemaVersion: 3,
			dashboards: [{
				id: 'd', name: 'D', path: '/d', revision: 1,
				tabs: [{ id: 't', name: 'T', root: { columns: 12, children: [
					{ kind: 'tile', id: 'a', name: 'a', url: 'http://x', placement: { x: 0, y: 0, w: 1, h: 1 } } as unknown as LayoutNode
				] } }]
			}]
		}
	} as unknown as Config);
	isAuthenticated.set(true);
});

describe('admin page Logout with unsaved edit-session changes', () => {
	it('Keep editing cancels the logout and the page stays signed in', async () => {
		begin('d');
		apply('rename', (d) => updateNode(d, 'a', { name: 'mine' } as Partial<LayoutNode>));
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Logout/ }));
		await flush();
		expect(get(confirmModalState).isOpen).toBe(true);
		closeConfirmModal(false); // Keep editing
		await flush();
		expect(api.logout).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(true);
		expect(get(dirty)).toBe(true);
		expect(screen.getByRole('button', { name: /Logout/ })).toBeInTheDocument();
	});
});
