import { describe, it, expect } from 'vitest';
import { resizeTarget } from './resize';
import type { FolderNode, LayoutDashboard, LayoutNode, Placement } from '../types/layout';

// Resize limits are never silent: a size clamped to the folder's minimum (or the tab's width) says so.
const p = (x: number, y: number, w: number, h: number): Placement => ({ x, y, w, h });
const tile = (id: string): LayoutNode => ({ kind: 'tile', id, name: id, url: 'http://x', size: 'medium' }) as unknown as LayoutNode;
const folder = (id: string, pl: Placement): FolderNode =>
  ({ kind: 'folder', id, name: 'Box', display: 'expanded', size: 'medium', contentSize: 'medium', placement: pl, content: { children: [tile('k')] } }) as FolderNode;
const dash = (pl: Placement): LayoutDashboard =>
  ({ id: 'd', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [folder('f', pl)] } }] }) as unknown as LayoutDashboard;

describe('resizeTarget limits', () => {
  it('grows in height freely: no limit note', () => {
    const t = resizeTarget(dash(p(0, 0, 8, 6)), 'f', 8, 9);
    expect(t.kind).toBe('resize');
    if (t.kind !== 'resize') return;
    expect(t.at).toMatchObject({ w: 8, h: 9 });
    expect(t.limit).toBeUndefined();
  });
  it('below the minimum height: clamped, and the limit is told', () => {
    const t = resizeTarget(dash(p(0, 0, 8, 8)), 'f', 8, 2);
    expect(t.kind).toBe('resize');
    if (t.kind !== 'resize') return;
    expect(t.at.h).toBe(4); // the Medium minimum at the reference cell
    expect(t.limit).toMatch(/can't be any shorter/i);
  });
  it('below the minimum width: clamped, and the limit is told', () => {
    const t = resizeTarget(dash(p(0, 0, 8, 8)), 'f', 1, 8);
    if (t.kind !== 'resize') throw new Error(t.reason);
    expect(t.at.w).toBe(3);
    expect(t.limit).toMatch(/can't be any narrower/i);
  });
  it('wider than the tab: clamped, and the limit is told', () => {
    const t = resizeTarget(dash(p(20, 0, 4, 8)), 'f', 9, 8);
    if (t.kind !== 'resize') throw new Error(t.reason);
    expect(t.at.w).toBe(4);
    expect(t.limit).toMatch(/can't be any wider/i);
  });
});
