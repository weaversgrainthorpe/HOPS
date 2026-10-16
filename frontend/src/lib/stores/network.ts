import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

// Online/offline tracking for the PWA. Two signals combined:
//
//   1. navigator.onLine — instant, but only knows whether the OS thinks
//      it has a network connection. Useless for the "Wi-Fi is up but the
//      HOPS server isn't reachable" case.
//   2. A periodic heartbeat to /api/version — catches server-side outage
//      while the device is still on the LAN. Cheap (200 B response).
//
// Anything that needs to render "are we offline?" should read from
// `isOffline`. Anything that wants a friendly "since when?" string can
// derive it from `offlineSince`.

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

/** True if either the OS or our heartbeat thinks we can't reach the server. */
export const isOffline = writable(false);

/** When did we first detect we were offline? Resets to null when we recover. */
export const offlineSince = writable<Date | null>(null);

/**
 * Version the server reports (from the heartbeat), or null until known.
 * Compared against the version baked into this UI bundle so a stale UI
 * (e.g. an old on-disk build served via --frontend) is surfaced, not silent.
 */
export const serverVersion = writable<string | null>(null);

/** The server version when it differs from this UI's build, else null. */
export const uiVersionMismatch = derived(serverVersion, ($v) =>
  $v && $v !== __APP_VERSION__ ? $v : null
);

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function probeServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    const resp = await fetch('/api/version', { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (resp.ok) {
      try {
        const data = await resp.json();
        if (typeof data?.version === 'string') serverVersion.set(data.version);
      } catch {
        // Reachable but unparsable — reachability is what we report here.
      }
    }
    return resp.ok;
  } catch {
    return false;
  }
}

function setOnline() {
  if (!get(isOffline)) return;
  isOffline.set(false);
  offlineSince.set(null);
}

function setOffline() {
  if (get(isOffline)) return;
  isOffline.set(true);
  offlineSince.set(new Date());
}

async function heartbeat() {
  const browserOnline = browser ? navigator.onLine : true;
  if (!browserOnline) {
    setOffline();
    return;
  }
  const reachable = await probeServer();
  if (reachable) setOnline();
  else setOffline();
}

/** Start the heartbeat + wire up the browser online/offline events. Call once. */
export function initNetworkWatcher() {
  if (!browser) return;
  if (heartbeatTimer) return; // idempotent

  // Initial state from the browser
  if (!navigator.onLine) setOffline();

  // React to immediate browser events
  window.addEventListener('online', () => {
    // The browser says we're back — confirm by hitting the server. If the
    // server is down, the heartbeat will flip us back to offline.
    heartbeat();
  });
  window.addEventListener('offline', () => setOffline());

  // Probe once now (also learns the server version), then periodically.
  heartbeat();
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
}

export function stopNetworkWatcher() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Human-friendly "X minutes ago"-style label derived from `offlineSince`. */
export const offlineSinceLabel = derived(offlineSince, ($since) => {
  if (!$since) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - $since.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
});
