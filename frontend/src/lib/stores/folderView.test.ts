import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  folderViewFor, setFolderView, clearFolderView, effectiveDisplay, applyFolderViews, resetFolderViewsForTests
} from './folderView';
import type { LayoutDashboard } from '$lib/types/layout';

const KEY = 'hops.folderView.d1';
const f = (id: string, extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', placement: { x: 0, y: 0, w: 2, h: 2 }, size: 'medium', contentSize: 'medium', content: { children: [] }, ...extra
});

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetFolderViewsForTests();
});

describe('folderView store', () => {
  it.each(['collapsed', 'expanded', 'maximised'] as const)('persists %s under the exact key', (s) => {
    setFolderView('d1', 'f1', s);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ f1: s });
    expect(get(folderViewFor('d1'))).toEqual({ f1: s });
  });
  it('a second maximised entry clears the first', () => {
    setFolderView('d1', 'a', 'maximised');
    setFolderView('d1', 'b', 'maximised');
    expect(get(folderViewFor('d1'))).toEqual({ b: 'maximised' });
  });
  it('maximising keeps non-maximised entries', () => {
    setFolderView('d1', 'a', 'collapsed');
    setFolderView('d1', 'b', 'maximised');
    expect(get(folderViewFor('d1'))).toEqual({ a: 'collapsed', b: 'maximised' });
  });
  it('Restore removes the entry', () => {
    setFolderView('d1', 'a', 'collapsed');
    clearFolderView('d1', 'a');
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
  });
  it('setItem throwing: works in memory, no error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => setFolderView('d1', 'a', 'collapsed')).not.toThrow();
    expect(get(folderViewFor('d1'))).toEqual({ a: 'collapsed' });
  });
  it('getItem throwing: empty, no error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(get(folderViewFor('d1'))).toEqual({});
  });
  it('corrupt JSON reads as empty', () => {
    localStorage.setItem(KEY, '{nope');
    expect(get(folderViewFor('d1'))).toEqual({});
  });
  it('non-object JSON and invalid values are dropped', () => {
    localStorage.setItem(KEY, '[1]');
    expect(get(folderViewFor('d1'))).toEqual({});
    resetFolderViewsForTests();
    localStorage.setItem(KEY, JSON.stringify({ a: 'collapsed', b: 'weird', c: 3 }));
    expect(get(folderViewFor('d1'))).toEqual({ a: 'collapsed' });
  });
  it('stored data with two maximised keeps one', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 'maximised', b: 'maximised' }));
    expect(Object.values(get(folderViewFor('d1'))).filter((v) => v === 'maximised').length).toBe(1);
  });
  it('dashboards are independent', () => {
    setFolderView('d1', 'a', 'collapsed');
    expect(get(folderViewFor('d2'))).toEqual({});
  });
});

describe('effectiveDisplay', () => {
  it('follows the saved display without an entry', () => {
    expect(effectiveDisplay(f('a'), undefined)).toBe('expanded');
    expect(effectiveDisplay(f('a', { display: 'collapsed' }), undefined)).toBe('collapsed');
  });
  it('a remembered view beats the saved default, including after the default changes', () => {
    expect(effectiveDisplay(f('a', { display: 'expanded' }), 'collapsed')).toBe('collapsed');
    expect(effectiveDisplay(f('a', { display: 'collapsed' }), 'collapsed')).toBe('collapsed');
    expect(effectiveDisplay(f('a', { display: 'collapsed' }), 'expanded')).toBe('expanded');
    expect(effectiveDisplay(f('a', { display: 'collapsed' }), 'maximised')).toBe('expanded');
  });
});

describe('applyFolderViews', () => {
  const dash = (children: any[]): LayoutDashboard => ({
    id: 'd1', name: 'D', path: '/d', revision: 1,
    tabs: [{ id: 't1', name: 'T', root: { columns: 24, children } }]
  });
  it('returns the same tab when nothing is remembered; ignores unknown ids', () => {
    const d = dash([f('a')]);
    expect(applyFolderViews(d, d.tabs[0], {})).toBe(d.tabs[0]);
    expect(applyFolderViews(d, d.tabs[0], { gone: 'collapsed' })).toBe(d.tabs[0]);
  });
  it('a minimised Medium folder becomes one Medium tile (2 x 2) at its x,y; siblings are untouched', () => {
    const d = dash([f('a', { placement: { x: 6, y: 2, w: 8, h: 6 } }), f('b', { placement: { x: 14, y: 0, w: 4, h: 4 } })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'collapsed' });
    const [a, b] = t.root.children as any[];
    expect(a.display).toBe('collapsed');
    expect(a.placement).toMatchObject({ x: 6, y: 2, w: 2, h: 2 });
    expect(a.content).toBe((d.tabs[0].root.children[0] as any).content); // its contents are untouched
    expect(b).toBe(d.tabs[0].root.children[1]);
  });
  it('a minimised folder is a tile of its own size (M5 §3a.2)', () => {
    const d = dash([f('a', { size: 'large', placement: { x: 10, y: 20, w: 8, h: 6 } })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'collapsed' });
    expect((t.root.children[0] as any).placement).toEqual({ x: 10, y: 20, w: 4, h: 4 });
  });
  it('expanded and maximised override a saved collapsed default, keeping its placement', () => {
    const d = dash([f('a', { display: 'collapsed' }), f('b', { display: 'collapsed' })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'expanded', b: 'maximised' });
    expect((t.root.children as any[]).map((c) => c.display)).toEqual(['expanded', 'expanded']);
    expect((t.root.children[0] as any).placement).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
  it('a saved-collapsed (Medium) folder is one Medium tile with no remembered view; stored data is untouched', () => {
    const d = dash([f('a', { display: 'collapsed', placement: { x: 2, y: 4, w: 24, h: 6 } })]);
    const orig = JSON.stringify(d);
    const t = applyFolderViews(d, d.tabs[0], {});
    expect((t.root.children[0] as any).placement).toMatchObject({ x: 2, y: 4, w: 2, h: 2 });
    expect(JSON.stringify(d)).toBe(orig);
  });
  it('reaches nested folders', () => {
    const d = dash([f('o', { content: { children: [{ ...f('i'), placement: undefined }] } })]);
    const t = applyFolderViews(d, d.tabs[0], { i: 'collapsed' });
    expect(((t.root.children[0] as any).content.children[0]).display).toBe('collapsed');
  });
});
