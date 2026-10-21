import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

// On a dashboard page (/d).
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			url: new URL('http://localhost/d'),
			params: { dashboard: 'd' },
			route: { id: '/[dashboard]' },
			status: 200,
			error: null,
			data: {},
			form: undefined
		}),
		navigating: readable(null),
		updated: readable(false)
	};
});
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	login: vi.fn(),
	logout: vi.fn(async () => {})
}));

import * as api from '$lib/utils/api';
import { LoginError } from '$lib/utils/api';
import { config } from '$lib/stores/config';
import { isAuthenticated, mustChangePassword, clearMustChangePassword } from '$lib/stores/auth';
import { goto } from '$app/navigation';
import { editMode } from '$lib/stores/editMode';
import { session, resetEditSessionForTests } from '$lib/stores/editSession';
import Navbar from './Navbar.svelte';
import type { Config } from '$lib/types';

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;

function doc(): Config {
	return {
		schemaVersion: 3,
		dashboards: [
			{ id: 'd', name: 'D', path: '/d', revision: 3, tabs: [{ id: 't1', name: 'One', root: { columns: 12, children: [] } }] }
		]
	} as unknown as Config;
}

async function signInWith(pass: string) {
	await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'admin' } });
	await fireEvent.input(screen.getByLabelText('Password'), { target: { value: pass } });
	await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Navbar pencil when logged out', () => {
	beforeEach(() => {
		apiLogin.mockReset();
		resetEditSessionForTests();
		isAuthenticated.set(false);
		mustChangePassword.set(false);
		editMode.set(false);
		config.set(doc());
	});

	it('is visible on a dashboard page', () => {
		render(Navbar, {});
		expect(screen.getByRole('button', { name: 'Enter Edit Mode' })).toBeTruthy();
	});

	it('opens the sign-in dialog in place; a wrong password shows the error and stays open', async () => {
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		await signInWith('wrong');
		expect((await screen.findByRole('alert')).textContent).toContain('check your username and password');
		expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
	});

	it('a successful sign-in starts editing on this dashboard', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: false });
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		await signInWith('right');
		await waitFor(() => expect(get(editMode)).toBe(true));
		expect(get(session)?.dashboardId).toBe('d');
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Exit Edit Mode' })).toBeTruthy();
	});

	it('Cancel changes nothing', async () => {
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
		expect(apiLogin).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(false);
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
		expect(screen.getByRole('button', { name: 'Enter Edit Mode' })).toBeTruthy();
	});

	it('logged in, the pencil enters edit mode directly (no dialog)', async () => {
		isAuthenticated.set(true);
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
		await waitFor(() => expect(get(editMode)).toBe(true));
		expect(get(session)?.dashboardId).toBe('d');
	});
});

describe('Navbar after a sign-in that must change the password', () => {
	beforeEach(() => {
		apiLogin.mockReset();
		resetEditSessionForTests();
		isAuthenticated.set(false);
		mustChangePassword.set(false);
		editMode.set(false);
		config.set(doc());
	});

	it('editing waits until the forced password change is done (the change dialog can\'t be dismissed)', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: true });
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		await signInWith('admin');
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		await new Promise((r) => setTimeout(r, 0));
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
		clearMustChangePassword();
		await waitFor(() => expect(get(editMode)).toBe(true));
		expect(get(session)?.dashboardId).toBe('d');
	});

	it('a session that ends before the password is changed never starts editing', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: true });
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Enter Edit Mode' }));
		await signInWith('admin');
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		isAuthenticated.set(false);
		mustChangePassword.set(false);
		await new Promise((r) => setTimeout(r, 0));
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
	});
});

describe('Navbar gear and Log out (spec §4D)', () => {
	beforeEach(() => {
		(goto as unknown as ReturnType<typeof vi.fn>).mockClear();
		(api.logout as unknown as ReturnType<typeof vi.fn>).mockClear();
		resetEditSessionForTests();
		mustChangePassword.set(false);
		editMode.set(false);
		config.set(doc());
	});

	it('the gear links to /settings, logged out and logged in', () => {
		isAuthenticated.set(false);
		const { unmount } = render(Navbar, {});
		expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
		unmount();
		isAuthenticated.set(true);
		render(Navbar, {});
		expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
	});

	it('Log out shows only when logged in', () => {
		isAuthenticated.set(false);
		render(Navbar, {});
		expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
		isAuthenticated.set(true);
	});

	it('Log out signs out and stays on this dashboard', async () => {
		isAuthenticated.set(true);
		render(Navbar, {});
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
		await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
		expect(get(isAuthenticated)).toBe(false);
		expect(goto).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
	});
});

