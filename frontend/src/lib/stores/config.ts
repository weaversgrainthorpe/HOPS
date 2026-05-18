import { writable, derived, get } from 'svelte/store';
import type { Config, Dashboard } from '$lib/types';
import { getConfig, updateConfig as apiUpdateConfig } from '$lib/utils/api';
import { page } from '$app/stores';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Create a writable store for the config
export const config = writable<Config | null>(null);

// Derived store for dashboards
export const dashboards = derived(config, ($config) => $config?.dashboards || []);

// Derived store for current dashboard based on the current page path
export const currentDashboard = derived(
  [config, page],
  ([$config, $page]) => {
    if (!$config) return null;
    const currentPath = $page.url.pathname;
    return findDashboard(currentPath, $config);
  }
);

// Loading state
export const configLoading = writable(true);

// Error state
export const configError = writable<string | null>(null);

// Load configuration from API
export async function loadConfig() {
  configLoading.set(true);
  configError.set(null);

  try {
    const data = await getConfig();
    config.set(data);
  } catch (error) {
    logError('Config load', error);
    configError.set(error instanceof Error ? error.message : 'Failed to load configuration');
  } finally {
    configLoading.set(false);
  }
}

// Update configuration (admin only)
export async function updateConfig(newConfig: Config, showToast = true) {
  try {
    await apiUpdateConfig(newConfig);
    config.set(newConfig);
    if (showToast) {
      toast.success('Changes saved');
    }
  } catch (error) {
    logError('Config update', error);

    // Check if it's a session expiration error
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      toast.error('Your session has expired. Please refresh the page and log in again.');
    } else {
      toast.error('Failed to save changes');
    }
    throw error;
  }
}

// Helper to find a dashboard by path or ID
export function findDashboard(pathOrId: string, cfg: Config): Dashboard | undefined {
  // Handle both "/home" and "home" formats
  const normalizedPath = pathOrId.startsWith('/') ? pathOrId : `/${pathOrId}`;
  return cfg.dashboards.find((d) => d.path === normalizedPath || d.id === pathOrId || d.path === pathOrId);
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
  const currentConfig = get(config);
  if (!currentConfig) {
    throw new Error('No configuration loaded');
  }

  const dashboardIndex = currentConfig.dashboards.findIndex(d => d.id === updatedDashboard.id);
  if (dashboardIndex === -1) {
    throw new Error('Dashboard not found');
  }

  const newConfig: Config = {
    ...currentConfig,
    dashboards: [
      ...currentConfig.dashboards.slice(0, dashboardIndex),
      updatedDashboard,
      ...currentConfig.dashboards.slice(dashboardIndex + 1)
    ]
  };

  await updateConfig(newConfig);
  config.set(newConfig);
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

    const newConfig: Config = {
      ...currentConfig,
      dashboards: [
        ...currentConfig.dashboards.slice(0, dashboardIndex),
        result,
        ...currentConfig.dashboards.slice(dashboardIndex + 1)
      ]
    };

    await updateConfig(newConfig);
    config.set(newConfig);
  });
}
