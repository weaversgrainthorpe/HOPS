import { writable } from 'svelte/store';
import { login as apiLogin, logout as apiLogout, checkAuth, setSessionExpiredHandler } from '$lib/utils/api';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Auth state
export const isAuthenticated = writable(false);
export const isLoggingIn = writable(false);
// True when the current user must change their password before doing anything else
export const mustChangePassword = writable(false);

// Register the global session-expired handler with the API layer.
// Fires when any fetchAPI call hits 401 — clears auth state, toasts
// once, and (if in the browser) sends the user to the login page so
// they don't sit on a broken protected page after their cookie expires.
setSessionExpiredHandler(() => {
  isAuthenticated.set(false);
  mustChangePassword.set(false);
  toast.error('Your session has expired. Please log in again.');
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    // Defer slightly so any pending per-page error handling can show
    // its own context before we redirect.
    setTimeout(() => { window.location.href = '/'; }, 300);
  }
});

// Check if user has a valid session on app load
export async function initAuth() {
  const status = await checkAuth();
  isAuthenticated.set(status.authenticated);
  mustChangePassword.set(status.mustChangePassword);
}

// Login
export async function login(username: string, password: string) {
  isLoggingIn.set(true);

  try {
    const result = await apiLogin(username, password);
    isAuthenticated.set(true);
    mustChangePassword.set(result.mustChangePassword);
    if (result.mustChangePassword) {
      toast.warning('You must change the default password before continuing');
    } else {
      toast.success('Logged in successfully');
    }
    return true;
  } catch (error) {
    logError('Login', error);
    toast.error('Invalid username or password');
    return false;
  } finally {
    isLoggingIn.set(false);
  }
}

// Called by ChangePasswordModal after a successful password change to clear the flag
export function clearMustChangePassword() {
  mustChangePassword.set(false);
}

// Logout
export async function logout() {
  try {
    await apiLogout();
    toast.info('Logged out');
  } catch (error) {
    logError('Logout', error);
  } finally {
    isAuthenticated.set(false);
    mustChangePassword.set(false);
    // Edit mode will automatically disable via its subscription to isAuthenticated
  }
}
