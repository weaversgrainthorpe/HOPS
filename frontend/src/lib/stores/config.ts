import { writable, derived } from 'svelte/store';
import type { Config, Dashboard } from '$lib/types';
import { getConfig, updateConfig as apiUpdateConfig } from '$lib/utils/api';

// Create a writable store for the config
export const config = writable<Config | null>(null);

// Derived store for dashboards
export const dashboards = derived(config, ($config) => $config?.dashboards || []);

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
  return cfg.dashboards.find((d) => d.path === pathOrId || d.id === pathOrId);
}
