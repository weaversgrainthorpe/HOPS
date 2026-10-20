import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  folderViewFor, setFolderView, clearFolderView, effectiveDisplay, applyFolderViews, resetFolderViewsForTests
} from './folderView';
import type { LayoutDashboard } from '$lib/types/layout';

const KEY = 'hops.folderView.d1';
const f = (id: string, extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', placement: { x: 0, y: 0, w: 2, h: 2 }, content: { columns: 4, children: [] }, ...extra
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
  const dash = (children: any[], layout?: any): LayoutDashboard => ({
    id: 'd1', name: 'D', path: '/d', revision: 1, defaultLayout: layout,
    tabs: [{ id: 't1', name: 'T', root: { columns: 12, children } }]
  });
  it('returns the same tab when nothing is remembered; ignores unknown ids', () => {
    const d = dash([f('a')]);
    expect(applyFolderViews(d, d.tabs[0], {})).toBe(d.tabs[0]);
    expect(applyFolderViews(d, d.tabs[0], { gone: 'collapsed' })).toBe(d.tabs[0]);
  });
  it('a minimised grid folder becomes one cell at its x,y; siblings are untouched', () => {
    const d = dash([f('a', { placement: { x: 3, y: 1, w: 4, h: 3 } }), f('b', { placement: { x: 7, y: 0, w: 2, h: 2 } })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'collapsed' });
    const [a, b] = t.root.children as any[];
    expect(a.display).toBe('collapsed');
    expect(a.placement).toMatchObject({ x: 3, y: 1, w: 1, h: 1 });
    expect(a.content.columns).toBe(4);
    expect(b).toBe(d.tabs[0].root.children[1]);
  });
  it('a minimised free folder becomes round(designWidth/12/8) units square', () => {
    const d = dash([f('a', { placement: { x: 10, y: 20, w: 40, h: 30 } })], 'free');
    const t = applyFolderViews(d, { ...d.tabs[0], designWidth: 1280 }, { a: 'collapsed' });
    expect((t.root.children[0] as any).placement).toMatchObject({ x: 10, y: 20, w: 13, h: 13 });
  });
  it('expanded and maximised override a saved collapsed default, keeping its placement', () => {
    const d = dash([f('a', { display: 'collapsed' }), f('b', { display: 'collapsed' })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'expanded', b: 'maximised' });
    expect((t.root.children as any[]).map((c) => c.display)).toEqual(['expanded', 'expanded']);
    expect((t.root.children[0] as any).placement).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
  it('a remembered collapsed on a saved-collapsed folder keeps its size', () => {
    const d = dash([f('a', { display: 'collapsed' })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'collapsed' });
    expect((t.root.children[0] as any).placement.w).toBe(2);
  });
  it('reaches nested folders', () => {
    const d = dash([f('o', { content: { columns: 4, children: [f('i')] } })]);
    const t = applyFolderViews(d, d.tabs[0], { i: 'collapsed' });
    expect(((t.root.children[0] as any).content.children[0]).display).toBe('collapsed');
  });
});
