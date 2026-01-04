import { writable, get } from 'svelte/store';

export interface StatusInfo {
  status: 'up' | 'down' | 'error' | 'unknown' | 'loading';
  responseTime?: number;
  lastChecked?: string;
}

// Store for all entry statuses
const statusStore = writable<Map<string, StatusInfo>>(new Map());

// Polling interval in ms (30 seconds)
const POLL_INTERVAL = 30000;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const activeEntries = new Set<string>();

export async function fetchStatus(entryId: string): Promise<StatusInfo> {
  try {
    const response = await fetch(`/api/status/${entryId}`);
    if (!response.ok) {
      return { status: 'unknown' };
    }
    const data = await response.json();
    return {
      status: data.status || 'unknown',
      responseTime: data.responseTime,
      lastChecked: data.lastChecked
    };
  } catch (error) {
    return { status: 'unknown' };
  }
}

export function subscribeToStatus(entryId: string) {
  activeEntries.add(entryId);

  // Set initial loading state
  statusStore.update(store => {
    const newStore = new Map(store);
    if (!newStore.has(entryId)) {
      newStore.set(entryId, { status: 'loading' });
    }
    return newStore;
  });

  // Fetch immediately
  fetchStatus(entryId).then(status => {
    statusStore.update(store => {
      const newStore = new Map(store);
      newStore.set(entryId, status);
      return newStore;
    });
  });

  // Start polling if not already running
  if (!pollInterval) {
    pollInterval = setInterval(pollAllStatuses, POLL_INTERVAL);
  }

  return {
    unsubscribe: () => {
      activeEntries.delete(entryId);
      if (activeEntries.size === 0 && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  };
}

async function pollAllStatuses() {
  for (const entryId of activeEntries) {
    const status = await fetchStatus(entryId);
    statusStore.update(store => {
      const newStore = new Map(store);
      newStore.set(entryId, status);
      return newStore;
    });
  }
}

export function getStatus(entryId: string): StatusInfo | undefined {
  return get(statusStore).get(entryId);
}

export { statusStore };
