import { get } from 'svelte/store';
import { checkAuth } from '$lib/utils/api';
import { toast } from './toast';
import { isAuthenticated, mustChangePassword } from './auth';
import { editMode } from './editMode';

// Proactive session-expired detection.
//
// The scenario: user enters edit mode, walks away, comes back hours later
// with edit mode still showing on screen, starts making changes, then
// loses everything when the first save returns 401. The existing 401
// handler in auth.ts kicks in at that point, but the changes are already
// gone.
//
// Fix: check /api/auth/check at moments when the user might be about to
// start interacting again — tab becomes visible, window regains focus,
// and (while in edit mode) once every few minutes — so we exit edit
// mode BEFORE they touch anything.
//
// This lives in its own file so auth.ts and editMode.ts can both depend
// on each other without circular-import drama — neither of them imports
// from here.

const AUTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let authWatcherInited = false;
let editModeAuthTimer: ReturnType<typeof setInterval> | null = null;

async function verifySessionStill(): Promise<void> {
  if (!get(isAuthenticated)) return; // we already think we're not auth'd
  try {
    const status = await checkAuth();
    if (!status.authenticated) {
      // Session expired silently while the user wasn't actively using HOPS.
      // Drop edit mode immediately so the user can't start typing edits
      // that would just vanish on the next save call.
      editMode.set(false);
      isAuthenticated.set(false);
      mustChangePassword.set(false);
      toast.error('Your session expired while you were away. Please sign in again.');
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        setTimeout(() => { window.location.href = '/'; }, 600);
      }
    }
  } catch {
    // Network blip — don't fire a false alarm. The browser online/offline
    // detection in network.ts surfaces real connectivity loss separately.
  }
}

/**
 * Wire up the proactive session-expiry checks. Call once from the root
 * layout's onMount.
 */
export function initAuthWatcher(): void {
  if (authWatcherInited || typeof window === 'undefined') return;
  authWatcherInited = true;

  // Tab becomes visible (user comes back to the tab) → re-check.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifySessionStill();
  });
  // Window regains focus (e.g. user switches back from another window) → re-check.
  window.addEventListener('focus', verifySessionStill);

  // While in edit mode, also re-check on an interval — covers the case
  // where the user has the tab focused but hasn't interacted for a long
  // time, so no API call has fired to surface the 401 yet.
  editMode.subscribe((on) => {
    if (on && !editModeAuthTimer) {
      editModeAuthTimer = setInterval(verifySessionStill, AUTH_CHECK_INTERVAL_MS);
    } else if (!on && editModeAuthTimer) {
      clearInterval(editModeAuthTimer);
      editModeAuthTimer = null;
    }
  });
}
