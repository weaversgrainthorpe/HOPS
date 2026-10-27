import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const calls: unknown[][] = [];
let outcome: 'ok' | 'reject' = 'ok';
vi.mock('$lib/utils/api', async (orig) => ({
	...(await orig<object>()),
	changePassword: async (...a: unknown[]) => {
		calls.push(a);
		if (outcome === 'reject') throw new Error('Current password is incorrect');
	}
}));

// /settings/password: the change-password form itself, no popup.
import Page from './+page.svelte';

beforeEach(() => {
	calls.length = 0;
	outcome = 'ok';
});

async function fill(cur: string, nw: string, conf: string) {
	await fireEvent.input(screen.getByLabelText('Current Password'), { target: { value: cur } });
	await fireEvent.input(screen.getByLabelText('New Password'), { target: { value: nw } });
	await fireEvent.input(screen.getByLabelText('Confirm New Password'), { target: { value: conf } });
}

describe('/settings/password', () => {
	it('shows the form directly: three fields, the rules and a Change Password button, no dialog', () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Password', level: 2 })).toBeTruthy();
		expect(screen.getByLabelText('Current Password')).toBeTruthy();
		expect(screen.getByLabelText('New Password')).toBeTruthy();
		expect(screen.getByLabelText('Confirm New Password')).toBeTruthy();
		expect(screen.getByText(/8 to 72 characters/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /Change Password/i })).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows inline errors for a short, mismatched or unchanged password and does not call the server', async () => {
		render(Page);
		await fill('oldpassword', 'short', 'short');
		expect(screen.getByText(/at least 8 characters/)).toBeTruthy();
		await fill('oldpassword', 'longenough1', 'different1');
		expect(screen.getByText(/do not match|don't match/i)).toBeTruthy();
		await fill('samepassword', 'samepassword', 'samepassword');
		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		expect(screen.getByText(/must be different from current/)).toBeTruthy();
		expect(calls).toHaveLength(0);
	});

	it('on success confirms, notes the other sessions were signed out, and clears the fields', async () => {
		render(Page);
		await fill('oldpassword', 'brandnewpw', 'brandnewpw');
		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Password changed successfully.*other session was signed out|other session/is));
		expect(screen.getByRole('status').textContent).toMatch(/this one was refreshed/);
		expect(calls).toEqual([['oldpassword', 'brandnewpw']]);
		expect((screen.getByLabelText('New Password') as HTMLInputElement).value).toBe('');
	});

	it('a server rejection shows as an inline error', async () => {
		outcome = 'reject';
		render(Page);
		await fill('wrongwrong', 'brandnewpw', 'brandnewpw');
		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		const alert = await screen.findByRole('alert'); expect(alert.textContent).toContain('Current password is incorrect');
	});
});
