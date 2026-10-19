import { writable, derived, get } from 'svelte/store';
import type { Config, Dashboard, DashboardSettings } from '$lib/types';
import type { LayoutDoc, LayoutDashboard } from '$lib/types/layout';
import type { FreshLayout } from '$lib/utils/api';
import {
  getConfig,
  updateConfig as apiUpdateConfig,
  saveDashboard,
  saveDashboardSettings,
  deleteDashboard as apiDeleteDashboard,
  ConflictError,
  MigrationFailedError
} from '$lib/utils/api';
import { page } from '$app/stores';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Create a writable store for the config
export const config = writable<Config | null>(null);

// Derived store for dashboards
export const dashboards = derived(config, ($config) => $config?.dashboards || []);

// The current page's dashboard, resolved exactly as the [dashboard] route
// resolves it (path first, then id, across legacy and v3-only dashboards).
const currentRoute = derived([config, page], ([$config, $page]) =>
  $config ? resolveDashboardRoute($page.url.pathname, $config) : undefined
);

// The current page's LEGACY dashboard (null on a v3-only dashboard, which
// legacy-only code must never see).
export const currentDashboard = derived(currentRoute, (r) => (r?.kind === 'legacy' ? r.dashboard : null));

// The current page's v3-only dashboard (view-only; no legacy view exists).
export const currentV3OnlyDashboard = derived(currentRoute, (r) => (r?.kind === 'v3only' ? r.dashboard : null));

// The stored v3 layout document (null until the config has loaded or when the
// server sent none).
export const layoutDoc = derived(config, ($config): LayoutDoc | null => $config?.layout ?? null);

// Ids of dashboards that exist only in v3 (no legacy view).
export const v3OnlyDashboardIds = derived(
  config,
  ($config) => new Set(($config?.v3OnlyDashboards ?? []).map((d) => d.id))
);

export function findLayoutDashboard(id: string, doc: LayoutDoc | null): LayoutDashboard | undefined {
  return doc?.dashboards.find((d) => d.id === id);
}

// True while the held `layout` is known to be older than the legacy data (a
// write response did not carry a fresh one and a reload is in flight/failed).
// The renderer shows a refreshing state instead of the old tree. loadConfig
// clears it once a fresh config has landed.
export const layoutStale = writable(false);

// The layout fields to merge into the config in the SAME config.set as a
// legacy update. A response without `layout` leaves the old one unusable: flag
// it stale and reload, never present it as current.
function freshLayoutPatch(resp: FreshLayout | undefined): Pick<Config, 'layout' | 'v3OnlyDashboards'> | {} {
  if (resp && resp.layout) {
    return { layout: resp.layout, v3OnlyDashboards: resp.v3OnlyDashboards ?? [] };
  }
  layoutStale.set(true);
  void loadConfig();
  return {};
}

// Loading state
export const configLoading = writable(true);

// Error state
export const configError = writable<string | null>(null);

// Set when a save was rejected because the dashboard changed elsewhere
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
 * True when the layout should replace the page with the migration-failed
 * notice. The admin page ("/": login + Backups, the remedy) is exempt and
 * shows its own persistent banner instead.
 */
export function showMigrationFailedPage(pathname: string, failure: string | null): boolean {
  return failure !== null && pathname !== '/';
}

// Record a failed save where the user can see it. Conflicts raise the
// persistent banner; a migration failure swaps in the migration-failed page.
function noteSaveFailure(error: unknown) {
  if (error instanceof ConflictError) {
    saveConflict.set({ dashboardId: error.dashboardId });
  } else if (error instanceof MigrationFailedError) {
    migrationFailure.set(error.detail);
  }
}

// Toast text for a failed save: the server's reason when there is one (e.g.
// "Invalid config: ..."), so the user can see why nothing was saved.
function saveFailedMessage(error: unknown): string {
  return error instanceof Error && error.message ? `Failed to save changes: ${error.message}` : 'Failed to save changes';
}

