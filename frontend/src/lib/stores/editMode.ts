import { writable, get } from 'svelte/store';
import { isAuthenticated } from './auth';
import { currentRoute } from './config';
import { begin, end, abandon, park, session, setSessionLostHandler } from './editSession';
import { toast } from './toast';
import { logWarn } from '$lib/utils/errors';

// Global edit mode state. Edit mode = an edit session (editSession.ts):
// turning it on begins a session on the route's dashboard; turning it off
// ends the session (asking Save / Discard / Keep editing when dirty).
export const editMode = writable(false);

/** The current route's dashboard id, for either kind (legacy or v3-only). */
export function routeDashboardId(): string | null {
  const r = get(currentRoute);
  if (!r) return null;
  return r.kind === 'missing-layout' ? r.id : r.dashboard.id;
}

export async function toggleEditMode(): Promise<boolean> {
  if (get(editMode)) return disableEditMode();
  return enableEditMode();
}

export function enableEditMode(): boolean {
  // Only allow enabling if authenticated
  if (!get(isAuthenticated)) {
    logWarn('Edit mode requires authentication');
    editMode.set(false);
    return false;
  }
  if (get(editMode) && get(session)) return true;
  const id = routeDashboardId();
  if (!id) {
    toast.error("There's no dashboard here to edit.");
    return false;
  }
  begin(id); // refuses visibly (toast) when it can't start
  if (get(session)?.dashboardId !== id) return false;
  editMode.set(true);
  return true;
}

/**
 * Leave edit mode. With unsaved changes the user picks Save / Discard / Keep
 * editing; returns false (edit mode stays on) for Keep editing or a failed save.
 */
export async function disableEditMode(opts: { message?: string } = {}): Promise<boolean> {
  const ok = await end(opts);
  if (ok) editMode.set(false);
  return ok;
}

/**
 * Keep the session on the route's dashboard while in edit mode: after a
 * navigation (already confirmed by the beforeNavigate guard when there were
 * changes), end the old dashboard's session and begin one on the new
 * dashboard. Off a dashboard page there is no session until the user is back
 * on one. If a session can't begin (visible error), edit mode turns off.
 */
export function followRoute(): void {
  if (!get(editMode)) return;
  const id = routeDashboardId();
  const s = get(session);
  if (s && s.dashboardId === id) return;
  if (s && abandon()) toast.warning('Left the dashboard \u2014 your unsaved changes were discarded.');
  if (!id) return;
  begin(id);
  if (get(session)?.dashboardId !== id) editMode.set(false);
}

// Edit mode switched off from outside (sign-out, a view-only dashboard) ends
// the session too. Dropping unsaved changes this way is said out loud.
editMode.subscribe((on) => {
  if (on) return;
  if (abandon()) toast.warning('Edit mode ended — your unsaved changes were discarded.');
});

// A session that ended unexpectedly (e.g. a failed conflict reload) turns
// edit mode off: edit mode never stays on without a session.
setSessionLostHandler(() => editMode.set(false));

// Automatically disable edit mode when the user is signed out. A dirty draft
// is parked (kept in memory, shown by ParkedDraftBanner) rather than dropped;
// signing back in and entering edit mode on that dashboard restores it.
isAuthenticated.subscribe(authenticated => {
  if (!authenticated) {
    park();
    editMode.set(false);
  }
});
