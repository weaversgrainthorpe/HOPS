import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';

// A search result's request to show one tile (moved from the removed pop-over store, M5 Task 3).
describe('reveal request lifetime', () => {
  it('expires after a short TTL with one visible notice', async () => {
    const { vi } = await import('vitest');
    const { requestReveal, revealRequest, REVEAL_TTL_MS } = await import('./reveal');
    const { toast } = await import('./toast');
    vi.useFakeTimers();
    try {
      toast.clear();
      const spy = vi.spyOn(toast, 'error');
      requestReveal({ dashboardId: 'd1', tabId: 't1', folderIds: [], tileId: 'x' });
      vi.advanceTimersByTime(REVEAL_TTL_MS - 1);
      expect(get(revealRequest)).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(get(revealRequest)).toBeNull();
      vi.advanceTimersByTime(REVEAL_TTL_MS * 2);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is cleared by navigation elsewhere, kept by navigation to its dashboard, and consumed once', async () => {
    const { requestReveal, revealRequest, revealNavigation, takeReveal } = await import('./reveal');
    requestReveal({ dashboardId: 'd1', tabId: 't1', folderIds: [], tileId: 'x' });
    revealNavigation('d1');
    expect(get(revealRequest)?.dashboardId).toBe('d1');
    expect(takeReveal('d2')).toBeNull();
    expect(takeReveal('d1')?.tileId).toBe('x');
    expect(takeReveal('d1')).toBeNull();

    requestReveal({ dashboardId: 'd1', tabId: 't1', folderIds: [], tileId: 'x' });
    revealNavigation('d2');
    expect(get(revealRequest)).toBeNull();
    requestReveal({ dashboardId: 'd1', tabId: 't1', folderIds: [], tileId: 'x' });
    revealNavigation(null);
    expect(get(revealRequest)).toBeNull();
  });
});
