/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { isCacheableApiPath, isKeptConfigRead, offlineFallbackFor, networkOrKept, fetchAndKeep, precacheList, shellRequest, isAppShell, KEPT_WAIT_MS, SHELL_PATH } from '$lib/utils/swCache';

// HOPS PWA service worker.
//
// What we cache:
//   - The SvelteKit build output (JS, CSS, fonts) and the HTML page — the SPA shell.
//   - Static files (favicons, icons, backgrounds) referenced from /static.
//   - /api/config, its ?dashboard= form and /api/config/dashboard/… — the
//     dashboard data. When offline, the last-seen dashboard layout still
//     renders (an index-plus-one read with no copy falls back to the whole
//     config's copy). A kept answer is marked (KEPT_HEADER), so the app can
//     say what it is showing and read again once the server answers. On a
//     slow link the same marked copy answers a config read still running
//     after KEPT_WAIT_MS, before the app's own limit gives the read up; the
//     read carries on and refreshes the copy. With no copy it just keeps
//     waiting.
//   - The dashboard's tile icons — so tiles look right offline rather than
//     going blank.
//
// What we don't cache:
//   - Auth calls (/api/auth/*) — stale auth is worse than no auth.
//   - /api/version — the app's reachability probe. A kept copy would say the
//     server is up when it isn't, and old data would show with no banner.
//   - Status checks (/api/status/*) — would freeze indicators at last
//     known state, which the UI already does via the navigator.onLine
//     hook on top of the SW, so the SW staying out of the way is right.
//   - Anything mutating (POST/PUT/DELETE) — let those fail loudly when
//     offline so the user knows the change didn't go through.
//
// Navigation (HTML) requests get the SPA shell when offline, so deep links
// like /my-dashboard still work — client-side routing takes over once the
// shell loads.

const sw = self as unknown as ServiceWorkerGlobalScope;

const PRECACHE = `hops-precache-${version}`;
const RUNTIME = `hops-runtime-${version}`;

/** The kept answer to this read: its own copy, or another that serves it (offlineFallbackFor). */
async function keptCopyOf(request: Request, url: URL): Promise<Response | undefined> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fallback = offlineFallbackFor(url);
  return fallback ? caches.match(fallback) : undefined;
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Checked first, so a proxy's sign-in page keeps nothing at all. A failed install is shown by
      // the page (lib/stores/offlineCopy.ts).
      const shell = await fetch(shellRequest(sw.location.origin));
      if (!(await isAppShell(shell.clone()))) throw new Error("The server's answer is not the HOPS page");
      const cache = await caches.open(PRECACHE);
      await cache.addAll(precacheList(build, files));
      await cache.put(shellRequest(sw.location.origin), shell);
    })(),
  );
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== PRECACHE && key !== RUNTIME) return caches.delete(key);
          return undefined;
        }),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // 1) Navigation requests — try network, fall back to the SPA shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(PRECACHE);
          const shell = await cache.match(SHELL_PATH);
          if (shell) return shell;
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
    return;
  }

  // 2) API — selective. Most paths are network-only. The cacheable few use
  //    network-first with cached fallback so the dashboard renders offline.
  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableApiPath(url.pathname)) return;

    const network = fetchAndKeep(request, (r) => fetch(r), () => caches.open(RUNTIME));
    // Answered from a kept copy, the worker must still live to see this read refresh it.
    event.waitUntil(network.then(() => undefined, () => undefined));
    event.respondWith(networkOrKept(network, () => keptCopyOf(request, url), isKeptConfigRead(url.pathname) ? KEPT_WAIT_MS : null));
    return;
  }

  // 3) Static assets — cache-first, fall through to network.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(RUNTIME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })(),
  );
});
