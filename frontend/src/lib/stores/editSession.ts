import { writable, derived, get, type Readable } from 'svelte/store';
import type { LayoutDashboard, LayoutDoc } from '$lib/types/layout';
import { saveDashboardV3, ConflictError, MigrationFailedError } from '$lib/utils/api';
import { TreeOpError } from '$lib/editor/treeOps';
import { boundsProblem } from '$lib/editor/bounds';
import {
  layoutDoc,
  layoutStale,
  findLayoutDashboard,
  applySavedLayout,
  loadConfig,
  configError,
  noteMigrationFailure,
  setSettingsSavedHook,
  config,
  layoutFormProblem,
  showSaveWarning
} from './config';
import { confirm, confirmChoice } from './confirmModal';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Edit session (Tenet 5).
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

/**
 * A dirty draft kept in memory after the user was signed out (session expiry
 * or sign-out while editing). Nothing is lost: after signing in, entering edit
 * mode on that dashboard restores it — with its original base revision, so a
 * change made elsewhere meanwhile takes the normal conflict path.
 * ParkedDraftBanner shows it persistently.
 */
const parkedState = writable<EditSession | null>(null);
export const parkedDraft: Readable<EditSession | null> = { subscribe: parkedState.subscribe };
export const hasParkedDraft: Readable<boolean> = derived(parkedState, (p) => p !== null);

// Called when a session ends unexpectedly (a conflict reload that failed or
// could not restart the session), so edit mode never stays on with no
// session. editMode.ts registers it; editSession cannot import editMode.
let sessionLostHandler: (() => void) | null = null;
export function setSessionLostHandler(fn: (() => void) | null): void {
  sessionLostHandler = fn;
}

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
  const parked = get(parkedState);
  if (parked && parked.dashboardId === dashboardId) {
    parkedState.set(null);
    sessionConflict.set(null);
    state.set(parked);
    toast.info('Your unsaved changes are back. Save them when you are ready.');
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
  // draft starts as the same object as saved: operations are pure, so an
  // unchanged subtree stays the same reference and the dirty check skips it.
  const saved = clone(d);
  state.set({
    dashboardId,
    baseRevision: d.revision,
    saved,
    draft: saved,
    undo: [],
    redo: []
  });
}

/**
 * Apply one operation to the draft. The previous draft goes on the undo stack
 * (at most 100) and redo is cleared. A refused operation (TreeOpError) is
 * toasted with its message and leaves the draft unchanged; so does any other
 * failure. Returns false when the operation was refused or failed.
 */
export function apply(label: string, op: (d: LayoutDashboard) => LayoutDashboard): boolean {
  const s = get(state);
  if (!s) {
    toast.error('Not editing: click Edit first.');
    return false;
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
    return false;
  }
  if (next === s.draft) return true; // nothing changed: no undo step
  // A change that a save would refuse (too deep, too many items or tabs) is refused now, saying why.
  const tooBig = boundsProblem(s.draft, next);
  if (tooBig) {
    toast.error(tooBig);
    return false;
  }
  state.set({
    ...s,
    draft: next,
    undo: [...s.undo, s.draft].slice(-UNDO_CAP),
    redo: [],
    lastLabel: label
  });
  return true;
}

/**
 * A change was written to the server outside the draft (a cross-dashboard
 * transfer, only allowed while the session is clean). Restart the clean
 * session from the fresh layout so its base revision is current. Returns
 * false (and changes nothing) when the session is dirty or the dashboard is
 * missing from the layout.
 */
export function rebaseCleanSession(layout: LayoutDoc | undefined): boolean {
  const s = get(state);
  if (!s || isDirty(s) || !layout) return false;
  const d = findLayoutDashboard(s.dashboardId, layout);
  if (!d || typeof d.revision !== 'number') return false;
  const saved = clone(d);
  state.set({ ...s, baseRevision: d.revision, saved, draft: saved, undo: [], redo: [], lastLabel: undefined });
  return true;
}

/**
 * The layout store brought a NEWER revision of the session's dashboard (a
 * reload after another dashboard's 409, the generic conflict banner's Reload,
 * any background refresh). A CLEAN session follows it at once, visibly, so it
 * never keeps showing the older tree as current. A dirty session is left
 * alone: its Save takes the normal conflict path. Checked one microtask after
 * the store changes, so our own writes — which update the session's base
 * revision synchronously after updating the store (save, transfer rebase,
 * settings absorb) — are never mistaken for a change made elsewhere.
 */
