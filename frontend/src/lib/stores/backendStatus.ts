import { writable, derived } from 'svelte/store';
import { getBackendVersion } from '$lib/utils/api';

export type BackendStatusType = 'checking' | 'online' | 'offline' | 'error';

interface BackendState {
  status: BackendStatusType;
  version: string | null;
  responseTime: number | null;
  lastCheck: Date | null;
}

const initialState: BackendState = {
  status: 'checking',
  version: null,
  responseTime: null,
  lastCheck: null
};

function createBackendStatusStore() {
  const { subscribe, set, update } = writable<BackendState>(initialState);
  let intervalId: ReturnType<typeof setInterval> | undefined;

  async function check() {
    const startTime = performance.now();

    try {
      const result = await getBackendVersion();
      const endTime = performance.now();

      update(state => ({
        ...state,
        status: 'online',
        version: result.version || 'unknown',
        responseTime: Math.round(endTime - startTime),
        lastCheck: new Date()
      }));
    } catch {
      update(state => ({
        ...state,
        status: 'offline',
        version: null,
        responseTime: null,
        lastCheck: new Date()
      }));
    }
  }

  function startPolling(intervalMs = 30000) {
    check(); // Check immediately
    if (intervalId) {
      clearInterval(intervalId);
    }
    intervalId = setInterval(check, intervalMs);
  }

  function stopPolling() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  }

  return {
    subscribe,
    check,
    startPolling,
    stopPolling,
    reset: () => set(initialState)
  };
}

export const backendStatus = createBackendStatusStore();

// Derived stores for convenience
export const isBackendOnline = derived(
  backendStatus,
  $status => $status.status === 'online'
);

export const isBackendOffline = derived(
  backendStatus,
  $status => $status.status === 'offline'
);

export const isBackendChecking = derived(
  backendStatus,
  $status => $status.status === 'checking'
);
