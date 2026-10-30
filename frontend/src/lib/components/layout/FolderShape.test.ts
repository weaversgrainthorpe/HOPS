// ONE FolderShape draws every folder state — minimised, open and nested — in each of the
// seven looks. Tab shapes put the name on the tab and the minimise
// control and edit handle at the top-right of the body; Rounded keeps the plain title bar. An unknown
// shape draws as Rounded with a visible note in edit mode. The shape is decoration (aria-hidden).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import FolderShape from './FolderShape.svelte';
import { config } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import { resetFolderViewsForTests, setFolderDrill, folderNavFor } from '$lib/stores/folderView';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { clearSelection } from '$lib/stores/nodeSelection';
import { FOLDER_SHAPES, TAB_POSITIONS } from '$lib/layout/geometry';

let width = 1440;
let shapeH: number | undefined; // the measured height of every folder shape (the canvas's one observer)
class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width, height: shapeH } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
const kid = (id: string): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0 });
const kids = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => kid(`${p}${i + 1}`));
const sub = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium', content: { children }, ...extra
});
const folder = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: { x: 0, y: 0, w: 12, h: 8 }, content: { children }, ...extra
});
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 24, children } };
  return { dash: { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] }, tab };
}
async function renderTab(children: any[]) {
  const { dash, tab } = mk(children);
  config.set({ schemaVersion: 3, layoutVersion: 2, dashboards: [dash] } as any);
  const r = render(TabCanvas, { dashboard: dash, tab });
  await tick();
  return r;
}
async function renderEditing(children: any[]) {
  const { dash } = mk(children);
  config.set({ schemaVersion: 3, layoutVersion: 2, dashboards: [dash] } as any);
  begin('d1');
  editMode.set(true);
  const d = get(session)!.draft;
  const r = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
  await tick();
  return r;
}
const el = (c: ParentNode, id: string) => c.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const shapeOfEl = (e: Element) => e.querySelector('[data-folder-shape]') as HTMLElement;

beforeEach(() => {
  width = 1440;
  shapeH = undefined;
  localStorage.clear();
  resetFolderViewsForTests();
  editMode.set(false);
  resetEditSessionForTests();
  clearSelection();
  vi.stubGlobal('ResizeObserver', FakeRO);
});
afterEach(() => { vi.unstubAllGlobals(); config.set(null); editMode.set(false); });

const TAB_SHAPES = FOLDER_SHAPES.filter((s) => s !== 'rounded');

describe('every shape at every state draws through FolderShape', () => {
  for (const shape of FOLDER_SHAPES) {
    it(`${shape}: minimised, open and nested, in view and edit mode`, async () => {
      for (const editing of [false, true]) {
        const tree = [
          folder('m', kids(3), { shape, display: 'collapsed' }),
          folder('o', [sub('s', kids(2), { shape })], { shape, placement: { x: 12, y: 0, w: 12, h: 10 } })
        ];
        const r = editing ? await renderEditing(tree) : await renderTab(tree);
        const min = shapeOfEl(el(r.container, 'm'));
        expect(min.getAttribute('data-folder-shape')).toBe(shape);
        expect(min.getAttribute('data-shape-state')).toBe('minimised');
        const open = el(r.container, 'o');
        expect(open.querySelector(':scope > [data-folder-shape]')!.getAttribute('data-shape-state')).toBe('open');
        setFolderDrill('d1', 'o', ['s']);
        await tick();
        const nested = open.querySelector('[data-nested-folder="s"]') as HTMLElement;
        const ns = nested.querySelector(':scope > [data-folder-shape]');
        if (shape === 'rounded') expect(ns).toBeNull(); // the plain inset box (no colour of its own)
        else expect(ns!.getAttribute('data-shape-state')).toBe('nested');
        r.unmount();
        resetFolderViewsForTests();
        resetEditSessionForTests();
        editMode.set(false);
      }
    });
  }
  it('the shape is decoration: aria-hidden, and never in the accessibility tree', async () => {
    const { container } = await renderTab([folder('o', kids(2), { shape: 'folder-paper', color: '#2563eb' })]);
    const s = shapeOfEl(el(container, 'o'));
    expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(s.querySelector('svg')).toBeTruthy();
    expect(s.querySelectorAll('linearGradient').length).toBeLessThanOrEqual(1);
    expect(s.querySelector('filter, animate, animateTransform')).toBeNull();
  });
});

