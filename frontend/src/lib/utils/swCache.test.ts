import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swMayCache, isCacheableApiPath, isKeptConfigRead, offlineFallbackFor, precacheList, shellRequest, isAppShell, SHELL_PATH, KEPT_HEADER, KEPT_WAIT_MS, networkOrKept, markKept, noteKept, isKept } from './swCache';

const res = (ok: boolean, cc?: string) => ({ ok, headers: new Headers(cc ? { 'Cache-Control': cc } : {}) });

describe('swMayCache', () => {
  it('keeps ordinary successful responses for offline use', () => {
    expect(swMayCache(res(true))).toBe(true);
    expect(swMayCache(res(true, 'public, max-age=60'))).toBe(true);
  });
  it('never keeps no-store (admin) responses or failures', () => {
    expect(swMayCache(res(true, 'private, no-store'))).toBe(false);
    expect(swMayCache(res(false))).toBe(false);
  });
});

describe('isCacheableApiPath / offlineFallbackFor', () => {
  it('keeps every config read for offline use, as /api/config was', () => {
    expect(isCacheableApiPath('/api/config')).toBe(true);
    expect(isCacheableApiPath('/api/config/dashboard/home')).toBe(true);
    expect(isCacheableApiPath('/api/auth/check')).toBe(false);
    expect(isCacheableApiPath('/api/config/import')).toBe(false);
  });
  it('never keeps /api/version: it is how the app learns the server is down', () => {
    expect(isCacheableApiPath('/api/version')).toBe(false);
  });
  it('an index-plus-one read with no copy falls back to the whole config; nothing else does', () => {
    expect(offlineFallbackFor(new URL('http://h/api/config?dashboard=home'))).toBe('/api/config');
    expect(offlineFallbackFor(new URL('http://h/api/config?dashboard='))).toBe('/api/config');
    expect(offlineFallbackFor(new URL('http://h/api/config'))).toBeNull();
    expect(offlineFallbackFor(new URL('http://h/api/config/dashboard/home'))).toBeNull();
  });
});

describe('precacheList', () => {
  it('keeps the build and the static files', () => {
    expect(precacheList(['/_app/a.js'], ['/favicon.svg'])).toEqual(['/_app/a.js', '/favicon.svg']);
  });
});

describe('shellRequest', () => {
  it('asks for the page itself, which SvelteKit never lists', () => {
    expect(new URL(shellRequest('http://h:1/').url).pathname).toBe(SHELL_PATH);
  });
  it('takes the page from the server, never an old copy in the browser cache', () => {
    // An old page names old chunks, which this version does not keep.
    expect(shellRequest('http://h:1/').cache).toBe('reload');
  });
});

describe('isAppShell', () => {
  const html = (body: string, init: ResponseInit = {}) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...init });
  const page = '<script src="/_app/immutable/entry/start.js"></script>';

  it('takes the real page', async () => {
    expect(await isAppShell(html(page))).toBe(true);
  });
  it("refuses a proxy's 200 sign-in page", async () => {
    expect(await isAppShell(html('<form action="/login"><input type="password"></form>'))).toBe(false);
  });
  it('refuses a failed answer, even with the right body', async () => {
    expect(await isAppShell(html(page, { status: 500 }))).toBe(false);
  });
  it('refuses something that is not a page', async () => {
    expect(await isAppShell(new Response(page, { headers: { 'Content-Type': 'application/json' } }))).toBe(false);
  });
  it('refuses a redirect to somewhere else', async () => {
    const res = html(page);
    Object.defineProperty(res, 'redirected', { value: true });
    expect(await isAppShell(res)).toBe(false);
  });
});

