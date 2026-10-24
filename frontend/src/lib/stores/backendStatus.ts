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
      // Reached, but no version in the answer: degraded, never "online, version unknown".
      const version = result && typeof result.version === 'string' && result.version ? result.version : null;

      update(state => ({
        ...state,
        status: version ? 'online' : 'error',
        version,
        responseTime: Math.round(endTime - startTime),
        lastCheck: new Date()
      }));
    } catch (e) {
      // fetch rejects with a TypeError when the server can't be reached at all (offline); any other
      // error means it answered, with an error status (degraded). The two are shown differently.
      update(state => ({
        ...state,
        status: e instanceof TypeError ? 'offline' : 'error',
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

  // Auto-cleanup if the page is unloaded (safety net for missed stopPolling calls)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', stopPolling);
  }

  return {
    subscribe,
    check,
    startPolling,
    stopPolling,
    reset: () => { stopPolling(); set(initialState); }
  };
}

export const backendStatus = createBackendStatusStore();

// Derived stores for convenience
export const isBackendOnline = derived(
  backendStatus,
  $status => $status.status === 'online'
);

// Unusable for actions that need the backend: unreachable (offline) or answering with errors
// (degraded). Both were "offline" before the two were told apart; the guards keep that behaviour.
export const isBackendOffline = derived(
  backendStatus,
  $status => $status.status === 'offline' || $status.status === 'error'
);

export const isBackendChecking = derived(
  backendStatus,
  $status => $status.status === 'checking'
);