function followLayout(): void {
  const s = get(state);
  if (!s || isDirty(s) || get(layoutStale)) return;
  const d = findLayoutDashboard(s.dashboardId, get(layoutDoc));
  if (!d || typeof d.revision !== 'number' || d.revision <= s.baseRevision) return;
  const known = externalSave && externalSave.dashboardId === s.dashboardId && d.revision >= externalSave.revision ? externalSave : null;
  if (rebaseCleanSession(get(layoutDoc) ?? undefined)) {
    if (known) externalSave = null;
    toast.info(known?.message ?? 'This dashboard was changed somewhere else; you are now editing the latest version.');
  }
}

let externalSave: { dashboardId: string; revision: number; message: string } | null = null;

/**
 * A save of `dashboardId` at `revision` was made from another tab that said why (Add to HOPS).
 * When the clean session follows that revision, its notice says `message` instead of the generic one.
 */
export function expectExternalSave(dashboardId: string, revision: number, message: string): void {
  externalSave = { dashboardId, revision, message };
}
layoutDoc.subscribe(() => queueMicrotask(followLayout));

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
//
// A save already in flight is shared: a second caller gets the SAME promise,
// whose result describes the draft that was sent first. Edits made after that
// draft was sent are not part of it and stay dirty (callers that need them
// saved, like end(), check dirty again afterwards).
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
  const formProblem = layoutFormProblem(get(config));
  if (formProblem) {
    // Never write this layout form into a document of another version. The draft is kept.
    toast.error(formProblem);
    return 'error';
  }
  const sent = s.draft;
  try {
    const resp = await saveDashboardV3(s.dashboardId, sent, s.baseRevision);
    const cur = get(state);
    if (cur && cur.dashboardId === s.dashboardId) {
      // Prefer the server's normalised copy of what it stored.
      const stored = resp.layout ? findLayoutDashboard(s.dashboardId, resp.layout) : undefined;
      let saved = stored ? clone(stored) : { ...sent, revision: resp.revision };
      // Nothing edited during the save and the server stored exactly what was
      // sent: keep the SAME draft object (a drag in progress or an Undo toast
      // identifies the draft by reference; a fresh copy would cancel them).
      // Only its revision is brought up to date — not content, and nothing
      // else holds that object as a different state.
      if (cur.draft === sent && deepEqual({ ...saved, revision: 0 }, { ...sent, revision: 0 })) {
        if (!Object.isFrozen(sent)) sent.revision = resp.revision;
        saved = sent;
      }
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
    if (resp.warning) showSaveWarning(resp.warning);
    return 'saved';
  } catch (error) {
    logError('Dashboard save', error);
    if (error instanceof ConflictError) {
      sessionConflict.set({ dashboardId: s.dashboardId, currentRevision: error.currentRevision });
      toast.error('Not saved — changed somewhere else');
      return 'conflict';
    }
    if (error instanceof MigrationFailedError) {
      noteMigrationFailure(error);
    }
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      toast.error(
        get(parkedState)
          ? 'You were signed out, so your changes were not saved. They are kept — sign in to save them.'
          : 'Your session has expired. Your changes were not saved — sign in again.'
      );
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
  // A save in flight settles first: discarding under it would toast "Changes
  // saved" right after the user chose Discard.
  if (inFlight && (await settleSave())) return true;
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
    if (inFlight && (await settleSave(true))) return true;
  }
  const cur = get(state);
  if (!cur) return true;
  state.set({ ...cur, draft: cur.saved, undo: [], redo: [], lastLabel: undefined });
  return true;
}

/**
 * End the session. With unsaved changes, asks Save / Discard / Keep editing:
 * Save ends only if the save succeeds; Keep editing (or a failed save) keeps
 * the session and returns false. A clean session ends silently.
 */
export async function end(opts: { message?: string } = {}): Promise<boolean> {
  // Let a save in flight settle before asking: its result decides whether
  // there is anything left to save or discard (it toasts its own outcome).
  if (inFlight) await inFlight;
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
  // Discard chosen while a save started meanwhile: wait for it and say what it did.
  if (choice === 'alternate' && inFlight) await settleSave(true);
  close();
  return true;
}

/**
 * For a Discard: wait for a save in flight, if any, and tell the truth about
 * it — a save that landed cannot be discarded. Returns true when that save
 * left the session clean (there is nothing left to discard; the user is told
 * so). When `afterChoice` (the user already confirmed Discard) and the save
 * covered only part of the draft (edits arrived meanwhile), says that only the
 * later edits are being discarded.
 */
