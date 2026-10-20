import { writable, derived, get, type Readable } from 'svelte/store';
import type { LayoutDashboard } from '$lib/types/layout';
import { saveDashboardV3, ConflictError, MigrationFailedError } from '$lib/utils/api';
import { TreeOpError } from '$lib/editor/treeOps';
import {
  layoutDoc,
  layoutStale,
  findLayoutDashboard,
  applySavedLayout,
  loadConfig,
  configError,
  migrationFailure
} from './config';
import { confirm, confirmChoice } from './confirmModal';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Edit session (Tenet 5, parent spec §7.1).
//
// Entering edit mode starts a session: a local DRAFT of one dashboard, taken
// from the stored v3 layout (layoutDoc — never the per-browser folder view).
// Every edit applies to the draft only; nothing reaches the server before
// save(). Discard restores the saved dashboard exactly and sends nothing.
// This store is the only thing that saves a session.

export interface EditSession {
  dashboardId: string;
  baseRevision: number;
  saved: LayoutDashboard;
  draft: LayoutDashboard;
  undo: LayoutDashboard[];
  redo: LayoutDashboard[];
  lastLabel?: string;
}

const UNDO_CAP = 100;

const state = writable<EditSession | null>(null);
export const session: Readable<EditSession | null> = { subscribe: state.subscribe };

/**
 * Structural equality, independent of key order. A key holding `undefined`
 * counts as absent (it does not survive the JSON the server stores).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/** The draft differs from the saved dashboard (the stored `revision` number is bookkeeping, not content). */
function isDirty(s: EditSession | null): boolean {
  if (!s) return false;
  return !deepEqual({ ...s.draft, revision: 0 }, { ...s.saved, revision: 0 });
}

export const dirty: Readable<boolean> = derived(state, isDirty);

/**
 * Set when a session save was refused because the dashboard changed somewhere
 * else (HTTP 409). The draft is untouched. ConflictBanner shows it with
 * "Reload (lose my draft)" and "Keep editing".
 */
export const sessionConflict = writable<{ dashboardId: string; currentRevision: number } | null>(null);

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function close(): void {
  state.set(null);
  sessionConflict.set(null);
}

/**
 * Start a session on a dashboard, from the stored layout. Refuses — with a
 * visible error, leaving no session — when the layout is stale (refreshing)
 * or missing, or the dashboard is not in it. Beginning the dashboard that is
 * already open keeps the existing session.
 */
export function begin(dashboardId: string): void {
  const cur = get(state);
  if (cur && cur.dashboardId === dashboardId) return;
  if (cur && isDirty(cur)) {
    toast.error('Save or discard your changes to the other dashboard first.');
    return;
  }
  if (get(layoutStale)) {
    toast.error("The layout is refreshing, so editing can't start yet. Try again in a moment.");
    return;
  }
  const doc = get(layoutDoc);
  if (!doc) {
    toast.error("The dashboard layout hasn't loaded, so editing can't start. Reload the page.");
    return;
  }
  const d = findLayoutDashboard(dashboardId, doc);
  if (!d) {
    toast.error("This dashboard is missing from the stored layout, so editing can't start. Reload the page.");
    return;
  }
  if (typeof d.revision !== 'number') {
    toast.error("This dashboard has no known revision, so editing can't start. Reload the page.");
    return;
  }
  sessionConflict.set(null);
  state.set({
    dashboardId,
    baseRevision: d.revision,
    saved: clone(d),
    draft: clone(d),
    undo: [],
    redo: []
  });
}

/**
 * Apply one operation to the draft. The previous draft goes on the undo stack
 * (at most 100) and redo is cleared. A refused operation (TreeOpError) is
 * toasted with its message and leaves the draft unchanged; so does any other
 * failure.
 */
export function apply(label: string, op: (d: LayoutDashboard) => LayoutDashboard): void {
  const s = get(state);
  if (!s) {
    toast.error('Not editing: click Edit first.');
    return;
  }
  let next: LayoutDashboard;
  try {
    next = op(s.draft);
  } catch (e) {
    if (e instanceof TreeOpError) {
      toast.error(e.message);
    } else {
      logError(`Edit "${label}"`, e);
      toast.error(e instanceof Error && e.message ? `That change failed: ${e.message}` : 'That change failed.');
    }
    return;
  }
  if (next === s.draft) return; // nothing changed: no undo step
  state.set({
    ...s,
    draft: next,
    undo: [...s.undo, s.draft].slice(-UNDO_CAP),
    redo: [],
    lastLabel: label
  });
}

export function undo(): void {
  const s = get(state);
  if (!s || s.undo.length === 0) return;
  state.set({
    ...s,
    draft: s.undo[s.undo.length - 1],
    undo: s.undo.slice(0, -1),
    redo: [...s.redo, s.draft]
  });
}

export function redo(): void {
  const s = get(state);
  if (!s || s.redo.length === 0) return;
  state.set({
    ...s,
    draft: s.redo[s.redo.length - 1],
    redo: s.redo.slice(0, -1),
    undo: [...s.undo, s.draft].slice(-UNDO_CAP)
  });
}

let inFlight: Promise<'saved' | 'conflict' | 'error'> | null = null;

/**
 * Save the draft in one revision-checked write. Success: the draft becomes the
 * saved state at the server's new revision and the response's layout goes into
 * the config store. Conflict (409): the draft and session stay exactly as they
 * are and the conflict banner is raised. Any other failure is toasted and
 * keeps the draft. A clean draft sends nothing.
 */
