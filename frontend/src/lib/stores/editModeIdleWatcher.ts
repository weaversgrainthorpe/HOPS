import { get } from 'svelte/store';
import { toast } from './toast';
import { editMode } from './editMode';
import { listSettings } from '$lib/utils/api';

// Edit-mode idle timeout.
//
// The login session itself does NOT auto-expire — admins stay signed in until
// they click Logout. What DOES auto-expire is "edit mode": if the admin
// switches it on, walks away, and comes back hours later, they should find
// HOPS quietly back in view mode rather than still wide-open to accidental
// edits.
//
// "Activity" means any pointer/keyboard interaction anywhere on the page.
// On every event we extend the deadline; if the deadline passes without
// activity, edit mode flips off and a non-intrusive toast explains why.
//
// The timeout window comes from the editmode.idle_timeout_minutes admin
// setting (default 15 min). A value of 0 disables the idle timer entirely.
//
// This lives in its own file so editMode.ts and the settings layer can both
// be imported without creating a circular dependency.

let watcherInited = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimeoutMs = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer(): void {
  clearIdleTimer();
  if (idleTimeoutMs <= 0) return; // 0 disables the timer
  idleTimer = setTimeout(() => {
    // Only fire if we're still in edit mode (race: the user may have
    // turned it off manually between arming and firing).
    if (!get(editMode)) return;
    editMode.set(false);
    toast.info('Edit mode timed out — click Edit again to make more changes.');
  }, idleTimeoutMs);
}

function onActivity(): void {
  // Cheap: just re-arm. The timer object is recreated, not extended in
  // place — at typical activity rates (mouse moves dozens of times per
  // second) this is still negligible work compared to what the page
  // already does on each event.
  if (get(editMode)) armIdleTimer();
}

async function refreshTimeoutFromSettings(): Promise<void> {
  try {
    const { settings: list } = await listSettings();
    const def = list.find((s) => s.key === 'editmode.idle_timeout_minutes');
    if (!def) return;
    const minutes = Number(def.value);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    idleTimeoutMs = minutes * 60 * 1000;
  } catch {
    // Settings unreachable — keep whatever value we last had. Default is
    // already a sane 15 min so unauthenticated callers still get reasonable
    // behaviour if they somehow flip edit mode on.
  }
}

/**
 * Wire up the edit-mode idle timeout. Call once from the root layout's
 * onMount. Safe to call multiple times — second call is a no-op.
 */
export function initEditModeIdleWatcher(): void {
  if (watcherInited || typeof window === 'undefined') return;
  watcherInited = true;

  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, onActivity, { passive: true });
  }

  editMode.subscribe((on) => {
    if (on) {
      // Pull the latest setting in case the admin changed it from the
      // settings page since the last edit-mode session — and arm.
      void refreshTimeoutFromSettings().then(armIdleTimer);
    } else {
      clearIdleTimer();
    }
  });
}