async function settleSave(afterChoice = false): Promise<boolean> {
  if (!inFlight) return false;
  const r = await inFlight;
  if (r !== 'saved') return false;
  const s = get(state);
  if (s && !isDirty(s)) {
    toast.info('Your changes were already saved, so there was nothing to discard.');
    return true;
  }
  if (s && afterChoice) {
    toast.info('Your changes were already saved up to when you pressed Save; only the later edits were discarded.');
  }
  return false;
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

/**
 * The user was signed out. A dirty draft is parked (kept in memory with its
 * undo history and base revision) instead of being dropped; a clean session
 * just ends. Returns true when a draft was parked.
 */
export function park(): boolean {
  const s = get(state);
  close();
  if (!s || !isDirty(s)) return false;
  parkedState.set(s);
  return true;
}

/** Throw away a parked draft (asks first). */
export async function discardParked(): Promise<boolean> {
  if (!get(parkedState)) return true;
  const ok = await confirm({
    title: 'Discard kept changes?',
    message: 'The unsaved changes kept from before you were signed out will be lost.',
    confirmText: 'Discard',
    cancelText: 'Keep them',
    confirmStyle: 'danger'
  });
  if (ok) parkedState.set(null);
  return ok;
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
  if (get(configError) !== null) {
    toast.error("Couldn't reload the dashboard, so edit mode has been turned off.");
  } else if (id) {
    begin(id); // refuses visibly if it can't start
  }
  if (!get(state)) sessionLostHandler?.();
}

/** The in-app "Add to HOPS" page, which an edit session survives (editMode.followRoute too). */
export function isAddPage(url: URL): boolean {
  return url.pathname === '/add' && (typeof location === 'undefined' || url.origin === location.origin);
}

/** The subset of SvelteKit's BeforeNavigate that guardNavigation uses. */
export interface NavigationLike {
  willUnload: boolean;
  to: { url: URL } | null;
  cancel: () => void;
  type?: string;
  delta?: number;
}

/**
 * beforeNavigate guard. With unsaved changes: a page unload (reload, close,
 * external link) is cancelled, which makes the browser ask "leave site?"; an
 * in-app navigation is cancelled and the user asked in the app's own dialog —
 * leaving anyway discards the draft and then navigates via `go`. Returns
 * true when it cancelled the navigation. `toDashboardId` is the destination's dashboard, if any.
 */
export function guardNavigation(
  nav: NavigationLike,
  go: (href: string) => Promise<void>,
  toDashboardId?: string | null
): boolean {
  if (!get(dirty)) return false;
  // A navigation the session survives needs no asking: to "Add to HOPS" (/add, which adds into
  // this draft) and back to this session's own dashboard (followRoute keeps the session there).
  if (!nav.willUnload && nav.to && (isAddPage(nav.to.url) || (!!toDashboardId && toDashboardId === get(state)?.dashboardId))) {
    return false;
  }
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
      // Back/forward: repeat the same history step rather than pushing a new
      // entry (goto would turn [A, B] + Back into [A, B, A]).
      if (nav.type === 'popstate' && typeof nav.delta === 'number' && nav.delta !== 0) {
        history.go(nav.delta);
        return;
      }
      await go(href);
    } catch (e) {
      logError('Navigation', e);
      toast.error('Could not open that page.');
    }
  });
  return true;
}

/**
 * beforeunload guard: the native "leave site?" prompt while the live session
 * is dirty OR a draft is parked (signed out) — a reload or tab close would
 * lose either, since drafts live only in memory.
 */
export function guardUnload(e: BeforeUnloadEvent): void {
  if (!get(dirty) && !get(parkedState)) return;
  e.preventDefault();
  e.returnValue = '';
}

/**
 * The per-dashboard Settings dialog saved while this session is open. That save
 * bumps the server revision; the session absorbs it so the next Save does not falsely conflict:
 * the base revision becomes the new one and the new settings go into saved, the draft and the
 * undo/redo states (the settings are not part of the draft's edits). Only when the settings save
 * was checked against the session's own base revision — otherwise a real change made elsewhere
 * would be hidden, and the normal conflict path must handle it.
 */
export function absorbSettingsSave(id: string, checkedRevision: number, revision: number, settings: unknown): boolean {
  const s = get(state);
  if (!s || s.dashboardId !== id || s.baseRevision !== checkedRevision) return false;
  const withSettings = (d: LayoutDashboard): LayoutDashboard => ({ ...d, settings: clone(settings) });
  const saved = { ...withSettings(s.saved), revision };
  state.set({
    ...s,
    baseRevision: revision,
    saved,
    draft: s.draft === s.saved ? saved : withSettings(s.draft),
    undo: s.undo.map((d) => (d === s.saved ? saved : withSettings(d))),
    redo: s.redo.map((d) => (d === s.saved ? saved : withSettings(d)))
  });
  return true;
}
setSettingsSavedHook(absorbSettingsSave);

/** Tests only: forget the session, any parked draft and the conflict. */
export function resetEditSessionForTests(): void {
  externalSave = null;
  close();
  parkedState.set(null);
}