// Load configuration from API
export async function loadConfig() {
  configLoading.set(true);
  configError.set(null);

  try {
    const data = await getConfig();
    config.set(data);
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

// Apply server-assigned revisions onto a config: the top-level map and each
// dashboard's own `revision` stay in sync.
function withRevisions(cfg: Config, revisions: Record<string, number>): Config {
  return {
    ...cfg,
    dashboards: cfg.dashboards.map((d) =>
      revisions[d.id] !== undefined ? { ...d, revision: revisions[d.id] } : d
    ),
    dashboardRevisions: revisions
  };
}

// Update configuration (admin only). The store is only updated after the
// server confirms; on any failure it is left untouched.
export async function updateConfig(newConfig: Config, showToast = true) {
  try {
    // layout / v3OnlyDashboards are view-only server fields; never send them back.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { layout: _layout, v3OnlyDashboards: _v3Only, ...putBody } = newConfig;
    const resp = await apiUpdateConfig(putBody);
    const patch = freshLayoutPatch(resp);
    config.set({ ...(resp.revisions ? withRevisions(newConfig, resp.revisions) : newConfig), ...patch });
    if (showToast) {
      toast.success('Changes saved');
    }
    // Server may attach a warning when the pre-update backup failed
    // but the config was saved anyway. Surface it so the admin knows
    // the rollback safety-net didn't fire this time.
    if (resp.warning) {
      toast.warning(resp.warning);
    }
  } catch (error) {
    logError('Config update', error);
    noteSaveFailure(error);

    // Check if it's a session expiration error
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      toast.error('Your session has expired. Please refresh the page and log in again.');
    } else if (error instanceof ConflictError) {
      toast.error('Not saved \u2014 changed somewhere else');
    } else {
      toast.error(saveFailedMessage(error));
    }
    throw error;
  }
}

// Save one dashboard with its current revision (optimistic concurrency).
// On success the store takes the returned revision; on failure the store is
// untouched so the unsaved change never looks saved.
async function saveOneDashboard(updated: Dashboard): Promise<void> {
  const currentConfig = get(config);
  if (!currentConfig) {
    throw new Error('No configuration loaded');
  }
  const index = currentConfig.dashboards.findIndex((d) => d.id === updated.id);
  if (index === -1) {
    throw new Error('Dashboard not found');
  }
  const revision = storeRevision(currentConfig, updated.id);
  if (revision === undefined) {
    throw new Error('Dashboard has no known revision \u2014 reload and try again');
  }

  try {
    const resp = await saveDashboard(updated.id, updated, revision);
    const saved: Dashboard = { ...updated, revision: resp.revision };
    config.set({
      ...currentConfig,
      dashboards: [
        ...currentConfig.dashboards.slice(0, index),
        saved,
        ...currentConfig.dashboards.slice(index + 1)
      ],
      dashboardRevisions: { ...(currentConfig.dashboardRevisions ?? {}), [updated.id]: resp.revision },
      ...freshLayoutPatch(resp)
    });
    toast.success('Changes saved');
    // The save went through but its pre-update backup failed: say so, so
    // the admin doesn't trust a rollback point that doesn't exist.
    if (resp.warning) {
      toast.warning(resp.warning);
    }
  } catch (error) {
    logError('Dashboard save', error);
    noteSaveFailure(error);
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      toast.error('Your session has expired. Please refresh the page and log in again.');
    } else if (error instanceof ConflictError) {
      toast.error('Not saved \u2014 changed somewhere else');
    } else {
      toast.error(saveFailedMessage(error));
    }
    throw error;
  }
}

function isV3Only(cfg: Config, id: string): boolean {
  return (cfg.v3OnlyDashboards ?? []).some((d) => d.id === id);
}

/**
 * Delete one dashboard (legacy or v3-only), revision-checked against the
 * revision THIS STORE holds (the legacy view's, or for a v3-only dashboard the
 * held layout's). Runs in the save queue. On success the store drops the
 * dashboard and takes the response's fresh layout atomically; on failure the
 * store is untouched, the failure is recorded (conflict banner / migration
 * page) and toasted, and the error is rethrown.
 */
export async function deleteDashboard(id: string): Promise<void> {
  return enqueueSave(async () => {
    const cfg = get(config);
    if (!cfg) throw new Error('No configuration loaded');
    const legacy = cfg.dashboards.some((d) => d.id === id);
    const revision = legacy
      ? storeRevision(cfg, id)
      : isV3Only(cfg, id)
        ? findLayoutDashboard(id, cfg.layout ?? null)?.revision
        : undefined;
    if (!legacy && !isV3Only(cfg, id)) {
      const err = new Error('Dashboard not found');
      toast.error(`Not deleted: ${err.message}`);
      throw err;
    }
    if (typeof revision !== 'number') {
      const err = new Error('Dashboard has no known revision \u2014 reload and try again');
      toast.error(`Not deleted: ${err.message}`);
      throw err;
    }
    try {
      const resp = await apiDeleteDashboard(id, revision);
      const latest = get(config) ?? cfg;
      const revs = { ...(latest.dashboardRevisions ?? {}) };
      delete revs[id];
      config.set({
        ...latest,
        dashboards: latest.dashboards.filter((d) => d.id !== id),
        dashboardRevisions: revs,
        ...freshLayoutPatch(resp)
      });
      toast.success('Dashboard deleted');
      if (resp.warning) toast.warning(resp.warning);
    } catch (error) {
      logError('Dashboard delete', error);
      noteSaveFailure(error);
      if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
        toast.error('Your session has expired. Please refresh the page and log in again.');
      } else if (error instanceof ConflictError) {
        toast.error('Not deleted \u2014 changed somewhere else');
      } else {
        toast.error(error instanceof Error && error.message ? `Not deleted: ${error.message}` : 'Failed to delete the dashboard');
      }
      throw error;
    }
  });
}

