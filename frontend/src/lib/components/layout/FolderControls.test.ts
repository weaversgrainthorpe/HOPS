import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { closeAll } from '$lib/stores/folderOverlay';
import { editMode } from '$lib/stores/editMode';
import { folderViewFor, setFolderView, resetFolderViewsForTests } from '$lib/stores/folderView';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';

let width = 1440;
class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
const tile = (id: string, x = 0, y = 0): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 1, h: 1 } });
const folder = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', placement: { x: 2, y: 1, w: 4, h: 3 }, content: { columns: 4, children }, ...extra
});
function mk(children: any[], tabId = 't1'): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: tabId, name: 'Main', root: { columns: 12, children } };
  return { dash: { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] }, tab };
}
async function renderTab(children: any[], tabId = 't1') {
  const { dash, tab } = mk(children, tabId);
  config.set({ layout: { schemaVersion: 3, dashboards: [dash] } } as any);
  const r = render(TabCanvas, { dashboard: dash, tab });
  await tick();
  return { ...r, dash, tab };
}
const el = (c: HTMLElement, id: string) => c.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  width = 1440;
  localStorage.clear();
  resetFolderViewsForTests();
  editMode.set(false);
  vi.stubGlobal('ResizeObserver', FakeRO);
  closeAll();
});
afterEach(() => { vi.unstubAllGlobals(); config.set(null); editMode.set(false); });

