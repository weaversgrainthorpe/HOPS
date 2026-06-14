import { writable } from 'svelte/store';
import { login as apiLogin, logout as apiLogout, checkAuth, setSessionExpiredHandler, LoginError } from '$lib/utils/api';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Auth state
export const isAuthenticated = writable(false);
export const isLoggingIn = writable(false);
// True when the current user must change their password before doing anything else
export const mustChangePassword = writable(false);
// True once initAuth() has resolved at least once. Protected pages should
// wait for this before deciding to redirect on !isAuthenticated — otherwise
// they race the initial /api/auth/check call and bounce the user back to / .
export const authChecked = writable(false);

/**
 * Block until initAuth() has resolved. Protected pages call this at the
 * top of their onMount before they read isAuthenticated, so a freshly
 * loaded page doesn't redirect to / while the initial /api/auth/check
 * is still in flight.
 */
export async function waitForAuthChecked(): Promise<void> {
  if (authCheckedValue) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = authChecked.subscribe((v) => {
      if (v) {
        // Defer unsubscribe so we don't tear down inside the subscribe
        // callback itself (Svelte fires it synchronously with the current
        // value when you subscribe).
        setTimeout(() => unsubscribe(), 0);
        resolve();
      }
    });
  });
}

// Mirror the latest value of `authChecked` into a plain variable so the
// fast path in waitForAuthChecked() doesn't have to spin up a subscriber.
let authCheckedValue = false;
authChecked.subscribe((v) => { authCheckedValue = v; });

// Paths that require an authenticated admin. If the session expires
// while the user is on one of these, we redirect them to the dashboard
// root — sitting on a broken settings page with all API calls 401-ing
// is a worse experience than seeing the public dashboard with the
// navbar flipped to "Sign in". From any non-admin path (the dashboards
// themselves) we just clear state and let the navbar reflect it — the
// user keeps seeing their dashboard in anonymous read-only mode.
function isAdminOnlyPath(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings/') || path === '/admin' || path.startsWith('/admin/');
}

// Register the global session-expired handler with the API layer.
// Fires when any fetchAPI call hits 401 — clears auth state, toasts
// once. We do NOT pull the user away from a dashboard they're viewing;
// HOPS dashboards work fine anonymously.
setSessionExpiredHandler(() => {
  isAuthenticated.set(false);
  mustChangePassword.set(false);
  toast.info('You’ve been signed out — dashboards are still browseable. Click Sign in when you want to make changes.');
  if (typeof window !== 'undefined' && isAdminOnlyPath(window.location.pathname)) {
    // The current page genuinely requires auth (settings, admin tools).
    // Defer slightly so any pending per-page error handling can show
    // its own context before we move.
    setTimeout(() => { window.location.href = '/'; }, 300);
  }
});

// Check if user has a valid session on app load
export async function initAuth() {
  try {
    const status = await checkAuth();
    isAuthenticated.set(status.authenticated);
    mustChangePassword.set(status.mustChangePassword);
  } finally {
    // Whether the call succeeded or failed, the check has resolved —
    // protected pages can stop waiting and act on isAuthenticated now.
    authChecked.set(true);
  }
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
    if (error instanceof LoginError) {
      toast.error(error.message);
    } else {
      toast.error('Sign-in failed. Try again.');
    }
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