describe('kept answers', () => {
  it('a marked answer keeps its body, status and headers', async () => {
    const res = markKept(new Response('{"a":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(res.headers.get(KEPT_HEADER)).toBe('1');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });
  it('the note sits beside the answer, never in it', () => {
    const answer = noteKept({ dashboards: [] });
    expect(isKept(answer)).toBe(true);
    expect(JSON.stringify(answer)).toBe('{"dashboards":[]}');
    expect(isKept({ dashboards: [] })).toBe(false);
    expect(isKept(null)).toBe(false);
    expect(noteKept(null)).toBeNull();
  });
});

describe('isKeptConfigRead', () => {
  it('is the config reads, and not the kept icons', () => {
    expect(isKeptConfigRead('/api/config')).toBe(true);
    expect(isKeptConfigRead('/api/config/dashboard/home')).toBe(true);
    expect(isKeptConfigRead('/api/icons/dashboard/a.png')).toBe(false);
    expect(isKeptConfigRead('/api/config/import')).toBe(false);
  });
});

describe('networkOrKept', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const deferred = () => {
    let resolve!: (r: Response) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const kept = () => async () => new Response('kept');
  const none = async () => undefined;
  /** Whether `p` has settled yet, after the promises due have run. */
  const settled = async (p: Promise<unknown>) => {
    let done = false;
    void p.then(() => (done = true), () => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    return done;
  };

  it('stays under the client limit', () => {
    expect(KEPT_WAIT_MS).toBe(45_000);
  });

  it('answers from the network, unmarked, when it lands in time', async () => {
    const net = deferred();
    const read = vi.fn(kept());
    const answer = networkOrKept(net.promise, read, KEPT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS - 1);
    net.resolve(new Response('fresh'));
    const res = await answer;
    expect(await res.text()).toBe('fresh');
    expect(res.headers.get(KEPT_HEADER)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('answers from the kept copy, marked, once the limit passes, and the network goes on', async () => {
    const net = deferred();
    const answer = networkOrKept(net.promise, kept(), KEPT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS - 1);
    expect(await settled(answer)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await answer;
    expect(await res.text()).toBe('kept');
    expect(res.headers.get(KEPT_HEADER)).toBe('1');
    // The caller's own promise is untouched: it still finishes and refreshes the copy.
    net.resolve(new Response('fresh'));
    expect(await (await net.promise).text()).toBe('fresh');
  });

  it('with no kept copy it keeps waiting past the limit, and takes the late answer unmarked', async () => {
    const net = deferred();
    const answer = networkOrKept(net.promise, none, KEPT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS * 10);
    expect(await settled(answer)).toBe(false);
    net.resolve(new Response('late'));
    const res = await answer;
    expect(await res.text()).toBe('late');
    expect(res.headers.get(KEPT_HEADER)).toBeNull();
  });

  it('a kept copy that cannot be read at the limit never fails early: it keeps waiting', async () => {
    const net = deferred();
    const answer = networkOrKept(net.promise, async () => { throw new Error('cache broken'); }, KEPT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS + 1);
    expect(await settled(answer)).toBe(false);
    net.resolve(new Response('late'));
    expect(await (await answer).text()).toBe('late');
  });

  it('a network failure with no kept copy past the limit is the offline answer, as before', async () => {
    const net = deferred();
    const answer = networkOrKept(net.promise, none, KEPT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS + 1);
    net.reject(new TypeError('failed'));
    const res = await answer;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'offline' });
  });

  it('a network failure inside the limit answers from the kept copy at once, marked', async () => {
    const net = deferred();
    const answer = networkOrKept(net.promise, kept(), KEPT_WAIT_MS);
    net.reject(new TypeError('failed'));
    const res = await answer;
    expect(res.headers.get(KEPT_HEADER)).toBe('1');
    expect(await res.text()).toBe('kept');
  });

  it('an error answer from the server is passed on, not swapped for a kept copy', async () => {
    const res = await networkOrKept(Promise.resolve(new Response('no', { status: 500 })), kept(), KEPT_WAIT_MS);
    expect(res.status).toBe(500);
  });

  it('with no limit (kept icons) it never gives up on the network', async () => {
    const net = deferred();
    const read = vi.fn(kept());
    const answer = networkOrKept(net.promise, read, null);
    await vi.advanceTimersByTimeAsync(KEPT_WAIT_MS * 10);
    expect(await settled(answer)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    net.resolve(new Response('fresh'));
    expect(await (await answer).text()).toBe('fresh');
  });
});