describe('tab shapes: the name on the tab, the controls at the top-right of the body', () => {
  for (const shape of TAB_SHAPES) {
    it(`${shape}: name on the tab; minimise and edit handle in the body's controls row`, async () => {
      const { container } = await renderEditing([folder('o', kids(2), { shape, name: 'Media' })]);
      const box = el(container, 'o');
      const tab = box.querySelector('[data-folder-tab]') as HTMLElement;
      expect(tab.textContent).toContain('Media');
      const header = box.querySelector(':scope > .folder-header') as HTMLElement;
      const ctl = header.querySelector('.folder-controls')!;
      expect(tab.contains(ctl)).toBe(false);
      expect(header.querySelector('.handle-slot')).toBeTruthy();
      expect(tab.querySelector('.handle-slot, .folder-controls')).toBeNull();
      expect(header.querySelector('h3')).toBeNull(); // the name is not repeated in the body
    });
  }
  it('Rounded keeps the plain title bar: name, handle and minimise in one bar; no tab', async () => {
    const { container } = await renderEditing([folder('o', kids(2), { shape: 'rounded', name: 'Media' })]);
    const box = el(container, 'o');
    expect(box.querySelector('[data-folder-tab]')).toBeNull();
    const header = box.querySelector(':scope > .folder-header') as HTMLElement;
    expect(within(header).getByText('Media')).toBeTruthy();
    expect(header.querySelector('.folder-controls')).toBeTruthy();
  });
  it('an untitled tab-shape folder has an empty tab (still the go-up target)', async () => {
    const { container } = await renderTab([folder('o', kids(2), { shape: 'folder-flat', showTitle: false })]);
    const tab = el(container, 'o').querySelector('[data-folder-tab]') as HTMLElement;
    expect(tab.textContent!.trim()).toBe('');
  });
  for (const pos of TAB_POSITIONS) {
    it(`tab position ${pos} is drawn (data-tab-position) and moves the label`, async () => {
      const { container } = await renderTab([folder('o', kids(2), { shape: 'folder-flat', tabPosition: pos })]);
      const box = el(container, 'o');
      expect(shapeOfEl(box).getAttribute('data-tab-position')).toBe(pos);
      expect((box.querySelector('[data-folder-tab]') as HTMLElement).getAttribute('data-tab-position')).toBe(pos);
    });
  }
  it('drilled in: the outer tab is data-crumb and a click on it goes up', async () => {
    const { container } = await renderTab([folder('o', [sub('s', kids(2), { shape: 'folder-flat' })], { shape: 'folder-flat', placement: { x: 0, y: 0, w: 12, h: 10 } })]);
    setFolderDrill('d1', 'o', ['s']);
    await tick();
    const tab = el(container, 'o').querySelector(':scope > .folder-header [data-folder-tab]') as HTMLElement;
    expect(tab.getAttribute('data-crumb')).toBe('o');
    await fireEvent.click(within(tab).getByRole('button', { name: 'o' }));
    expect(get(folderNavFor('d1')).drill.o ?? []).toEqual([]);
  });
  it('a nested tab shape draws its own tab with its name, and no blank band (its tab fills the allowance)', async () => {
    const { container } = await renderTab([folder('o', [sub('s', kids(2), { shape: 'folder-cartoon', name: 'Inner' })], { shape: 'folder-flat', placement: { x: 0, y: 0, w: 12, h: 10 } })]);
    setFolderDrill('d1', 'o', ['s']);
    await tick();
    const nested = el(container, 'o').querySelector('[data-nested-folder="s"]') as HTMLElement;
    expect(nested.classList.contains('tabbed')).toBe(true);
    expect((nested.querySelector('[data-folder-tab]') as HTMLElement).textContent).toContain('Inner');
  });
  it('a nested Rounded box has no tab and no blank band above it', async () => {
    const { container } = await renderTab([folder('o', [sub('s', kids(2), { shape: 'rounded' })], { shape: 'folder-flat', placement: { x: 0, y: 0, w: 12, h: 10 } })]);
    setFolderDrill('d1', 'o', ['s']);
    await tick();
    const nested = el(container, 'o').querySelector('[data-nested-folder="s"]') as HTMLElement;
    expect(nested.classList.contains('tabbed')).toBe(false);
    expect(nested.querySelector('[data-folder-tab]')).toBeNull();
  });
});

