/**
 * Whether the service worker may keep a copy of this API response for offline use. A response
 * the server marks `no-store` (e.g. GET /api/config carrying admin-only backup notices) is never
 * stored, so admin content can't be served from the cache later.
 */
export function swMayCache(res: Pick<Response, 'ok' | 'headers'>): boolean {
  return res.ok && !/\bno-store\b/i.test(res.headers.get('Cache-Control') ?? '');
}
