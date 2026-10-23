import { writable } from 'svelte/store';
import { login as apiLogin, logout as apiLogout, checkAuth, setSessionExpiredHandler, LoginError } from '$lib/utils/api';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';
import { end as endEditSession } from './editSession';

// Auth state
export const isAuthenticated = writable(false);
export const isLoggingIn = writable(false);
// The last sign-in failure, in words for the user ('' when the last attempt
// succeeded or none was made). Lets a form show the reason inline, not only
// in the toast.
export const loginError = writable('');
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

/** Settings, the admin home: /settings and each of its pages (M5 §9). */
export function isSettingsPath(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings/');
}

// Paths that require an authenticated admin: Settings (the admin home) and the
// tools under /admin.
export function isAdminOnlyPath(path: string): boolean {
  return isSettingsPath(path) || path === '/admin' || path.startsWith('/admin/');
}

/**
 * Where a page goes when its session expires: null = stay. A dashboard stays
 * (HOPS dashboards work anonymously; the navbar flips to signed out). Every Settings
 * page stays too: it asks for the password again in place. The other admin pages
 * can't work signed out and have no sign-in of their own, so they go to Settings
 * to sign in there (as a signed-out visit to them does), not to / (which forwards
 * to a dashboard with no sign-in prompt).
 */
export function sessionExpiredRedirect(path: string): string | null {
  if (isSettingsPath(path)) return null;
  return isAdminOnlyPath(path) ? '/settings' : null;
}

// Register the global session-expired handler with the API layer.
// Fires when any fetchAPI call hits 401 — clears auth state, toasts
// once, and leaves only a page that can't work signed out.
setSessionExpiredHandler(() => {
  isAuthenticated.set(false);
  mustChangePassword.set(false);
  toast.info('You’ve been signed out — dashboards are still browseable. Click Sign in when you want to make changes.');
  const target = typeof window !== 'undefined' ? sessionExpiredRedirect(window.location.pathname) : null;
  if (target) {
    // Defer slightly so any pending per-page error handling can show
    // its own context before we move.
    setTimeout(() => { window.location.href = target; }, 300);
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

/**
 * Run `fn` once the signed-in user may act: right away, or — when a forced password change is
 * pending (its dialog can't be dismissed) — as soon as it is done. Dropped if the session ends
 * first. Returns a function that cancels the wait.
 */
export function whenPasswordSettled(fn: () => void): () => void {
  let done = false;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    done = true;
    if (unsubscribe) { const u = unsubscribe; unsubscribe = null; u(); }
  };
  const check = () => {
    if (done) return;
    if (!authenticatedValue) { stop(); return; }
    if (!mustChangeValue) { stop(); fn(); }
  };
  const unA = isAuthenticated.subscribe(() => check());
  const unM = mustChangePassword.subscribe(() => check());
  unsubscribe = () => { unA(); unM(); };
  if (done) stop();
  return stop;
}

let authenticatedValue = false;
isAuthenticated.subscribe((v) => { authenticatedValue = v; });
let mustChangeValue = false;
mustChangePassword.subscribe((v) => { mustChangeValue = v; });

// Login. `quietErrors`: the caller shows the failure itself (the sign-in dialog shows
// $loginError inline), so no second copy goes to a toast.
export async function login(username: string, password: string, opts: { quietErrors?: boolean } = {}) {
  isLoggingIn.set(true);
  loginError.set('');

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
    const message = error instanceof LoginError && error.message ? error.message : 'Sign-in failed. Try again.';
    loginError.set(message);
    if (!opts.quietErrors) toast.error(message);
    return false;
  } finally {
    isLoggingIn.set(false);
  }
}

// Called by ChangePasswordModal after a successful password change to clear the flag
export function clearMustChangePassword() {
  mustChangePassword.set(false);
}

// Logout. With unsaved edit-session changes the user is asked first (Save /
// Discard / Keep editing); Keep editing, or a save that fails, cancels the
// logout and returns false.
export async function logout(): Promise<boolean> {
  if (!(await endEditSession({ message: 'Save your changes to this dashboard before signing out?' }))) {
    return false;
  }
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
  return true;
}