describe('minimised', () => {
  it('a tab shape shows the name on the front; the Small silhouette hides it (accessible name stays)', async () => {
    shapeH = 120;
    const r = await renderTab([folder('m', kids(3), { shape: 'folder-flat', display: 'collapsed' })]);
    expect(el(r.container, 'm').querySelector('.collapsed-name')).toBeTruthy();
    r.unmount();
    shapeH = 50;
    const r2 = await renderTab([folder('m', kids(3), { shape: 'folder-flat', display: 'collapsed', size: 'small' })]);
    const t = el(r2.container, 'm');
    expect(t.querySelector('.collapsed-name')).toBeNull();
    expect(t.querySelectorAll('.preview-cell').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^m, folder with 3 items/ })).toBeTruthy();
  });
  it('the shapes are measured by the canvas\'s one ResizeObserver (Tenet 4)', async () => {
    let made = 0;
    class CountingRO extends FakeRO { constructor(cb: ResizeObserverCallback) { super(cb); made++; } }
    vi.stubGlobal('ResizeObserver', CountingRO);
    await renderTab([folder('m', kids(3), { shape: 'folder-flat', display: 'collapsed' }), folder('o', kids(2), { shape: 'folder-paper', placement: { x: 12, y: 0, w: 12, h: 8 } })]);
    expect(made).toBe(1);
  });
});

describe('unknown shape: drawn Rounded with a visible note in edit mode', () => {
  it('view mode: Rounded, no note; edit mode: the note names the value', async () => {
    const tree = [folder('o', kids(2), { shape: 'folder-tab' }), folder('m', kids(1), { shape: 'blob', display: 'collapsed', placement: { x: 12, y: 0, w: 6, h: 8 } })];
    const r = await renderTab(tree);
    expect(shapeOfEl(el(r.container, 'o')).getAttribute('data-folder-shape')).toBe('rounded');
    expect(r.container.querySelector('[data-shape-unknown]')).toBeNull();
    r.unmount();
    const e = await renderEditing(tree);
    const n1 = el(e.container, 'o').querySelector('[data-shape-unknown]') as HTMLElement;
    expect(n1.textContent).toMatch(/folder-tab/);
    expect(n1.textContent).toMatch(/Rounded/i);
    expect((el(e.container, 'm').querySelector('[data-shape-unknown]') as HTMLElement).textContent).toMatch(/blob/);
  });
  it('a missing shape is plain Rounded (no note): the default for existing folders', async () => {
    await renderEditing([folder('o', kids(2))]);
    expect(document.querySelector('[data-shape-unknown]')).toBeNull();
  });
});

describe('FolderShape alone (the picker previews use it too)', () => {
  it('Rounded with no background draws the plain surface; a tab shape draws paths in the folder colour', () => {
    const r = render(FolderShape, { look: { shape: 'rounded', color: '#2563eb' }, variant: 'open', dashboardId: 'd1' });
    expect(r.container.querySelector('[data-folder-shape="rounded"] svg')).toBeNull();
    r.unmount();
    const t = render(FolderShape, { look: { shape: 'folder-flat', color: '#2563eb' }, variant: 'minimised', dashboardId: 'd1' });
    const paths = t.container.querySelectorAll('[data-folder-shape="folder-flat"] path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
  it('opacity applies to the whole shape', () => {
    const r = render(FolderShape, { look: { shape: 'folder-flat', color: '#2563eb', opacity: 0.4 }, variant: 'open', dashboardId: 'd1' });
    expect((r.container.querySelector('[data-shape-paint]') as HTMLElement).style.opacity).toBe('0.4');
    // The focus ring is outside the faded layer (WCAG 2.4.7): nothing between it and the shape is faded.
    const ring = r.container.querySelector('[data-focus-ring]') as SVGElement;
    expect(ring.closest('[data-shape-paint]')).toBeNull();
    expect((r.container.querySelector('[data-folder-shape]') as HTMLElement).style.opacity).toBe('');
  });
  it('a background picture fills the front panel, clipped to it', () => {
    const r = render(FolderShape, {
      look: { shape: 'folder-open', color: '#2563eb', background: { type: 'color', value: '#ff0000' } as any },
      variant: 'open', dashboardId: 'd1'
    });
    const front = r.container.querySelector('[data-shape-front]') as HTMLElement;
    expect(front).toBeTruthy();
    expect(front.querySelector('.folder-surface')).toBeTruthy();
  });
});
