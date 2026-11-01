import { describe, it, expect } from 'vitest';
import { swMayCache, isCacheableApiPath, offlineFallbackFor } from './swCache';

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
  it('an index-plus-one read with no copy falls back to the whole config; nothing else does', () => {
    expect(offlineFallbackFor(new URL('http://h/api/config?dashboard=home'))).toBe('/api/config');
    expect(offlineFallbackFor(new URL('http://h/api/config?dashboard='))).toBe('/api/config');
    expect(offlineFallbackFor(new URL('http://h/api/config'))).toBeNull();
    expect(offlineFallbackFor(new URL('http://h/api/config/dashboard/home'))).toBeNull();
  });
});
