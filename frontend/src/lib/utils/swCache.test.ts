import { describe, it, expect } from 'vitest';
import { swMayCache, isCacheableApiPath, offlineFallbackFor, precacheList, SHELL_PATH, KEPT_HEADER, markKept, noteKept, isKept } from './swCache';

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
  const entries = precacheList(['/_app/a.js'], ['/favicon.svg'], 'http://h:1/');
  const shell = entries.filter((e): e is Request => e instanceof Request);

  it('keeps the build, the static files and the page itself', () => {
    // SvelteKit's build and files lists never name the fallback page: it has to be added here.
    expect(entries.slice(0, 2)).toEqual(['/_app/a.js', '/favicon.svg']);
    expect(shell.map((r) => r.url)).toEqual(['http://h:1/']);
    expect(new URL(shell[0].url).pathname).toBe(SHELL_PATH);
  });
  it('takes the page from the server, never an old copy in the browser cache', () => {
    // An old page names old chunks, which this version does not keep.
    expect(shell[0].cache).toBe('reload');
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
