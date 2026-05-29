/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

// HOPS PWA service worker.
//
// What we cache:
//   - The SvelteKit build output (JS, CSS, fonts) — the SPA shell.
//   - Static files (favicons, icons, backgrounds) referenced from /static.
//   - /api/config — the dashboard data. When offline, the last-seen
//     dashboard layout still renders.
//   - /api/version + the dashboard's tile icons — so tiles look right
//     offline rather than going blank.
//
// What we don't cache:
//   - Auth calls (/api/auth/*) — stale auth is worse than no auth.
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

const PRECACHE_URLS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
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

function isCacheableApiPath(pathname: string): boolean {
  return (
    pathname === '/api/config' ||
    pathname === '/api/version' ||
    pathname.startsWith('/api/icons/dashboard/') ||
    pathname.startsWith('/api/icons/uploaded/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/backgrounds/')
  );
}

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
          const shell = (await cache.match('/')) ?? (await cache.match('/index.html'));
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

    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(request, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      })(),
    );
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
