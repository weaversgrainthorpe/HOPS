import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { overlayStack, openFolder, closeTop, closeAll, reconcile } from './folderOverlay';
import type { LayoutDoc } from '$lib/types/layout';

const f = (id: string, children: any[] = []): any => ({
  kind: 'folder', id, name: id, display: 'collapsed', placement: { x: 0, y: 0, w: 1, h: 1 }, content: { columns: 1, children }
});
const doc = (children: any[]): LayoutDoc => ({
  schemaVersion: 3,
  dashboards: [{ id: 'd1', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't1', name: 'T', root: { columns: 12, children } }] }]
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
