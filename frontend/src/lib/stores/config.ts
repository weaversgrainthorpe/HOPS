import { writable, derived, get, type Readable } from 'svelte/store';
import type { Config, DashboardSettings } from '$lib/types';
import type { LayoutDoc, LayoutDashboard } from '$lib/types/layout';
import type { FreshLayout } from '$lib/utils/api';
import {
  getConfig,
  getConfigFor,
  getDashboard,
  dismissNotice,
  updateSetting,
  saveDashboardV3,
  saveDashboardSettings,
  deleteDashboard as apiDeleteDashboard,
  createDashboard as apiCreateDashboard,
  reorderDashboards as apiReorderDashboards,
  ConflictError,
  MigrationFailedError
} from '$lib/utils/api';
import { page } from '$app/stores';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';
import { refreshStatusBase, refreshAllStatusBases } from './statusCheckBase';
import { refreshAllStatuses } from './status';
import { LAYOUT_VERSION } from '$lib/layout/geometry';

/**
 * This build writes the layout form of LAYOUT_VERSION, so it never saves into a document
 * marked with another `layoutVersion` (or none: one served by another HOPS): the write is refused
 * with this visible message instead of mixing forms.
 */
export const OLD_LAYOUT_FORM =
  'Not saved: this dashboard was loaded from a different HOPS layout version. Reload the page, then make your change again.';

/** Why nothing may be saved into `doc` (it is not at this build's layout version), or null. */
export function layoutFormProblem(doc: LayoutDoc | null | undefined): string | null {
  return doc?.layoutVersion === LAYOUT_VERSION ? null : OLD_LAYOUT_FORM;
}

/** The layout-version guard for a write: toast and throw when the held document is not at it. */
export function assertLayoutForm(): void {
  const why = layoutFormProblem(get(config));
  if (why) {
    toast.error(why);
    throw new Error(why);
  }
}

// The stored v3 document as GET /api/config serves it: {schemaVersion: 3,
// dashboards, migrationNotices?}. null until it has loaded (or when it failed).
export const config = writable<Config | null>(null);

/**
 * Dashboards in display order: by `order` (PUT /api/dashboards/order rewrites
 * it), document order for ties and for dashboards without one.
 */
