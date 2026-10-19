import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/api', () => ({ getStatus: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ logError: vi.fn() }));

import { getStatus as apiGetStatus } from '$lib/utils/api';
import { fetchStatus, isStatusStale, staleReason } from './status';

beforeEach(() => vi.clearAllMocks());

describe('fetchStatus', () => {
  it('returns fresh data on success', async () => {
    vi.mocked(apiGetStatus).mockResolvedValue({ status: 'up', responseTime: 5, lastChecked: 'x' });
    const r = await fetchStatus('e1');
    expect(r.status).toBe('up');
    expect(r.fetchError).toBeUndefined();
  });

  it('marks the previous value with fetchError when the fetch fails (503)', async () => {
    vi.mocked(apiGetStatus).mockRejectedValue(new Error('Config unavailable'));
    const r = await fetchStatus('e1', { status: 'up', lastChecked: 'old' });
    expect(r.status).toBe('up');
    expect(r.fetchError).toBe('Config unavailable');
    expect(isStatusStale(r)).toBe(true);
  });

  it('a failed first fetch yields unknown + fetchError, not loading', async () => {
    vi.mocked(apiGetStatus).mockRejectedValue(new Error('nope'));
    const r = await fetchStatus('e1', { status: 'loading' });
    expect(r).toEqual({ status: 'unknown', fetchError: 'nope' });
  });
});

describe('isStatusStale', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  it('fresh up row is not stale', () => {
    expect(isStatusStale({ status: 'up', lastChecked: '2026-10-19T11:58:00Z' }, now)).toBe(false);
  });
  it('up row older than 2x interval is stale', () => {
    expect(isStatusStale({ status: 'up', lastChecked: '2026-10-19T11:40:00Z' }, now)).toBe(true);
  });
  it('honours a reported interval', () => {
    const info = { status: 'up' as const, lastChecked: '2026-10-19T11:40:00Z', intervalMinutes: 30 };
    expect(isStatusStale(info, now)).toBe(false);
  });
  it('down rows are exempt from the age rule (server backoff)', () => {
    expect(isStatusStale({ status: 'down', lastChecked: '2026-10-19T08:00:00Z' }, now)).toBe(false);
  });
  it('explains why in the tooltip text', () => {
    expect(staleReason({ status: 'up', fetchError: 'Config unavailable' })).toContain('Config unavailable');
  });
});

describe('now tick store', () => {
  it('ticks every 30s while subscribed and stops after unsubscribe', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const { now, NOW_TICK_MS } = await import('./status');
    const seen: number[] = [];
    const unsub = now.subscribe((v) => seen.push(v));
    const first = seen.length;
    vi.advanceTimersByTime(NOW_TICK_MS * 2);
    expect(seen.length).toBe(first + 2);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[first - 1]);
    unsub();
    vi.advanceTimersByTime(NOW_TICK_MS * 2);
    expect(seen.length).toBe(first + 2);
    vi.useRealTimers();
  });

  it('an up row flips to stale once the clock passes 2x interval', () => {
    const info = { status: 'up' as const, lastChecked: '2026-10-19T12:00:00Z' };
    const t0 = Date.parse('2026-10-19T12:00:00Z');
    expect(isStatusStale(info, t0 + 60_000)).toBe(false);
    expect(isStatusStale(info, t0 + 11 * 60_000)).toBe(true);
  });
});