// Revision the store holds for a dashboard (what the client last saw).
function storeRevision(cfg: Config, id: string): number | undefined {
  const d = cfg.dashboards.find((x) => x.id === id);
  return d?.revision ?? cfg.dashboardRevisions?.[id];
}

/**
 * Save per-dashboard settings overrides (absent key = unchanged, null = reset
 * to inherit), revision-checked against the revision THIS STORE holds, not a
 * freshly fetched one: if the store is stale the server answers 409, so a
 * settings save can never fast-forward a stale store past someone else's
 * change. Runs in the same save queue as mutateDashboard. On success the
 * store takes the merged overrides and new revision; on failure it is left
 * untouched and the failure is recorded (conflict banner / migration page)
 * before being rethrown for the caller to show inline.
 */
export async function saveDashboardSettingsChanges(
  id: string,
  changes: Partial<Record<keyof DashboardSettings, string | number | boolean | null>>
): Promise<void> {
  return enqueueSave(async () => {
    const cfg = get(config);
    if (!cfg) throw new Error('No configuration loaded');
    const dash = cfg.dashboards.find((d) => d.id === id);
    if (!dash) {
      // A v3-only dashboard has no legacy view: check against the revision
      // the held layout carries and take the fresh layout from the response.
      const ld = isV3Only(cfg, id) ? findLayoutDashboard(id, cfg.layout ?? null) : undefined;
      if (!ld) throw new Error('Dashboard not found');
      try {
        const resp = await saveDashboardSettings(id, changes, ld.revision);
        const latest = get(config) ?? cfg;
        config.set({ ...latest, ...freshLayoutPatch(resp) });
      } catch (error) {
        logError('Dashboard settings save', error);
        noteSaveFailure(error);
        throw error;
      }
      return;
    }
    const revision = storeRevision(cfg, id);
    if (revision === undefined) {
      throw new Error('Dashboard has no known revision \u2014 reload and try again');
    }
    try {
      const resp = await saveDashboardSettings(id, changes, revision);
      const merged = { ...(dash.settings ?? {}), ...changes } as DashboardSettings;
      applyDashboardSettings(id, merged, resp.revision, resp);
    } catch (error) {
      logError('Dashboard settings save', error);
      noteSaveFailure(error);
      throw error;
    }
  });
}

// After a confirmed per-dashboard settings save: take the new revision and
// merged overrides into the store so the next dashboard save does not
// spuriously conflict (and so the UI reflects what the server holds). Only
// call it with a revision the server returned for a save that was checked
// against this store's own revision (see saveDashboardSettingsChanges).
export function applyDashboardSettings(
  id: string,
  settings: DashboardSettings,
  revision: number,
  fresh?: FreshLayout
): void {
  const cfg = get(config);
  if (!cfg) return;
  config.set({
    ...cfg,
    dashboards: cfg.dashboards.map((d) => (d.id === id ? { ...d, settings, revision } : d)),
    dashboardRevisions: { ...(cfg.dashboardRevisions ?? {}), [id]: revision },
    ...freshLayoutPatch(fresh)
  });
}

// "/home" and "home" route to the same dashboard.
function normPath(p: string): string {
  return '/' + String(p ?? '').replace(/^\/+/, '');
}

/**
 * Same-origin href for a dashboard path: always a single leading "/", so a
 * stored path can never become a scheme ("javascript:") or protocol-relative
 * ("//host") URL when used as a link or navigation target.
 */
export function dashboardHref(path: string): string {
  return normPath(path);
}

// Helper to find a LEGACY dashboard by path or id. A path match always wins
// over an id match.
export function findDashboard(pathOrId: string, cfg: Config): Dashboard | undefined {
  const r = resolveDashboardRoute(pathOrId, cfg);
  return r?.kind === 'legacy' ? r.dashboard : undefined;
}

export type RouteDashboard =
  | { kind: 'legacy'; dashboard: Dashboard }
  | { kind: 'v3only'; dashboard: LayoutDashboard }
  /** A v3-only dashboard is listed but its layout is absent: an error, never a blank page. */
  | { kind: 'missing-layout'; id: string; name: string };

