import { writable, derived } from 'svelte/store';
import type { Config, Dashboard } from '$lib/types';
import { getConfig, updateConfig as apiUpdateConfig } from '$lib/utils/api';
import { page } from '$app/stores';

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
    console.error('Failed to load config:', error);
    configError.set(error instanceof Error ? error.message : 'Failed to load configuration');
  } finally {
    configLoading.set(false);
  }
}

// Update configuration (admin only)
export async function updateConfig(newConfig: Config) {
  try {
    await apiUpdateConfig(newConfig);
    config.set(newConfig);
  } catch (error) {
    console.error('Failed to update config:', error);
    throw error;
  }
}

// Helper to find a dashboard by path or ID
export function findDashboard(pathOrId: string, cfg: Config): Dashboard | undefined {
  // Handle both "/home" and "home" formats
  const normalizedPath = pathOrId.startsWith('/') ? pathOrId : `/${pathOrId}`;
  return cfg.dashboards.find((d) => d.path === normalizedPath || d.id === pathOrId || d.path === pathOrId);
}

// Update a specific dashboard
export async function updateDashboard(updatedDashboard: Dashboard) {
  let currentConfig: Config | null = null;
  const unsubscribe = config.subscribe(c => currentConfig = c);
  unsubscribe();

  if (!currentConfig) {
    throw new Error('No configuration loaded');
  }

  const dashboardIndex = currentConfig.dashboards.findIndex(d => d.id === updatedDashboard.id);
  if (dashboardIndex === -1) {
    throw new Error('Dashboard not found');
  }

  const newConfig = {
    ...currentConfig,
    dashboards: [
      ...currentConfig.dashboards.slice(0, dashboardIndex),
      updatedDashboard,
      ...currentConfig.dashboards.slice(dashboardIndex + 1)
    ]
  };

  // Update backend
  await updateConfig(newConfig);

  // Update local store to trigger reactivity
  config.set(newConfig);
}
