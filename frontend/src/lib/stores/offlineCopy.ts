import { writable } from 'svelte/store';
import { dev } from '$app/environment';
import { toast } from './toast';

// Whether this browser holds a copy of HOPS to open while the server is down. Registered here, not
// by SvelteKit, because its own registration only logs a failure to the console: a copy that could
// not be stored must be said, and it decides whether the page opens at all during an outage.

/**
 * 'needs-https': browsers run a service worker only on https:// or localhost.
 * 'unavailable': this browser can't, or it is blocked here; nothing went wrong.
 */
export type OfflineCopyState = 'checking' | 'ready' | 'needs-https' | 'unavailable' | 'failed';

export const offlineCopy = writable<OfflineCopyState>('checking');

export const OFFLINE_COPY_FAILED =
  "HOPS couldn't save its offline copy, so this browser may not open it while the server is down.";

function failed(): void {
  offlineCopy.set('failed');
  toast.error(OFFLINE_COPY_FAILED);
}

function follow(registration: ServiceWorkerRegistration): void {
  const seen = new WeakSet<ServiceWorker>();
  const watch = (worker: ServiceWorker | null) => {
    if (!worker || seen.has(worker)) return;
    seen.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') offlineCopy.set('ready');
      // An install that fails ends here. Replaced by a newer one, that one is now installing.
      else if (worker.state === 'redundant' && !registration.installing && !registration.waiting) failed();
    });
  };
  const pending = registration.installing ?? registration.waiting;
  if (pending) watch(pending);
  else if (registration.active) offlineCopy.set('ready');
  registration.addEventListener('updatefound', () => watch(registration.installing));
}

export async function startOfflineCopy(): Promise<void> {
  if (dev) {
    offlineCopy.set('unavailable');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    offlineCopy.set(window.isSecureContext ? 'unavailable' : 'needs-https');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    if (registration) follow(registration);
    else offlineCopy.set('unavailable');
  } catch {
    failed();
  }
}
