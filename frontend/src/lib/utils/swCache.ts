/**
 * Whether the service worker may keep a copy of this API response for offline use. A response
 * the server marks `no-store` (e.g. GET /api/config carrying admin-only backup notices) is never
 * stored, so admin content can't be served from the cache later.
 */
export function swMayCache(res: Pick<Response, 'ok' | 'headers'>): boolean {
  return res.ok && !/\bno-store\b/i.test(res.headers.get('Cache-Control') ?? '');
}

/**
 * The API reads the service worker keeps (network first, the cached copy offline) so a dashboard
 * still renders offline. The config reads are kept per address: the whole config, the
 * index-plus-one form (`/api/config?dashboard=…`) and the one-dashboard read
 * (`/api/config/dashboard/…`). `/api/version` is left out on purpose: it is how the app learns the
 * server is down, and a kept copy would answer "up" and hide the offline banner.
 */
export function isCacheableApiPath(pathname: string): boolean {
  return (
    pathname === '/api/config' ||
    pathname.startsWith('/api/config/dashboard/') ||
    pathname.startsWith('/api/icons/dashboard/') ||
    pathname.startsWith('/api/icons/uploaded/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/backgrounds/')
  );
}

/**
 * Offline, with no copy of this exact read: another kept answer that serves it. The index-plus-one
 * read falls back to the whole config (every dashboard in full is a valid answer to it), so a page
 * kept before partial loading existed still opens offline. Null: no fallback.
 */
export function offlineFallbackFor(url: URL): string | null {
  return url.pathname === '/api/config' && url.searchParams.has('dashboard') ? '/api/config' : null;
}

/** The address of the app's one HTML page: every path the server doesn't know serves the same page. */
export const SHELL_PATH = '/';

/** What the service worker keeps at install, beside the page itself (see shellRequest). */
export function precacheList(build: string[], files: string[]): string[] {
  return [...build, ...files];
}

/**
 * SvelteKit's `build` and `files` lists never name the fallback page (index.html); without it no
 * offline navigation has a page to show. The page is always taken from the server (`reload`): a
 * copy from the browser's own cache could be the previous version, naming chunks this version
 * doesn't keep.
 */
export function shellRequest(origin: string): Request {
  return new Request(new URL(SHELL_PATH, origin), { cache: 'reload' });
}

/**
 * Whether `res` really is HOPS's page. A proxy in front can answer 200 with its own sign-in page,
 * which must never be kept and shown as the app during an outage.
 */
export async function isAppShell(res: Response): Promise<boolean> {
  if (!res.ok || res.redirected || !/html/i.test(res.headers.get('Content-Type') ?? '')) return false;
  return (await res.text()).includes('/_app/immutable/');
}

/** Set by the service worker on an answer it gave from a kept copy, not from the server. */
export const KEPT_HEADER = 'X-HOPS-Kept-Copy';

/** A kept answer, marked so the app knows it isn't the server's. */
export function markKept(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(KEPT_HEADER, '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// The answers that came from a kept copy. Beside the data, not in it: a config can be saved back
// or exported, and the mark must never go with it.
const keptAnswers = new WeakSet<object>();

/** Note `answer` as read from a kept copy. Returns it. */
export function noteKept<T>(answer: T): T {
  if (typeof answer === 'object' && answer !== null) keptAnswers.add(answer);
  return answer;
}

export function isKept(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && keptAnswers.has(answer);
}
