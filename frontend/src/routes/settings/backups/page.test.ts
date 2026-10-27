import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// /settings/backups: the backups themselves are on the page; there is no button that opens a popup.
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	listBackups: vi.fn(async () => ({
		backups: [{ name: 'hops-1.db', createdAt: '2026-10-01T10:00:00Z', size: 1024, kind: 'manual' }],
		problems: []
	}))
}));

import Page from './+page.svelte';

describe('/settings/backups', () => {
	it('has its heading and shows the backups list directly, with no button that opens a popup', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Backups', level: 2 })).toBeTruthy();
		expect(screen.getByText(/HOPS backs up its database automatically/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Open Backups/ })).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(await screen.findByRole('button', { name: /Create/ })).toBeTruthy();
	});
});
