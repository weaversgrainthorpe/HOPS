import { get } from 'svelte/store';
import { toast } from './toast';
import { editMode, disableEditMode, routeDashboardId } from './editMode';
import { dirty } from './editSession';
import { listSettings, getDashboardSettings } from '$lib/utils/api';
import { currentRoute } from './config';

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
// With UNSAVED changes it never discards on its own: it asks Save / Discard /
// Keep editing and waits (Tenet 5); Keep editing re-arms the timer.
//
// The timeout window comes from the editmode.idle_timeout_minutes admin
// setting (default 15 min). A value of 0 disables the idle timer entirely.
//
// This lives in its own file so editMode.ts and the settings layer can both
// be imported without creating a circular dependency.

let watcherInited = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimeoutMs = 15 * 60 * 1000;
// True while the idle Save/Discard prompt is open: activity over the dialog
// must not re-arm the timer (which would stack a second prompt).
let prompting = false;

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
    idleTimer = null;
    void onIdle();
  }, idleTimeoutMs);
}

async function onIdle(): Promise<void> {
  // Only fire if we're still in edit mode (race: the user may have
  // turned it off manually between arming and firing).
  if (!get(editMode) || prompting) return;
  if (!get(dirty)) {
    await disableEditMode();
    toast.info('Edit mode timed out — click Edit again to make more changes.');
    return;
  }
  prompting = true;
  try {
    const ended = await disableEditMode({
      message: 'Edit mode timed out with unsaved changes. Save them, discard them, or keep editing?'
    });
    if (!ended && get(editMode)) armIdleTimer();
  } finally {
    prompting = false;
  }
}

function onActivity(): void {
  // Cheap: just re-arm. The timer object is recreated, not extended in
  // place — at typical activity rates (mouse moves dozens of times per
  // second) this is still negligible work compared to what the page
  // already does on each event.
  if (get(editMode) && !prompting) armIdleTimer();
}

/** Current idle timeout in ms (exposed for tests). */
export function getIdleTimeoutMs(): number {
  return idleTimeoutMs;
}

async function refreshFromGlobalSetting(): Promise<void> {
  try {
    const { settings: list } = await listSettings();
    const def = list.find((s) => s.key === 'editmode.idle_timeout_minutes');
    if (!def) {
      console.warn('Global edit-mode idle timeout setting is missing; keeping the previous timeout');
      return;
    }
    const minutes = Number(def.value);
    if (!Number.isFinite(minutes) || minutes < 0) {
      console.warn('Global edit-mode idle timeout is not a valid number; keeping the previous timeout');
      return;
    }
    idleTimeoutMs = minutes * 60 * 1000;
  } catch (e) {
    // Settings unreachable — keep whatever value we last had (default is a
    // sane 15 min), but say so.
    console.warn('Could not load the global edit-mode idle timeout; keeping the previous timeout', e);
  }
}

// The timeout is per dashboard (effective = override or inherited global),
// for the route's dashboard. With no current dashboard, or if
// the per-dashboard lookup fails, fall back to the global setting; a failure
// is warned about, not silently swallowed.
export async function refreshTimeoutFromSettings(): Promise<void> {
  const id = routeDashboardId();
  if (id) {
    try {
      const resp = await getDashboardSettings(id);
      const minutes = Number(resp.effective.editIdleTimeoutMinutes);
      if (Number.isFinite(minutes) && minutes >= 0) {
        idleTimeoutMs = minutes * 60 * 1000;
        return;
      }
      console.warn('Dashboard idle timeout was not a valid number; using the global setting');
    } catch (e) {
      console.warn('Could not load dashboard settings for the edit-mode idle timeout; using the global setting', e);
    }
  }
  await refreshFromGlobalSetting();
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

  // Re-resolve the timeout while in edit mode when the current dashboard
  // changes, or its settings are saved (the saved document replaces them).
  let lastKey: string | null = null;
  currentRoute.subscribe((r) => {
    const key = r ? `${r.id}:${JSON.stringify(r.settings ?? null)}` : null;
    const changed = key !== lastKey;
    lastKey = key;
    if (changed && get(editMode)) {
      void refreshTimeoutFromSettings().then(() => {
        if (get(editMode)) armIdleTimer();
      });
    }
  });
}
