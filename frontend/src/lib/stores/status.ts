import { writable, readable, get } from 'svelte/store';
import { getStatus as apiGetStatus } from '$lib/utils/api';
import { logError } from '$lib/utils/errors';

export interface StatusInfo {
  status: 'up' | 'down' | 'error' | 'unknown' | 'loading' | 'disabled';
  responseTime?: number;
  lastChecked?: string;
  /** Minutes between server-side probes, when the server reports it. */
  intervalMinutes?: number;
  /** Set when the last status fetch failed: the values above are old data. */
  fetchError?: string;
  /** The level whose setting decided on/off (M4 §4b): global | dashboard | tab | folder | tile | invalid. */
  source?: string;
  /** That level's id ("" for global). */
  sourceId?: string;
}

/**
 * Shared wall clock, ticking every 30s while anything subscribes, so
 * staleness is re-evaluated even when polling has stopped or failed.
 */
export const NOW_TICK_MS = 30_000;
export const now = readable(Date.now(), (set) => {
  set(Date.now());
  const id = setInterval(() => set(Date.now()), NOW_TICK_MS);
  return () => clearInterval(id);
});

/** Server-side default probe interval, used when the response has none. */
export const DEFAULT_INTERVAL_MINUTES = 5;

/**
 * True when a status must NOT be rendered as fresh: the last fetch failed,
 * or an "up" row's lastChecked is older than ~2x its probe interval. (Down
 * rows are exempt from the age rule: the server backs them off up to 32x.)
 */
export function isStatusStale(info: StatusInfo, now: number = Date.now()): boolean {
  if (info.fetchError) return true;
  if (info.status !== 'up' || !info.lastChecked) return false;
  const checked = Date.parse(info.lastChecked);
  if (Number.isNaN(checked)) return false;
  const interval = info.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  return now - checked > 2 * interval * 60_000;
}

/** Human-readable reason a status is stale, for tooltips. */
export function staleReason(info: StatusInfo): string {
  if (info.fetchError) return `Status unavailable (${info.fetchError}) \u2014 showing the last known value.`;
  return 'Status is out of date \u2014 the server has not re-checked this recently.';
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
 * Fetch one entry's status. A failed fetch is NEVER hidden: it returns the
 * previous value (if any) marked with `fetchError`, so tiles can show a
 * degraded "unavailable/stale" state instead of last status posing as current.
 */
export async function fetchStatus(entryId: string, previous?: StatusInfo): Promise<StatusInfo> {
  try {
    const data = await apiGetStatus(entryId);
    return {
      status: data.status || 'unknown',
      responseTime: data.responseTime,
      lastChecked: data.lastChecked,
      // The tile's resolved probe interval from the server; anything that
      // isn't a positive number falls back to the default in isStatusStale.
      intervalMinutes:
        typeof data.intervalMinutes === 'number' && data.intervalMinutes > 0 ? data.intervalMinutes : undefined,
      ...(typeof data.source === 'string' ? { source: data.source } : {}),
      ...(typeof data.sourceId === 'string' ? { sourceId: data.sourceId } : {})
    };
  } catch (error) {
    logError('Status fetch', error);
    const message = error instanceof Error ? error.message : 'fetch failed';
    const base: StatusInfo = previous && previous.status !== 'loading' ? previous : { status: 'unknown' };
    return { ...base, fetchError: message };
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
  fetchStatus(entryId, getStatus(entryId)).then(status => {
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
      const status = await fetchStatus(entryId, getStatus(entryId));
      return { entryId, status };
    })
  );

  statusStore.update(store => {
    const newStore = new Map(store);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newStore.set(result.value.entryId, result.value.status);
      }
    }
    return newStore;
  });
}

export function getStatus(entryId: string): StatusInfo | undefined {
  return get(statusStore).get(entryId);
}

export { statusStore };