/**
 * Resolve a route segment ("home", "/home" or an id) to a dashboard: by path
 * FIRST across legacy and v3-only dashboards, and only when no path matches,
 * by id. A path match always wins over an id match.
 */
export function resolveDashboardRoute(pathOrId: string, cfg: Config): RouteDashboard | undefined {
  const legacy = cfg.dashboards ?? [];
  const v3 = cfg.v3OnlyDashboards ?? [];
  const asV3 = (d: { id: string; name: string }): RouteDashboard => {
    const ld = findLayoutDashboard(d.id, cfg.layout ?? null);
    return ld ? { kind: 'v3only', dashboard: ld } : { kind: 'missing-layout', id: d.id, name: d.name };
  };
  const path = normPath(pathOrId);
  const lp = legacy.find((d) => normPath(d.path) === path);
  if (lp) return { kind: 'legacy', dashboard: lp };
  const vp = v3.find((d) => normPath(d.path) === path);
  if (vp) return asV3(vp);
  const id = String(pathOrId ?? '').replace(/^\/+/, '');
  const li = legacy.find((d) => d.id === id);
  if (li) return { kind: 'legacy', dashboard: li };
  const vi = v3.find((d) => d.id === id);
  if (vi) return asV3(vi);
  return undefined;
}

// Update a specific dashboard.
//
// DEPRECATED for new callers — use mutateDashboard() instead. mutateDashboard
// runs your mutation against the LATEST dashboard state at execution time and
// serializes saves through a queue, eliminating stale-snapshot races when
// multiple mutations fire in rapid succession (e.g. drag-then-delete).
//
// This whole-snapshot updateDashboard is racy: if you read $state.snapshot,
// mutate, then call updateDashboard, a concurrent mutation between your read
// and your write will be silently overwritten by your stale snapshot.
//
// Kept only for any straggler callers; new code should not use it.
export async function updateDashboard(updatedDashboard: Dashboard) {
  return saveDashboardSnapshot(updatedDashboard);
}

async function saveDashboardSnapshot(updatedDashboard: Dashboard): Promise<void> {
  return saveOneDashboard(updatedDashboard);
}

// ---------------------------------------------------------------------------
// Serialized save queue. Every save runs sequentially. The next save only
// reads from the store AFTER the previous save's config.set() has run, so
// it always sees the latest committed state.
//
// Without this, two mutations fired in rapid succession could each snapshot
// the dashboard before either save completed → both saves write stale data
// → last write wins → first mutation silently lost.
// ---------------------------------------------------------------------------
let saveQueue: Promise<unknown> = Promise.resolve();

function enqueueSave<T>(task: () => Promise<T>): Promise<T> {
  const next = saveQueue.then(task, task);  // run on success or failure of prev
  // Don't poison the chain: future tasks should run even if this one rejected.
  saveQueue = next.catch(() => undefined);
  return next;
}

/**
 * Apply a mutation to a dashboard, atomically against the latest store state.
 *
 * The mutator function receives a fresh deep clone of the named dashboard,
 * which it mutates in place (or replaces by returning a new Dashboard). The
 * clone reflects the LATEST state of the store at the moment the mutation
 * runs, which means even if you call mutateDashboard() while a previous save
 * is still in flight, you see the post-previous-save state, not what the
 * dashboard looked like when you called.
 *
 * Saves run in a single serialized queue, so you cannot have two PUTs to the
 * backend racing. The returned Promise resolves after the backend confirms
 * the save AND the local store has been updated.
 *
 * Usage:
 *   await mutateDashboard(dashboard.id, (dash) => {
 *     const tab = dash.tabs.find(t => t.id === tabId);
 *     if (tab) tab.groups = tab.groups.filter(g => g.id !== groupId);
 *   });
 */
export async function mutateDashboard(
  dashboardId: string,
  mutator: (dashboard: Dashboard) => Dashboard | void
): Promise<void> {
  return enqueueSave(async () => {
    const currentConfig = get(config);
    if (!currentConfig) {
      throw new Error('No configuration loaded');
    }

    const dashboardIndex = currentConfig.dashboards.findIndex(d => d.id === dashboardId);
    if (dashboardIndex === -1) {
      throw new Error('Dashboard not found');
    }

    // Take a structuredClone of the latest committed state. JSON round-trip
    // avoids any Svelte 5 Proxy edge cases that have bitten us before.
    const fresh: Dashboard = JSON.parse(JSON.stringify(currentConfig.dashboards[dashboardIndex]));
    const result = mutator(fresh) ?? fresh;

    await saveOneDashboard(result);
  });
}
