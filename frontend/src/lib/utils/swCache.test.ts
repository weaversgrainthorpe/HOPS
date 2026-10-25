import { describe, it, expect } from 'vitest';
import { swMayCache } from './swCache';

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
