import { writable, derived } from 'svelte/store';
import { getBackendVersion, HttpStatusError } from '$lib/utils/api';

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
      // Offline: fetch rejects with a TypeError (the server can't be reached at all), or a proxy in
      // front answers 502/503/504 (the backend behind it is down). Any other error means the backend
      // answered, with an error (degraded). The two are shown differently.
      const down = e instanceof TypeError || (e instanceof HttpStatusError && [502, 503, 504].includes(e.status));
      update(state => ({
        ...state,
        status: down ? 'offline' : 'error',
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
