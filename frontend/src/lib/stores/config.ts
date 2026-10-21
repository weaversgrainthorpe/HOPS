import { writable, derived, get, type Readable } from 'svelte/store';
import type { Config, DashboardSettings } from '$lib/types';
import type { LayoutDoc, LayoutDashboard } from '$lib/types/layout';
import type { FreshLayout } from '$lib/utils/api';
import {
  getConfig,
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
import { GRID_UNIT } from '$lib/layout/geometry';

/**
 * Controller Ruling 3 (finer grid): this build writes 24-column placements, so it never saves into
 * a document that is not marked `gridUnit: 2` (one served by an older HOPS, or in the old form):
 * the write is refused with this visible message instead of mixing units.
 */
export const OLD_GRID_FORM =
  'Not saved: this dashboard was saved by an older HOPS layout. Reload the page, then make your change again.';

/** Why nothing may be saved into `doc` (it lacks the finer-grid marker), or null. */
export function gridFormProblem(doc: LayoutDoc | null | undefined): string | null {
  return doc?.gridUnit === GRID_UNIT ? null : OLD_GRID_FORM;
}

/** The finer-grid guard for a write: toast and throw when the held document is not marked. */
export function assertGridForm(): void {
  const why = gridFormProblem(get(config));
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
 * (Ruling 9) — readable by every viewer. Until it is known it is false: a
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
 * notice. Exempt: "/" (shows the notice itself) and Settings, the admin home
 * (sign-in + Backups, the remedy), which shows it on top.
 */
export function showMigrationFailedPage(pathname: string, failure: string | null): boolean {
  return failure !== null && pathname !== '/' && pathname !== '/settings';
}

// Record a failed write where the user can see it. Conflicts raise the
// persistent banner; a migration failure swaps in the migration-failed page.
function noteSaveFailure(error: unknown) {
  if (error instanceof ConflictError) {
    saveConflict.set({ dashboardId: error.dashboardId });
  } else if (error instanceof MigrationFailedError) {
    migrationFailure.set(error.detail);
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

// Load configuration from API. A reload of a held-but-stale layout runs in the
// background: the dashboard stays mounted, and both the canvas (TabCanvas) and
// every open folder overlay body (FolderOverlay) show "Refreshing layout"
// instead of the old tree. The active tab id and the overlay stack survive and
// are re-resolved against the fresh layout when it lands (Dashboard follows the
// tab by id; TabCanvas reconciles the stack). Only a first load (or a reload
// with no held config) shows the global loading screen. A failure is surfaced
// either way (configError).
export async function loadConfig(opts: { background?: boolean } = {}) {
  const background = (opts.background === true || get(layoutStale)) && get(config) !== null;
  if (!background) configLoading.set(true);
  configError.set(null);

  try {
    const data = await getConfig();
    config.set(withoutDismissed(data));
    noticesStale.set(null);
    layoutStale.set(false);
    migrationFailure.set(null);
    saveConflict.set(null);
  } catch (error) {
    if (error instanceof MigrationFailedError) {
      // Never keep showing an old config as if it were current.
      config.set(null);
      migrationFailure.set(error.detail);
    }
    logError('Config load', error);
    configError.set(error instanceof Error ? error.message : 'Failed to load configuration');
  } finally {
    configLoading.set(false);
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
      ...(layout.gridUnit !== undefined ? { gridUnit: layout.gridUnit } : {}),
      dashboards: layout.dashboards,
      ...(notices ? { migrationNotices: notices } : {}),
      ...(serverNotices ? { notices: serverNotices } : {}),
      ...(held?.noticesUnreadable ? { noticesUnreadable: held.noticesUnreadable } : {})
    });
    // Server notices are computed per GET from the document (Ruling 13), so any write can
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
 * override, Ruling 9 -- so a global Settings save changes it). The rest of the document came with
 * the write and is not taken. A failed read is visible: a toast, and the held notices are marked
 * "may be out of date" (noticesStale) until a later read succeeds.
 *
 * Reads can overlap (two quick saves); only the latest one started is applied, so an older
 * response resolving last never overwrites a newer one.
 */
let refreshSeq = 0;
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
 * values is re-read, so nothing shows the old value as current: the editing dialogs' dashboard
 * levels (status checks inherit the global value), the notices, each dashboard's computed
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
      if (resp.warning) toast.warning(resp.warning);
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
    assertGridForm();
    try {
      const resp = await saveDashboardV3(id, { ...d, name: changes.name, path: changes.path }, d.revision);
      applySavedLayout(resp);
      toast.success('Changes saved');
      if (resp.warning) toast.warning(resp.warning);
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
      if (resp.warning) toast.warning(resp.warning);
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
      if (resp.warning) toast.warning(resp.warning);
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
      // The editing dialogs' "inherited from" text uses this dashboard's settings (Ruling 3).
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