export function save(): Promise<'saved' | 'conflict' | 'error'> {
  if (inFlight) return inFlight;
  inFlight = doSave().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSave(): Promise<'saved' | 'conflict' | 'error'> {
  const s = get(state);
  if (!s) {
    toast.error('Nothing to save: not editing.');
    return 'error';
  }
  if (!isDirty(s)) return 'saved';
  const sent = s.draft;
  try {
    const resp = await saveDashboardV3(s.dashboardId, sent, s.baseRevision);
    const cur = get(state);
    if (cur && cur.dashboardId === s.dashboardId) {
      const saved = { ...sent, revision: resp.revision };
      state.set({
        ...cur,
        baseRevision: resp.revision,
        saved,
        // Edits made while the save was in flight stay in the draft (and dirty).
        draft: cur.draft === sent ? saved : cur.draft
      });
    }
    sessionConflict.set(null);
    applySavedLayout(resp);
    toast.success('Changes saved');
    if (resp.warning) toast.warning(resp.warning);
    return 'saved';
  } catch (error) {
    logError('Dashboard save', error);
    if (error instanceof ConflictError) {
      sessionConflict.set({ dashboardId: s.dashboardId, currentRevision: error.currentRevision });
      toast.error('Not saved — changed somewhere else');
      return 'conflict';
    }
    if (error instanceof MigrationFailedError) {
      migrationFailure.set(error.detail);
    }
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      toast.error('Your session has expired. Your changes were not saved — log in again.');
    } else {
      toast.error(error instanceof Error && error.message ? `Failed to save changes: ${error.message}` : 'Failed to save changes');
    }
    return 'error';
  }
}

/**
 * Throw the draft away: it becomes the saved dashboard again, exactly, and
 * nothing is sent. Asks first when there are changes (unless
 * `confirm: false`). The session stays open. Returns false if the user chose
 * to keep the changes.
 */
export async function discard(opts: { confirm?: boolean } = {}): Promise<boolean> {
  const s = get(state);
  if (!s) return true;
  if (isDirty(s) && opts.confirm !== false) {
    const ok = await confirm({
      title: 'Discard changes?',
      message: 'Your unsaved changes to this dashboard will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      confirmStyle: 'danger'
    });
    if (!ok) return false;
  }
  const cur = get(state);
  if (!cur) return true;
  state.set({ ...cur, draft: clone(cur.saved), undo: [], redo: [], lastLabel: undefined });
  return true;
}

/**
 * End the session. With unsaved changes, asks Save / Discard / Keep editing:
 * Save ends only if the save succeeds; Keep editing (or a failed save) keeps
 * the session and returns false. A clean session ends silently.
 */
export async function end(opts: { message?: string } = {}): Promise<boolean> {
  const s = get(state);
  if (!s) return true;
  if (!isDirty(s)) {
    close();
    return true;
  }
  const choice = await confirmChoice({
    title: 'Unsaved changes',
    message: opts.message ?? 'Save your changes to this dashboard before leaving edit mode?',
    confirmText: 'Save',
    confirmStyle: 'primary',
    alternateText: 'Discard',
    alternateStyle: 'danger',
    cancelText: 'Keep editing'
  });
  if (choice === 'cancel') return false;
  if (choice === 'confirm') {
    const r = await save();
    if (r !== 'saved') return false;
    // An edit made while the save was in flight is still unsaved: keep editing.
    if (isDirty(get(state))) return false;
  }
  close();
  return true;
}

/**
 * Drop the session without asking. Only for when the user has already chosen
 * to leave (navigation confirmed, signed out) or edit mode was switched off
 * from outside. Returns true if unsaved changes were dropped.
 */
export function abandon(): boolean {
  const wasDirty = isDirty(get(state));
  close();
  return wasDirty;
}

/** Conflict banner: keep editing. The draft and session stay exactly as they are. */
export function keepEditingAfterConflict(): void {
  sessionConflict.set(null);
}

/**
 * Conflict banner: reload (lose my draft). Ends the session, reloads the
 * config, and — if the reload succeeded — starts a fresh session on the
 * reloaded dashboard so editing can continue from the current state.
 */
export async function reloadAfterConflict(): Promise<void> {
  const id = get(state)?.dashboardId;
  close();
  await loadConfig();
  if (id && get(configError) === null) begin(id);
}

/** The subset of SvelteKit's BeforeNavigate that guardNavigation uses. */
export interface NavigationLike {
  willUnload: boolean;
  to: { url: URL } | null;
  cancel: () => void;
}

/**
 * beforeNavigate guard. With unsaved changes: a page unload (reload, close,
 * external link) is cancelled, which makes the browser ask "leave site?"; an
 * in-app navigation is cancelled and the user asked in the app's own dialog —
 * leaving anyway discards the draft and then navigates via `go`. Returns
 * true when it cancelled the navigation.
 */
export function guardNavigation(nav: NavigationLike, go: (href: string) => Promise<void>): boolean {
  if (!get(dirty)) return false;
  nav.cancel();
  if (nav.willUnload || !nav.to) return true;
  const url = nav.to.url;
  const href = url.pathname + url.search + url.hash;
  void confirm({
    title: 'Leave without saving?',
    message: 'You have unsaved changes to this dashboard. If you leave now, they will be discarded.',
    confirmText: 'Leave',
    cancelText: 'Stay',
    confirmStyle: 'danger'
  }).then(async (leave) => {
    if (!leave) return;
    abandon();
    try {
      await go(href);
    } catch (e) {
      logError('Navigation', e);
      toast.error('Could not open that page.');
    }
  });
  return true;
}

/** beforeunload guard (native "leave site?" prompt while there are unsaved changes). */
export function guardUnload(e: BeforeUnloadEvent): void {
  if (!get(dirty)) return;
  e.preventDefault();
  e.returnValue = '';
}
