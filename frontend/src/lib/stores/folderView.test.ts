import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  folderViewFor, setFolderView, clearFolderView, effectiveDisplay, applyFolderViews, resetFolderViewsForTests,
  folderNavFor, setFolderPage, setFolderDrill, resolveDrill, reconcileNav, revealInFolders, pageReveal, takePageReveal,
  drillTo
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
  it.each(['collapsed', 'expanded'] as const)('persists %s under the exact key', (s) => {
    setFolderView('d1', 'f1', s);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ f1: s });
    expect(get(folderViewFor('d1'))).toEqual({ f1: s });
  });
  it('two states only (M5 §2): a stored "maximised" (older build) reads as expanded (open)', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 'maximised', b: 'maximised', c: 'collapsed' }));
    expect(get(folderViewFor('d1'))).toEqual({ a: 'expanded', b: 'expanded', c: 'collapsed' });
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
  it('expanded overrides a saved collapsed default, keeping its placement', () => {
    const d = dash([f('a', { display: 'collapsed' }), f('b', { display: 'collapsed' })]);
    const t = applyFolderViews(d, d.tabs[0], { a: 'expanded', b: 'expanded' });
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

// ---- M5 Task 3: per-browser page and drill-down memory (viewer conveniences, never saved to the layout).
const NAV = 'hops.folderNav.d1';
const sub = (id: string, children: any[] = []): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium', content: { children }
});
const kid = (id: string): any => ({ kind: 'tile', id, name: id, url: 'http://x.test' });

describe('page and drill-down memory', () => {
  it('remembers each folder\'s page and each open folder\'s drill path, under its own key', () => {
    setFolderPage('d1', 'f1', 2);
    setFolderDrill('d1', 'f1', ['s1', 's2']);
    expect(get(folderNavFor('d1'))).toEqual({ page: { f1: 2 }, drill: { f1: ['s1', 's2'] } });
    expect(JSON.parse(localStorage.getItem(NAV)!)).toEqual({ page: { f1: 2 }, drill: { f1: ['s1', 's2'] } });
    expect(get(folderNavFor('d2'))).toEqual({ page: {}, drill: {} });
  });
  it('page 0 and an empty path forget the entry', () => {
    setFolderPage('d1', 'f1', 2);
    setFolderDrill('d1', 'f1', ['s1']);
    setFolderPage('d1', 'f1', 0);
    setFolderDrill('d1', 'f1', []);
    expect(get(folderNavFor('d1'))).toEqual({ page: {}, drill: {} });
  });
  it('a bad page is refused loudly (a caller bug), never stored', () => {
    for (const bad of [-1, 1.5, NaN, Infinity]) expect(() => setFolderPage('d1', 'f1', bad)).toThrow();
    expect(get(folderNavFor('d1'))).toEqual({ page: {}, drill: {} });
  });
  it('corrupt or unreadable storage reads as no memory (a viewing convenience, not data)', () => {
    localStorage.setItem(NAV, '{nope');
    expect(get(folderNavFor('d1'))).toEqual({ page: {}, drill: {} });
    resetFolderViewsForTests();
    localStorage.setItem(NAV, JSON.stringify({ page: { a: 1, b: -2, c: 'x', d: 1.5 }, drill: { a: ['s'], b: 'no', c: [1], d: [] } }));
    expect(get(folderNavFor('d1'))).toEqual({ page: { a: 1 }, drill: { a: ['s'] } });
    resetFolderViewsForTests();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(get(folderNavFor('d1'))).toEqual({ page: {}, drill: {} });
  });
  it('setItem throwing: works in memory, no error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => setFolderPage('d1', 'a', 1)).not.toThrow();
    expect(get(folderNavFor('d1')).page).toEqual({ a: 1 });
  });
  it('drillTo opens a chain in place: the outermost folder remembers the path below it', () => {
    drillTo('d1', ['top', 'a', 'b']);
    expect(get(folderNavFor('d1')).drill).toEqual({ top: ['a', 'b'] });
    drillTo('d1', ['top']);
    expect(get(folderNavFor('d1')).drill).toEqual({});
  });
});

describe('resolveDrill: the remembered path, as far as it still holds', () => {
  const top = sub('top', [kid('k'), sub('a', [sub('b', [kid('deep')])])]);
  it('walks the sub-folders in order', () => {
    expect(resolveDrill(top, ['a', 'b']).map((x) => x.id)).toEqual(['a', 'b']);
    expect(resolveDrill(top, []).map((x) => x.id)).toEqual([]);
  });
  it('stops at the first id that is no longer a sub-folder there (a tile, gone or moved)', () => {
    expect(resolveDrill(top, ['a', 'gone', 'b']).map((x) => x.id)).toEqual(['a']);
    expect(resolveDrill(top, ['k']).map((x) => x.id)).toEqual([]);
    expect(resolveDrill(top, ['b']).map((x) => x.id)).toEqual([]);
  });
});

describe('reconcileNav: a drilled-into folder that has gone is closed, and the caller says so', () => {
  const dash = (children: any[]): LayoutDashboard => ({
    id: 'd1', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't1', name: 'T', root: { columns: 24, children } }]
  });
  it('trims a broken path and returns the folder whose path changed', () => {
    setFolderDrill('d1', 'top', ['a', 'b']);
    const d = dash([f('top', { content: { children: [sub('a')] } })]);
    expect(reconcileNav('d1', d.tabs[0])).toEqual(['top']);
    expect(get(folderNavFor('d1')).drill).toEqual({ top: ['a'] });
    expect(reconcileNav('d1', d.tabs[0])).toEqual([]);
  });
  it('leaves memory for folders on other tabs alone', () => {
    setFolderDrill('d1', 'elsewhere', ['x']);
    expect(reconcileNav('d1', dash([]).tabs[0])).toEqual([]);
    expect(get(folderNavFor('d1')).drill).toEqual({ elsewhere: ['x'] });
  });
});

describe('revealInFolders: search opens the chain in place, drills down and asks for the tile\'s page', () => {
  it('writes this browser\'s open, drill-down and pending page memory, as if the user had done it', () => {
    revealInFolders('d1', ['top', 'a', 'b'], 'deep');
    expect(get(folderViewFor('d1'))).toEqual({ top: 'expanded' });
    expect(get(folderNavFor('d1')).drill).toEqual({ top: ['a', 'b'] });
    expect(get(pageReveal)).toEqual({ dashboardId: 'd1', folderId: 'b', itemId: 'deep' });
    expect(takePageReveal('d1', 'a')).toBeNull();
    expect(takePageReveal('d1', 'b')).toEqual({ dashboardId: 'd1', folderId: 'b', itemId: 'deep' });
    expect(get(pageReveal)).toBeNull();
  });
  it('edit mode (view: false) writes the drill-down and page request but never the viewer\'s view', () => {
    revealInFolders('d1', ['top', 'a'], 'x', { view: false });
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(folderNavFor('d1')).drill).toEqual({ top: ['a'] });
    expect(get(pageReveal)).toEqual({ dashboardId: 'd1', folderId: 'a', itemId: 'x' });
  });
  it('a tile on the tab itself needs no folder memory', () => {
    revealInFolders('d1', [], 'x');
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(pageReveal)).toBeNull();
  });
});
