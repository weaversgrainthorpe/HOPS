import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { overlayStack, openFolder, closeTop, closeAll, reconcile } from './folderOverlay';
import type { LayoutDoc } from '$lib/types/layout';

const f = (id: string, children: any[] = []): any => ({
  kind: 'folder', id, name: id, display: 'collapsed', placement: { x: 0, y: 0, w: 2, h: 2 }, size: 'medium', contentSize: 'medium', content: { children }
});
const doc = (children: any[]): LayoutDoc => ({
  schemaVersion: 3,
  dashboards: [{ id: 'd1', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't1', name: 'T', root: { columns: 24, children } }] }]
});

beforeEach(() => closeAll());

describe('folderOverlay store', () => {
  it('pushes, pops and clears', () => {
    openFolder('a'); openFolder('b');
    expect(get(overlayStack)).toEqual(['a', 'b']);
    closeTop();
    expect(get(overlayStack)).toEqual(['a']);
    closeAll();
    expect(get(overlayStack)).toEqual([]);
  });

  it('reconcile keeps ids that exist, including nested ones', () => {
    openFolder('a'); openFolder('b');
    expect(reconcile(doc([f('a', [f('b')])]), 'd1')).toEqual([]);
    expect(get(overlayStack)).toEqual(['a', 'b']);
  });

  it('reconcile drops from the bottom-most missing id upward', () => {
    openFolder('a'); openFolder('gone'); openFolder('b');
    expect(reconcile(doc([f('a'), f('b')]), 'd1')).toEqual(['gone', 'b']);
    expect(get(overlayStack)).toEqual(['a']);
  });

  it('reconcile drops everything when the doc or dashboard is missing', () => {
    openFolder('a');
    expect(reconcile(null, 'd1')).toEqual(['a']);
    openFolder('a');
    expect(reconcile(doc([f('a')]), 'other')).toEqual(['a']);
    expect(get(overlayStack)).toEqual([]);
  });
});

describe('reveal request lifetime', () => {
  it('expires after a short TTL with one visible notice', async () => {
    const { vi } = await import('vitest');
    const { requestReveal, revealRequest, REVEAL_TTL_MS } = await import('./folderOverlay');
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
    const { requestReveal, revealRequest, revealNavigation, takeReveal } = await import('./folderOverlay');
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
