import { writable, get } from 'svelte/store';
import { getStatus as apiGetStatus } from '$lib/utils/api';
import { logError } from '$lib/utils/errors';

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
let subscriberCount = 0;
let isPolling = false;

/**
 * Sentinel returned by fetchStatus when the previous status should be
 * kept (e.g. server unreachable, or session expired — global handlers
 * cover both). The poller drops these instead of writing them into the
 * store so tiles don't all flip to a misleading "unknown".
 */
const KEEP_PREVIOUS = Symbol('keep-previous');

export async function fetchStatus(entryId: string): Promise<StatusInfo | typeof KEEP_PREVIOUS> {
  try {
    const data = await apiGetStatus(entryId);
    return {
      status: data.status || 'unknown',
      responseTime: data.responseTime,
      lastChecked: data.lastChecked
    };
  } catch (error) {
    // SESSION_EXPIRED → the global session-expired handler is already
    //   clearing auth + redirecting. Don't touch the status.
    // Network errors → the offline watcher in network.ts is already
    //   surfacing the outage via the banner + StatusIndicator's offline
    //   icon. Freezing the per-tile status at its last known value
    //   reads better than flipping every tile to "unknown".
    logError('Status fetch', error);
    return KEEP_PREVIOUS;
  }
}

export function subscribeToStatus(entryId: string) {
  activeEntries.add(entryId);
  subscriberCount++;

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
    if (status === KEEP_PREVIOUS) return;
    statusStore.update(store => {
      const newStore = new Map(store);
      newStore.set(entryId, status);
      return newStore;
    });
  });

  // Start polling if not already running (guarded by flag to prevent races)
  if (!isPolling) {
    isPolling = true;
    pollInterval = setInterval(pollAllStatuses, POLL_INTERVAL);
  }

  return {
    unsubscribe: () => {
      subscriberCount--;
      activeEntries.delete(entryId);

      // Only stop polling when all subscribers have unsubscribed
      if (subscriberCount <= 0 && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        isPolling = false;
        subscriberCount = 0;
      }
    }
  };
}

async function pollAllStatuses() {
  // Snapshot active entries to avoid mutation during iteration
  const entries = [...activeEntries];

  // Fetch all statuses concurrently instead of sequentially
  const results = await Promise.allSettled(
    entries.map(async (entryId) => {
      const status = await fetchStatus(entryId);
      return { entryId, status };
    })
  );

  statusStore.update(store => {
    const newStore = new Map(store);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.status !== KEEP_PREVIOUS) {
        newStore.set(result.value.entryId, result.value.status as StatusInfo);
      }
    }
    return newStore;
  });
}

export function getStatus(entryId: string): StatusInfo | undefined {
  return get(statusStore).get(entryId);
}

export { statusStore };