export function sortedDashboards(list: LayoutDashboard[] | undefined): LayoutDashboard[] {
  const all = Array.isArray(list) ? list : [];
  const key = (d: LayoutDashboard): number => (typeof d.order === 'number' && Number.isFinite(d.order) ? d.order : Infinity);
  return all
    .map((d, i) => ({ d, i, k: key(d) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.d);
}

// Every dashboard, in display order.
export const dashboards = derived(config, ($config) => sortedDashboards($config?.dashboards));

// The stored v3 document (the config itself), for the renderer and editor.
export const layoutDoc = derived(config, ($config): LayoutDoc | null => $config ?? null);

// The current page's dashboard, resolved exactly as the [dashboard] route
// resolves it (path first, then id). Uses the route's DECODED param (as the
// route does), never the encoded pathname, so "/my%20dash" resolves the
// dashboard at "/my dash".
export const currentRoute = derived([config, page], ([$config, $page]) => {
  const seg = ($page.params as Record<string, string | undefined> | undefined)?.dashboard;
  return $config && seg ? resolveDashboardRoute(seg, $config) : undefined;
});

export function findLayoutDashboard(id: string, doc: LayoutDoc | null): LayoutDashboard | undefined {
  return doc?.dashboards.find((d) => d.id === id);
}

/**
 * The dashboard's effective "animated folder backgrounds" setting, as the
 * server computed it into GET /api/config's read-only `display` block
 * — readable by every viewer. Until it is known it is false: a
 * folder shows its first image still, never a guessed animation.
 */
const animatedSettingCache = new Map<string, Readable<boolean>>();
export function animatedFolderBackgroundsFor(dashboardId: string): Readable<boolean> {
  let r = animatedSettingCache.get(dashboardId);
  if (!r) {
    r = derived(config, ($config) => {
      const d = $config?.dashboards.find((x) => x.id === dashboardId);
      return d?.display?.animatedFolderBackgrounds === true;
    });
    animatedSettingCache.set(dashboardId, r);
  }
  return r;
}

// True while the held document is known to be older than a write that just
// succeeded (its response carried no fresh document) and a reload is in
// flight or failed. The renderer shows a refreshing state instead of the old
// tree; loadConfig clears it once a fresh config has landed.
export const layoutStale = writable(false);

// Loading state
export const configLoading = writable(true);

// Error state
export const configError = writable<string | null>(null);

// Set when a write was rejected because the dashboard changed elsewhere
// (HTTP 409). Persistent: only loadConfig() (Reload) clears it, so a change
// that was NOT saved can never look saved.
export const saveConflict = writable<{ dashboardId: string } | null>(null);

// Set (to the server's detail text) while the stored config failed to
// migrate to v3 and the server refuses config-touching requests (HTTP 503).
export const migrationFailure = writable<string | null>(null);
/** Why the migration failed (MigrationFailedError.kind), so the page gives advice that helps. */
export const migrationFailureKind = writable<string>('');

/** Show the migration-failed page for `error`. */
export function noteMigrationFailure(error: MigrationFailedError) {
  migrationFailureKind.set(error.kind);
  migrationFailure.set(error.detail);
}

// The admin dismissed the "ids were renamed during migration" notice. Kept in
// memory only, so it reappears on the next visit while the server still
// reports the renames (i.e. until HOPS restarts).
export const migrationNoticesDismissed = writable(false);

/**
 * Set (to the reason) when the last re-read of the server notices failed: the held notices may
 * no longer match the document, and the banner says so instead of presenting them as fresh.
 */
export const noticesStale = writable<string | null>(null);

// Server notices dismissed in this page session. A re-read that began before the dismissal
// succeeded must not bring one back.
const dismissedNotices = new Set<string>();

function withoutDismissed(c: Config): Config {
  if (!c.notices || dismissedNotices.size === 0) return c;
  return { ...c, notices: c.notices.filter((n) => !dismissedNotices.has(n.id)) };
}

/** Dismiss a server notice (stored on the server). Hidden only once the server agreed; rethrows on failure. */
export async function dismissServerNotice(id: string): Promise<void> {
  await dismissNotice(id);
  dismissedNotices.add(id);
  config.update((c) => (c?.notices ? { ...c, notices: c.notices.filter((n) => n.id !== id) } : c));
}

/**
 * True when the layout should replace the page with the migration-failed
 * notice. Exempt: "/" (shows the notice itself) and every Settings page, the
 * admin home (sign-in + Backups, the remedy), which shows it on top.
 */
export function showMigrationFailedPage(pathname: string, failure: string | null): boolean {
  return failure !== null && pathname !== '/' && pathname !== '/settings' && !pathname.startsWith('/settings/');
}

// Record a failed write where the user can see it. Conflicts raise the
// persistent banner; a migration failure swaps in the migration-failed page.
function noteSaveFailure(error: unknown) {
  if (error instanceof ConflictError) {
    saveConflict.set({ dashboardId: error.dashboardId });
  } else if (error instanceof MigrationFailedError) {
    noteMigrationFailure(error);
  }
}

/** Toast a failed dashboard write: `what` is e.g. "Not saved" / "Not deleted". */
function toastWriteFailure(what: string, error: unknown) {
  if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
    toast.error('Your session has expired. Please refresh the page and log in again.');
  } else if (error instanceof ConflictError) {
    toast.error(`${what} — changed somewhere else`);
  } else {
    toast.error(error instanceof Error && error.message ? `${what}: ${error.message}` : `${what}.`);
  }
}

// ---------------------------------------------------------------------------
// Partial loading (viewer pages). The first load of "/" or a dashboard page fetches the index of
// every dashboard plus the open one in full (GET /api/config?dashboard=); the other dashboards
// then arrive in the background (GET /api/config). Until they have, the store holds index entries
// (`partial: true`): consumers that need every dashboard check hasPartialDashboards() and show
// `otherDashboards` (loading / failed, with Retry) instead of a partial set. Settings, the editor,
// reports, export and anything that writes call ensureFullConfig() first.
// ---------------------------------------------------------------------------

/** Whether the background load of the other dashboards is in flight, done, or failed (and why). */
export type OtherDashboardsState = 'loading' | 'ready' | { error: string };
export const otherDashboards = writable<OtherDashboardsState>('loading');

/** True while `c` holds index entries (dashboards whose content has not arrived). */
export function hasPartialDashboards(c: LayoutDoc | null | undefined): boolean {
  return !!c && (c.dashboards ?? []).some((d) => d?.partial === true);
}

/** Per dashboard id: the one-dashboard read the route started for an index entry, while it runs or after it failed. */
export const dashboardFetches = writable<Record<string, 'loading' | { error: string }>>({});

// Every loadConfig takes a new number; an answer that comes back after a newer load started is
// dropped (the newer one owns the store), so answers from two loads are never mixed.
let loadSeq = 0;
let loadInFlight: number | null = null;
// Once something needs every dashboard (Settings, the editor, a write), every later load is a
// whole-config load.
let fullWanted = false;
// configRevision of the held index (null when the store holds the whole document).
let heldConfigRevision: string | null = null;
let rest: { seq: number; promise: Promise<void> } | null = null;

/** Test hook: forget the partial-loading state between tests. */
export function resetPartialLoadingForTests(): void {
  loadSeq++;
  loadInFlight = null;
  fullWanted = false;
  heldConfigRevision = null;
  rest = null;
  otherDashboards.set('loading');
  dashboardFetches.set({});
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** The route's dashboard segment ("" on "/"): what a reload of the index asks for. */
function viewerKey(): string {
  return ((get(page)?.params ?? {}) as Record<string, string | undefined>).dashboard ?? '';
}

// Load configuration from API. A reload of a held-but-stale layout runs in the
// background: the dashboard stays mounted, and the canvas (TabCanvas) shows
// "Refreshing layout" instead of the old tree. The active tab id and this
// browser's folder memory survive and are re-resolved against the fresh layout
// when it lands (Dashboard follows the tab by id; TabCanvas reconciles the
// drill-down paths). Only a first load (or a reload
// with no held config) shows the global loading screen. A failure is surfaced
// either way (configError).
//
// `dashboard` (a viewer page's route segment, "" for "/") loads only that dashboard in full plus
// the index of the rest, then the rest in the background (see above). Without it, or once the
// whole config is wanted, the whole document is loaded.
export async function loadConfig(opts: { background?: boolean; dashboard?: string; afterMismatch?: boolean } = {}) {
  const seq = ++loadSeq;
  loadInFlight = seq;
  rest = null;
  dashboardFetches.set({});
  const background = (opts.background === true || get(layoutStale)) && get(config) !== null;
  if (!background) configLoading.set(true);
  configError.set(null);
  // Held index entries: the other dashboards are on their way again (this load brings them, or
  // starts their background load).
  if (hasPartialDashboards(get(config))) otherDashboards.set('loading');

  try {
    if (opts.dashboard !== undefined && !fullWanted) {
      const answer = await getConfigFor(opts.dashboard);
      if (seq !== loadSeq) return; // superseded: a newer load owns the store
      adoptLoaded(answer.config);
      heldConfigRevision = answer.configRevision;
      if (hasPartialDashboards(answer.config)) void startRest(seq, opts.afterMismatch === true).catch(() => undefined);
      else otherDashboards.set('ready');
    } else {
      const data = await getConfig();
      if (seq !== loadSeq) return;
      adoptLoaded(data);
      heldConfigRevision = null;
      otherDashboards.set('ready');
    }
  } catch (error) {
    if (seq !== loadSeq) return;
    if (error instanceof MigrationFailedError) {
      // Never keep showing an old config as if it were current.
      config.set(null);
      noteMigrationFailure(error);
    }
    logError('Config load', error);
    configError.set(error instanceof Error ? error.message : 'Failed to load configuration');
    // A held index whose reload failed: the other dashboards are not coming either.
    if (hasPartialDashboards(get(config))) otherDashboards.set({ error: message(error, 'the request failed') });
  } finally {
    if (seq === loadSeq) {
      configLoading.set(false);
      loadInFlight = null;
    }
  }
}

function adoptLoaded(data: Config): void {
  config.set(withoutDismissed(data));
  noticesStale.set(null);
  layoutStale.set(false);
  migrationFailure.set(null);
  saveConflict.set(null);
}

/** The background load of the other dashboards for load `seq` (one at a time; joined if running). */
function startRest(seq: number, afterMismatch = false): Promise<void> {
  if (rest && rest.seq === seq) return rest.promise;
  otherDashboards.set('loading');
  const promise = loadRest(seq, afterMismatch);
  rest = { seq, promise };
  const clear = () => {
    if (rest?.promise === promise) rest = null;
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * Whether a dashboard the page holds in full (one it shows) is at another revision in `full`, or
 * gone from it. Index entries do not count: nothing of theirs but index fields was shown.
 */
function shownDashboardChanged(held: Config, full: Config): boolean {
  const byId = new Map(full.dashboards.map((d) => [d.id, d] as const));
  return held.dashboards.some((d) => d.partial !== true && byId.get(d.id)?.revision !== d.revision);
}

async function loadRest(seq: number, afterMismatch: boolean): Promise<void> {
  let full: Config;
  try {
    full = await getConfig();
  } catch (error) {
    if (seq === loadSeq) {
      logError('Other dashboards load', error);
      otherDashboards.set({ error: message(error, 'the request failed') });
    }
    throw error;
  }
  if (seq !== loadSeq) return; // superseded: the newer load fetches its own
  const held = get(config);
  if (!held) return;
  if (!afterMismatch && shownDashboardChanged(held, full)) {
    // The dashboard on screen changed since the index was read: never show it next to the newer
    // others. Reload index + open + rest at the new state, through the stale-layout path.
    layoutStale.set(true);
    await loadConfig({ background: true, dashboard: viewerKey(), afterMismatch: true });
    return;
  }
  // Index and contents at one state (or, after one reload, the whole document as it now is: still
  // a single state, never mixed). The index view is replaced in one step.
  adoptLoaded(full);
  configError.set(null);
  heldConfigRevision = null;
  otherDashboards.set('ready');
}

/** Retry the background load of the other dashboards (its outcome shows in `otherDashboards`). */
export async function retryOtherDashboards(): Promise<void> {
  if (!hasPartialDashboards(get(config))) return;
  try {
    await startRest(loadSeq);
  } catch {
    // Shown through otherDashboards ({error}) by loadRest.
  }
}

/**
 * Resolve once the store holds every dashboard in full (Settings, the editor, reports, export,
 * writes). Rejects, with the reason, when they could not be loaded; the failure is also visible
 * through `otherDashboards` / `configError`. From now on every reload loads the whole config.
 */
export async function ensureFullConfig(): Promise<void> {
  fullWanted = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const held = get(config);
    if (held && !hasPartialDashboards(held) && loadInFlight === null) return;
    if (!held || loadInFlight !== null) {
      // Nothing held, or a load in flight (it may be a light one): load the whole config now.
      await loadConfig({ background: true });
      const err = get(configError);
      if (err) throw new Error(err);
      continue;
    }
    await startRest(loadSeq);
  }
  if (hasPartialDashboards(get(config)) || !get(config)) {
    throw new Error('The dashboards kept changing while loading. Try again.');
  }
}

/**
 * Fetch one dashboard the store holds only as an index entry (the route opened it before the
 * background load arrived). Taken only when it matches the held index (same configRevision);
 * otherwise the page reloads index + open dashboard + rest at the new state. A failure is kept in
 * dashboardFetches for the route to show, with Retry.
 */
export async function fetchDashboard(id: string): Promise<void> {
  const seq = loadSeq;
  if (get(dashboardFetches)[id] === 'loading') return;
  dashboardFetches.update((m) => ({ ...m, [id]: 'loading' }));
  const settle = (state?: { error: string }) =>
    dashboardFetches.update((m) => {
      const { [id]: _old, ...others } = m;
      return state ? { ...others, [id]: state } : others;
    });
  try {
    const answer = await getDashboard(id);
    if (seq !== loadSeq) return; // a newer load owns the store (and reset dashboardFetches)
    settle();
    const held = get(config);
    const entry = held?.dashboards.find((d) => d.id === id);
    if (!held || !entry || entry.partial !== true) return; // the background copy arrived meanwhile
    if (answer.configRevision !== heldConfigRevision || answer.revision !== entry.revision) {
      void loadConfig({ background: true, dashboard: viewerKey() });
      return;
    }
    config.set({ ...held, dashboards: held.dashboards.map((d) => (d.id === id ? answer.dashboard : d)) });
  } catch (error) {
    if (seq !== loadSeq) return;
    logError('Dashboard load', error);
    settle({ error: message(error, 'the request failed') });
  }
}

/**
 * After any successful write: take the response's fresh document into the
 * store (keeping the migration notices, which only GET carries). A response
 * without one leaves the held document unusable: it is marked stale and
 * reloaded, never presented as current.
 */
export function applySavedLayout(fresh: FreshLayout | undefined): void {
  const layout = fresh?.layout;
  if (layout && Array.isArray(layout.dashboards)) {
    const held = get(config);
    const notices = held?.migrationNotices;
    const serverNotices = held?.notices;
    config.set({
      schemaVersion: 3,
      // The marker comes from the fresh document only: a response without it blocks the next save.
      ...(layout.layoutVersion !== undefined ? { layoutVersion: layout.layoutVersion } : {}),
      dashboards: layout.dashboards,
      ...(notices ? { migrationNotices: notices } : {}),
      ...(serverNotices ? { notices: serverNotices } : {}),
      ...(held?.noticesUnreadable ? { noticesUnreadable: held.noticesUnreadable } : {})
    });
    // Server notices are computed per GET from the document, so any write can
    // change them (a listed dashboard switched on or deleted, or a new one): read them again.
    void refreshNotices();
    // Tile badges follow the saved levels: re-read the mounted tiles' status now, not in 30 s.
    void refreshAllStatuses();
    return;
  }
  layoutStale.set(true);
  void loadConfig();
}

/**
 * Re-read the server-computed parts of the document after a write: the notices and each
 * dashboard's read-only `display` block (computed from the global values when a dashboard has no
 * override -- so a global Settings save changes it). The rest of the document came with
 * the write and is not taken. A failed read is visible: a toast, and the held notices are marked
 * "may be out of date" (noticesStale) until a later read succeeds.
 *
 * Reads can overlap (two quick saves); only the latest one started is applied, so an older
 * response resolving last never overwrites a newer one.
 */
let refreshSeq = 0;

/**
 * Re-read the server notices now (e.g. once the admin has signed in: backup problems are only
 * sent to a signed-in admin, so a page loaded signed-out holds none).
 */
export function refreshServerNotices(): Promise<void> {
  return refreshNotices();
}

/**
 * Show a write's `warning` (the safety backup before it failed, but the change was saved). It
 * stays until closed (never a 4-second flash), and the notices are re-read so the persistent
 * backup notice appears in Settings too.
 */
export function showSaveWarning(warning: string): void {
  toast.warning(warning, 0);
  if (get(config)) void refreshNotices();
}

async function refreshNotices(): Promise<void> {
  const mine = ++refreshSeq;
  try {
    const fresh = await getConfig();
    if (mine !== refreshSeq) return; // superseded: a newer read owns the result
    const freshDisplay = new Map((fresh.dashboards ?? []).map((d) => [d.id, d.display] as const));
    config.update((c) => {
      if (!c) return c;
      const { notices: _old, noticesUnreadable: _u, ...rest } = c;
      const kept = (fresh.notices ?? []).filter((n) => !dismissedNotices.has(n.id));
      const dashboards = c.dashboards.map((d) => {
        if (!freshDisplay.has(d.id)) return d;
        const display = freshDisplay.get(d.id);
        const { display: _d, ...dRest } = d;
        return display ? { ...dRest, display } : dRest;
      });
      return {
        ...rest,
        dashboards,
        ...(kept.length > 0 ? { notices: kept } : {}),
        ...(fresh.noticesUnreadable ? { noticesUnreadable: fresh.noticesUnreadable } : {})
      };
    });
    noticesStale.set(null);
  } catch (error) {
    if (mine !== refreshSeq) return; // superseded: the newer read reports its own outcome
    logError('Notices refresh', error);
    const why = error instanceof Error && error.message ? error.message : 'the request failed';
    noticesStale.set(why);
    toast.error(`Couldn't refresh the notices and dashboard display settings: ${why} (reload to update them).`);
  }
}

/**
 * Save one global setting (the Settings page). Afterwards everything derived from the global
 * values is re-read, so nothing shows the old value as current: the status-check gates the
 * editing dialogs hold (the global one is among them), the notices, each dashboard's computed
 * `display` block (animated folder backgrounds inherit the global value) and the mounted tiles'
 * status.
 */
export async function saveGlobalSetting(key: string, value: string | number): Promise<void> {
  await updateSetting(key, value);
  await Promise.all([refreshAllStatusBases(), refreshNotices(), refreshAllStatuses()]);
}

// ---------------------------------------------------------------------------
// Serialized write queue. Dashboard-list writes (create, rename, delete,
// reorder, settings) run one at a time, and each reads the store only after
// the previous one's result has landed, so it always sends the latest
// revision it knows.
// ---------------------------------------------------------------------------
let saveQueue: Promise<unknown> = Promise.resolve();

function enqueueSave<T>(task: () => Promise<T>): Promise<T> {
  const next = saveQueue.then(task, task); // run on success or failure of prev
  // Don't poison the chain: future tasks should run even if this one rejected.
  saveQueue = next.catch(() => undefined);
  return next;
}

/** The dashboard as the store holds it, or a visible refusal. */
function heldDashboard(id: string, what: string): LayoutDashboard {
  const d = findLayoutDashboard(id, get(layoutDoc));
  if (!d) {
    const err = new Error(get(config) ? 'Dashboard not found — reload and try again' : 'No configuration loaded');
    toast.error(`${what}: ${err.message}`);
    throw err;
  }
  if (typeof d.revision !== 'number') {
    const err = new Error('Dashboard has no known revision — reload and try again');
    toast.error(`${what}: ${err.message}`);
    throw err;
  }
  return d;
}

/**
 * Create a dashboard (POST /api/dashboards). Resolves to the new id once the
 * store holds the fresh document; on failure the store is untouched, the
 * failure is shown and the error rethrown.
 */
export async function createDashboard(name: string, path: string): Promise<string> {
  return enqueueSave(async () => {
    try {
      const resp = await apiCreateDashboard(name, path);
      applySavedLayout(resp);
      toast.success(`Dashboard "${name}" created`);
      if (resp.warning) showSaveWarning(resp.warning);
      return resp.id;
    } catch (error) {
      logError('Dashboard create', error);
      noteSaveFailure(error);
      toastWriteFailure('Not created', error);
      throw error;
    }
  });
}

/**
 * Rename a dashboard and/or change its path: the stored dashboard with the
 * new name/path, saved at the revision THIS STORE holds (PUT schema 3), so a
 * change made elsewhere is a visible 409, never overwritten.
 */
export async function renameDashboard(id: string, changes: { name: string; path: string }): Promise<void> {
  return enqueueSave(async () => {
    const d = heldDashboard(id, 'Not saved');
    assertLayoutForm();
    try {
      const resp = await saveDashboardV3(id, { ...d, name: changes.name, path: changes.path }, d.revision);
      applySavedLayout(resp);
      toast.success('Changes saved');
      if (resp.warning) showSaveWarning(resp.warning);
    } catch (error) {
      logError('Dashboard rename', error);
      noteSaveFailure(error);
      toastWriteFailure('Not saved', error);
      throw error;
    }
  });
}

/**
 * Delete one dashboard, revision-checked against the revision THIS STORE
 * holds. On success the store takes the response's fresh document; on failure
 * the store is untouched, the failure is recorded (conflict banner /
 * migration page) and toasted, and the error is rethrown.
 */
export async function deleteDashboard(id: string): Promise<void> {
  return enqueueSave(async () => {
    const d = heldDashboard(id, 'Not deleted');
    try {
      const resp = await apiDeleteDashboard(id, d.revision);
      applySavedLayout(resp);
      toast.success('Dashboard deleted');
      if (resp.warning) showSaveWarning(resp.warning);
    } catch (error) {
      logError('Dashboard delete', error);
      noteSaveFailure(error);
      toastWriteFailure('Not deleted', error);
      throw error;
    }
  });
}

/** Put the dashboards in this order (every id exactly once): PUT /api/dashboards/order. */
export async function reorderDashboards(ids: string[]): Promise<void> {
  return enqueueSave(async () => {
    try {
      const resp = await apiReorderDashboards(ids);
      applySavedLayout(resp);
      if (resp.warning) showSaveWarning(resp.warning);
    } catch (error) {
      logError('Dashboard reorder', error);
      noteSaveFailure(error);
      toastWriteFailure('Order not saved', error);
      throw error;
    }
  });
}

/**
 * Called after a confirmed per-dashboard settings save with the revision it was checked against,
 * the server's new revision and the merged overrides. editSession registers it so an open edit
 * session absorbs the save (its base revision moves on; no false conflict on the next Save).
 * config.ts cannot import editSession (that would be an import cycle).
 */
export type SettingsSavedHook = (id: string, checkedRevision: number, revision: number, settings: DashboardSettings) => void;
let settingsSavedHook: SettingsSavedHook | null = null;
export function setSettingsSavedHook(fn: SettingsSavedHook | null): void {
  settingsSavedHook = fn;
}

/**
 * Save per-dashboard settings overrides (absent key = unchanged, null = reset
 * to inherit), revision-checked against the revision THIS STORE holds, not a
 * freshly fetched one: if the store is stale the server answers 409, so a
 * settings save can never fast-forward a stale store past someone else's
 * change. On success the store takes the response's fresh document; on
 * failure it is left untouched and the failure is recorded (conflict banner /
 * migration page) before being rethrown for the caller to show inline.
 */
export async function saveDashboardSettingsChanges(
  id: string,
  changes: Partial<Record<keyof DashboardSettings, string | number | boolean | null>>
): Promise<void> {
  return enqueueSave(async () => {
    const d = findLayoutDashboard(id, get(layoutDoc));
    if (!d) throw new Error(get(config) ? 'Dashboard not found' : 'No configuration loaded');
    if (typeof d.revision !== 'number') throw new Error('Dashboard has no known revision — reload and try again');
    try {
      const resp = await saveDashboardSettings(id, changes, d.revision);
      applySavedLayout(resp);
      // The editing dialogs and the blocked-checks report read this dashboard's status-check gate.
      void refreshStatusBase(id);
      const merged = { ...((d.settings as DashboardSettings | undefined) ?? {}), ...changes } as DashboardSettings;
      settingsSavedHook?.(id, d.revision, resp.revision, merged);
    } catch (error) {
      logError('Dashboard settings save', error);
      noteSaveFailure(error);
      throw error;
    }
  });
}

// "/home", "home" and "//home" route to the same dashboard: every leading "/"
// is dropped and one added back. The backend's normPath (dashboard_handlers.go)
// uses the same rule.
function normPath(p: string): string {
  return '/' + String(p ?? '').replace(/^\/+/, '');
}

/**
 * Same-origin href for a dashboard path. Built from the path's segments, each
 * percent-encoded, so no stored character (backslash, tab, newline, "//",
 * a scheme) can make a browser resolve it off-origin; the route receives the
 * decoded segment back and resolves the same dashboard. If the result would
 * still leave this origin, falls back to the whole path as ONE encoded segment.
 */
export function dashboardHref(path: string): string {
  const bare = String(path ?? '').replace(/^\/+/, '');
  const href = '/' + bare.split('/').map(encodeURIComponent).join('/');
  const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null'
    ? location.origin
    : 'http://localhost';
  try {
    if (new URL(href, origin).origin === origin) return href;
  } catch {
    // fall through to the single-segment form
  }
  return '/' + encodeURIComponent(bare);
}

/**
 * Resolve a route segment ("home", "/home" or an id) to a dashboard: by path
 * FIRST, and only when no path matches, by id. A path match always wins over
 * an id match.
 */
export function resolveDashboardRoute(pathOrId: string, cfg: Config): LayoutDashboard | undefined {
  const all = Array.isArray(cfg.dashboards) ? cfg.dashboards : [];
  const path = normPath(pathOrId);
  const byPath = all.find((d) => normPath(d.path) === path);
  if (byPath) return byPath;
  const id = String(pathOrId ?? '').replace(/^\/+/, '');
  return all.find((d) => d.id === id);
}
