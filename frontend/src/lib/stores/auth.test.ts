import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock the API module BEFORE importing the auth store, so the store
// picks up our mocks rather than the real fetch implementations.
vi.mock('$lib/utils/api', () => ({
	login: vi.fn(),
	logout: vi.fn(),
	checkAuth: vi.fn(),
	// Added to api.ts in v2.0; auth store registers a handler at module
	// load time, so this mock must accept the call or the import explodes.
	setSessionExpiredHandler: vi.fn()
}));

import {
	isAuthenticated,
	isLoggingIn,
	mustChangePassword,
	initAuth,
	login,
	logout,
	clearMustChangePassword
} from './auth';
import { toast } from './toast';
import * as api from '$lib/utils/api';

const mockApi = api as unknown as {
	login: ReturnType<typeof vi.fn>;
	logout: ReturnType<typeof vi.fn>;
	checkAuth: ReturnType<typeof vi.fn>;
};

describe('auth store', () => {
	beforeEach(() => {
		isAuthenticated.set(false);
		isLoggingIn.set(false);
		mustChangePassword.set(false);
		toast.clear();
		mockApi.login.mockReset();
		mockApi.logout.mockReset();
		mockApi.checkAuth.mockReset();
	});

	describe('initAuth', () => {
		it('sets isAuthenticated from checkAuth result', async () => {
			mockApi.checkAuth.mockResolvedValue({
				authenticated: true,
				mustChangePassword: false
			});

			await initAuth();

			expect(get(isAuthenticated)).toBe(true);
			expect(get(mustChangePassword)).toBe(false);
		});

		it('reflects mustChangePassword flag from server', async () => {
			mockApi.checkAuth.mockResolvedValue({
				authenticated: true,
				mustChangePassword: true
			});

			await initAuth();

			expect(get(mustChangePassword)).toBe(true);
		});

		it('leaves user unauthenticated when no session', async () => {
			mockApi.checkAuth.mockResolvedValue({
				authenticated: false,
				mustChangePassword: false
			});

			await initAuth();

			expect(get(isAuthenticated)).toBe(false);
		});
	});

	describe('login', () => {
		it('returns true and sets authenticated on success', async () => {
			mockApi.login.mockResolvedValue({ mustChangePassword: false });

			const result = await login('admin', 'password');

			expect(result).toBe(true);
			expect(get(isAuthenticated)).toBe(true);
			expect(mockApi.login).toHaveBeenCalledWith('admin', 'password');
		});

		it('returns false and stays unauthenticated on error', async () => {
			mockApi.login.mockRejectedValue(new Error('Invalid credentials'));

			const result = await login('admin', 'wrong');

			expect(result).toBe(false);
			expect(get(isAuthenticated)).toBe(false);
		});

		it('shows error toast on failure', async () => {
			mockApi.login.mockRejectedValue(new Error('Invalid credentials'));

			await login('admin', 'wrong');

			const toasts = get(toast);
			expect(toasts.some((t) => t.type === 'error')).toBe(true);
		});

		it('shows success toast on success', async () => {
			mockApi.login.mockResolvedValue({ mustChangePassword: false });

			await login('admin', 'password');

			const toasts = get(toast);
			expect(toasts.some((t) => t.type === 'success')).toBe(true);
		});

		it('shows warning toast when must change password', async () => {
			mockApi.login.mockResolvedValue({ mustChangePassword: true });

			await login('admin', 'admin');

			const toasts = get(toast);
			expect(toasts.some((t) => t.type === 'warning')).toBe(true);
			expect(get(mustChangePassword)).toBe(true);
		});

		it('toggles isLoggingIn during the call', async () => {
			let inFlight: boolean | undefined;
			mockApi.login.mockImplementation(async () => {
				inFlight = get(isLoggingIn);
				return { mustChangePassword: false };
			});

			expect(get(isLoggingIn)).toBe(false);
			await login('admin', 'password');

			expect(inFlight).toBe(true);
			expect(get(isLoggingIn)).toBe(false);
		});

		it('resets isLoggingIn even on failure', async () => {
			mockApi.login.mockRejectedValue(new Error('boom'));

			await login('admin', 'wrong');

			expect(get(isLoggingIn)).toBe(false);
		});
	});

	describe('logout', () => {
		beforeEach(() => {
			isAuthenticated.set(true);
			mustChangePassword.set(true);
		});

		it('clears authentication state', async () => {
			mockApi.logout.mockResolvedValue(undefined);

			await logout();

			expect(get(isAuthenticated)).toBe(false);
			expect(get(mustChangePassword)).toBe(false);
		});

		it('clears state even when API call fails', async () => {
			mockApi.logout.mockRejectedValue(new Error('network error'));

			await logout();

			// Frontend must always clear local state — server might be unreachable
			// but the user expects to be logged out
			expect(get(isAuthenticated)).toBe(false);
		});

		it('shows info toast on successful logout', async () => {
			mockApi.logout.mockResolvedValue(undefined);

			await logout();

			expect(get(toast).some((t) => t.type === 'info')).toBe(true);
		});
	});

	describe('clearMustChangePassword', () => {
		it('clears the flag', () => {
			mustChangePassword.set(true);
			clearMustChangePassword();
			expect(get(mustChangePassword)).toBe(false);
		});

		it('is safe to call when already false', () => {
			mustChangePassword.set(false);
			clearMustChangePassword();
			expect(get(mustChangePassword)).toBe(false);
		});
	});
});
