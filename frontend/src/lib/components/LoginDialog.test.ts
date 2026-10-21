import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	login: vi.fn()
}));

import * as api from '$lib/utils/api';
import { LoginError } from '$lib/utils/api';
import { isAuthenticated, loginError } from '$lib/stores/auth';
import { toast } from '$lib/stores/toast';
import LoginDialog from './LoginDialog.svelte';

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const SECRET = 'hunter2-secret';

function open() {
	const onSuccess = vi.fn();
	const onCancel = vi.fn();
	render(LoginDialog, { onSuccess, onCancel });
	return { onSuccess, onCancel, dialog: screen.getByRole('dialog', { name: 'Sign in' }) };
}

async function fill(user: string, pass: string) {
	await fireEvent.input(screen.getByLabelText('Username'), { target: { value: user } });
	await fireEvent.input(screen.getByLabelText('Password'), { target: { value: pass } });
}

describe('LoginDialog', () => {
	beforeEach(() => {
		apiLogin.mockReset();
		isAuthenticated.set(false);
	});
	afterEach(() => vi.restoreAllMocks());

	it('is a labelled dialog with labelled fields; the username field gets focus', async () => {
		const { dialog } = open();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		const user = screen.getByLabelText('Username');
		expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
		await waitFor(() => expect(document.activeElement).toBe(user));
	});

	it('a wrong password shows the error in the dialog and stays open', async () => {
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		const { onSuccess, onCancel, dialog } = open();
		await fill('admin', 'wrong');
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('check your username and password');
		expect(dialog.contains(alert)).toBe(true);
		expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(onSuccess).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(false);
	});

	it('an unreachable server is shown as such, not as a wrong password', async () => {
		apiLogin.mockRejectedValue(new LoginError('network', "Couldn't reach the HOPS server. Check that it's running and your network is up."));
		open();
		await fill('admin', 'x');
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect((await screen.findByRole('alert')).textContent).toContain("Couldn't reach the HOPS server");
	});

	it('Enter (form submit) signs in; success calls onSuccess with the typed credentials', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: false });
		const { onSuccess, onCancel } = open();
		await fill('admin', SECRET);
		await fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		expect(apiLogin).toHaveBeenCalledWith('admin', SECRET);
		expect(onCancel).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(true);
	});

	it('Cancel and Escape call onCancel and never sign in', async () => {
		const { onCancel, onSuccess } = open();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledTimes(1);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onCancel).toHaveBeenCalledTimes(2);
		expect(apiLogin).not.toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it('never logs the password', async () => {
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {})
		);
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		open();
		await fill('admin', SECRET);
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await screen.findByRole('alert');
		for (const s of spies) {
			expect(JSON.stringify(s.mock.calls.map((c) => c.map(String)))).not.toContain(SECRET);
		}
	});

	// Task 4 review follow-ups (Ruling 3).
	it('a failure is shown once, in the dialog: no duplicate error toast', async () => {
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		const seen: string[] = [];
		const unsub = toast.subscribe((list) => list.forEach((t) => seen.push(`${t.type}:${t.message}`)));
		open();
		await fill('admin', 'wrong');
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await screen.findByRole('alert');
		unsub();
		expect(seen.filter((t) => t.startsWith('error:'))).toEqual([]);
	});

	it('after a failed sign-in the password field has the focus again', async () => {
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		open();
		await fill('admin', 'wrong');
		screen.getByLabelText('Password').focus();
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await screen.findByRole('alert');
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Password')));
		expect((screen.getByLabelText('Password') as HTMLInputElement).disabled).toBe(false);
	});

	it('shows the auth store\'s loginError itself (no stale copy); an old error is cleared on open', async () => {
		loginError.set('an old failure from before');
		open();
		expect(screen.queryByRole('alert')).toBeNull();
		apiLogin.mockRejectedValue(new LoginError('unauthorized', 'Sign-in failed — check your username and password.'));
		await fill('admin', 'wrong');
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect((await screen.findByRole('alert')).textContent).toContain('check your username and password');
		loginError.set('Too many sign-in attempts. Wait a minute.');
		await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many sign-in attempts'));
	});

	it('takes an intro line (Settings says what signing in is for)', () => {
		render(LoginDialog, { props: { onSuccess: vi.fn(), onCancel: vi.fn(), intro: 'Sign in to open Settings.' } });
		expect(screen.getByRole('dialog', { name: 'Sign in' }).textContent).toContain('Sign in to open Settings.');
	});
});