describe('folder controls', () => {
  it('an expanded folder shows minimise and maximise with aria-label and title; no restore at default', async () => {
    await renderTab([folder('f1', [tile('a')])]);
    for (const n of ['Minimise folder', 'Maximise folder']) {
      const b = screen.getByRole('button', { name: n });
      expect(b.getAttribute('title')).toBe(n);
    }
    expect(screen.queryByRole('button', { name: 'Restore folder' })).toBeNull();
  });
  it('edit mode renders none of them', async () => {
    editMode.set(true);
    await renderTab([folder('f1', [tile('a')])]);
    expect(screen.queryByRole('button', { name: 'Minimise folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Maximise folder' })).toBeNull();
  });
  it('minimise: one cell at the old top-left, siblings unmoved, then Restore brings it back', async () => {
    const { container } = await renderTab([folder('f1', [tile('a')]), tile('s', 8, 1)]);
    const before = el(container, 's').getAttribute('style');
    await fireEvent.click(screen.getByRole('button', { name: 'Minimise folder' }));
    const f = el(container, 'f1');
    expect(f.classList.contains('collapsed')).toBe(true);
    expect(f.style.gridColumn).toBe('3 / span 1');
    expect(f.style.gridRow).toBe('2 / span 1');
    expect(el(container, 's').getAttribute('style')).toBe(before);
    expect(JSON.parse(localStorage.getItem('hops.folderView.d1')!)).toEqual({ f1: 'collapsed' });
    await fireEvent.click(screen.getByRole('button', { name: 'Restore folder' }));
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    expect(el(container, 'f1').style.gridColumn).toBe('3 / span 4');
    expect(get(folderViewFor('d1'))).toEqual({});
  });
  it('the minimised tile still opens the overlay and its restore control does not', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    await renderTab([folder('f1', [tile('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Restore folder' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    setFolderView('d1', 'f1', 'collapsed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^f1, folder with/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('a minimised free folder is a square of round(designWidth/12/8) units', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    const { dash, tab } = mk([folder('f1', [tile('a')], { placement: { x: 10, y: 20, w: 40, h: 30 } })]);
    tab.layout = 'free'; tab.designWidth = 1280; tab.root.columns = 160;
    config.set({ layout: { schemaVersion: 3, dashboards: [dash] } } as any);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const f = el(container, 'f1');
    // scale 1440/1280; 13 units * 8px * scale
    expect(f.style.width).toBe(`${Math.round(13 * 8 * (1440 / 1280) * 100) / 100}px`);
    expect(f.style.minHeight).toBe(f.style.width);
  });
  it('maximise: panel dialog at the dashboard tile size; Escape closes and forgets it', async () => {
    const { container } = await renderTab([folder('f1', [tile('a')])]);
    const opener = screen.getByRole('button', { name: 'Maximise folder' });
    opener.focus();
    await fireEvent.click(opener);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const grid = dlg.querySelector('.container-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 120px)');
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(document.activeElement).toBe(opener);
  });
  it('maximise closes through its Restore button too', async () => {
    await renderTab([folder('f1', [tile('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    await fireEvent.click(screen.getByRole('dialog').querySelector('button[aria-label="Restore folder"]') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Escape closes only the overlay above a maximised panel first', async () => {
    await renderTab([folder('f1', [folder('g', [tile('a')], { display: 'collapsed', placement: { x: 0, y: 0, w: 2, h: 2 } })])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^g, folder with/ }));
    expect(screen.getAllByRole('dialog').length).toBe(2);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog').length).toBe(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a remembered view survives the folder moving to another tab (keyed by id)', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    const { container } = await renderTab([folder('f1', [tile('a')])], 'other-tab');
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(true);
  });
  it('an unknown folder id in storage is ignored silently', async () => {
    setFolderView('d1', 'ghost', 'maximised');
    await renderTab([folder('f1', [tile('a')])]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a remembered entry still wins when the saved default changes', async () => {
    setFolderView('d1', 'f1', 'expanded');
    const { container } = await renderTab([folder('f1', [tile('a')], { display: 'collapsed' })]);
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    expect(screen.getByRole('button', { name: 'Restore folder' })).toBeInTheDocument();
  });

  it('an untitled folder still has controls, reachable by keyboard focus', async () => {
    const { container } = await renderTab([folder('f1', [tile('a')], { showTitle: false })]);
    const corner = container.querySelector('[data-node-id="f1"] .corner-controls') as HTMLElement;
    expect(corner).not.toBeNull();
    const min = within(corner).getByRole('button', { name: 'Minimise folder' });
    min.focus();
    expect(document.activeElement).toBe(min);
    expect(within(corner).getByRole('button', { name: 'Maximise folder' })).toBeInTheDocument();
  });
  it('the collapsed tile and its restore control are siblings under the positioned wrapper', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    const { container } = await renderTab([folder('f1', [tile('a')])]);
    const slot = el(container, 'f1');
    expect(container.querySelectorAll('[data-node-id="f1"]').length).toBe(1);
    expect(slot.style.gridColumn).toBe('3 / span 1');
    const tileEl = slot.querySelector('[role="button"].folder-collapsed-tile') as HTMLElement;
    const restore = screen.getByRole('button', { name: 'Restore folder' });
    expect(tileEl.contains(restore)).toBe(false);
    expect(restore.closest('[data-node-id]')).toBe(slot);
  });
  it('the maximised panel has a Minimise button: closes the panel, folder minimised in place', async () => {
    const { container } = await renderTab([folder('f1', [tile('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Minimise folder' }));
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(get(folderViewFor('d1'))).toEqual({ f1: 'collapsed' });
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(true);
  });
  it('Escape on a nested folder control inside the maximised panel still closes the panel', async () => {
    await renderTab([folder('f1', [folder('g', [tile('a')], { placement: { x: 0, y: 0, w: 2, h: 2 } })])]);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Maximise folder' })[0]);
    const nested = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Minimise folder' })[1];
    nested.focus();
    await fireEvent.keyDown(nested, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('focus moves to the replacement control after Minimise and Restore', async () => {
    await renderTab([folder('f1', [tile('a')])]);
    const min = screen.getByRole('button', { name: 'Minimise folder' });
    min.focus();
    await fireEvent.click(min);
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore folder' }));
    await fireEvent.click(document.activeElement as HTMLElement);
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Minimise folder' }));
  });
});
