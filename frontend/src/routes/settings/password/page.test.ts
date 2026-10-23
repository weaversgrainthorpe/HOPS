import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// /settings/password (M5 §9): Change Password, on its own page.
import Page from './+page.svelte';

describe('/settings/password', () => {
	it('Change Password opens the change-password dialog', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Password', level: 2 })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		expect(await screen.findByRole('dialog', { name: 'Change Password' })).toBeTruthy();
	});

	it('leaving the page (the shell hides it when the session ends) closes the dialog with it', async () => {
		const { unmount } = render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		expect(await screen.findByRole('dialog', { name: 'Change Password' })).toBeTruthy();
		unmount();
		expect(screen.queryByRole('dialog', { name: 'Change Password' })).toBeNull();
	});
});
