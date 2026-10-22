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
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { selectedNodes, clearSelection } from '$lib/stores/nodeSelection';
import { toast } from '$lib/stores/toast';

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
const tile = (id: string, x = 0, y = 0): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 2, h: 2 } }); // a Medium tile on a tab
/** A folder's child (M5: no placement). */
const kid = (id: string): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0 });
const folder = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: { x: 4, y: 2, w: 8, h: 6 }, content: { children }, ...extra
});
function mk(children: any[], tabId = 't1'): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: tabId, name: 'Main', root: { columns: 24, children } };
  return { dash: { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] }, tab };
}
async function renderTab(children: any[], tabId = 't1') {
  const { dash, tab } = mk(children, tabId);
  config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [dash] } as any);
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
  resetEditSessionForTests();
  clearSelection();
  vi.stubGlobal('ResizeObserver', FakeRO);
  closeAll();
});
afterEach(() => { vi.unstubAllGlobals(); config.set(null); editMode.set(false); });

describe('folder controls', () => {
  it('an expanded folder shows minimise and maximise with aria-label and title; no restore at default', async () => {
    await renderTab([folder('f1', [kid('a')])]);
    for (const n of ['Minimise folder', 'Maximise folder']) {
      const b = screen.getByRole('button', { name: n });
      expect(b.getAttribute('title')).toBe(n);
    }
    expect(screen.queryByRole('button', { name: 'Restore folder' })).toBeNull();
  });
  it('edit mode shows them too; Minimise sets the draft\'s saved default (one undo step), never the viewer\'s view', async () => {
    const { dash } = mk([folder('f1', [kid('a')]), tile('s', 16, 2)]);
    config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [dash] } as any);
    begin('d1');
    editMode.set(true);
    const d = get(session)!.draft;
    render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
    await tick();
    const min = screen.getByRole('button', { name: 'Minimise folder' });
    expect(screen.getByRole('button', { name: 'Maximise folder' })).toBeInTheDocument();
    await fireEvent.click(min);
    const s = get(session)!;
    const f1 = s.draft.tabs[0].root.children.find((n) => n.id === 'f1') as any;
    expect(f1.display).toBe('collapsed');
    expect(s.undo).toHaveLength(1);
    expect(get(folderViewFor('d1'))).toEqual({}); // the viewer's remembered view is untouched
    expect(get(selectedNodes).has('f1')).toBe(false); // the click did not also select the folder
  });
  it('edit mode: Maximise says it is a viewer\'s choice instead of doing nothing', async () => {
    const { dash } = mk([folder('f1', [kid('a')])]);
    config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [dash] } as any);
    begin('d1');
    editMode.set(true);
    const d = get(session)!.draft;
    render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
    await tick();
    toast.clear();
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    expect(get(toast).at(-1)?.message).toMatch(/Maximise is how a viewer looks at a folder/);
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(session)!.undo).toHaveLength(0);
  });
  it('minimise: one Medium tile (2 x 2) at the old top-left, siblings unmoved, then Restore brings it back', async () => {
    const { container } = await renderTab([folder('f1', [kid('a')]), tile('s', 16, 2)]);
    const before = el(container, 's').getAttribute('style');
    await fireEvent.click(screen.getByRole('button', { name: 'Minimise folder' }));
    const f = el(container, 'f1');
    expect(f.classList.contains('collapsed')).toBe(true);
    expect(f.style.gridColumn).toBe('5 / span 2');
    expect(f.style.gridRow).toBe('3 / span 2');
    expect(el(container, 's').getAttribute('style')).toBe(before);
    expect(JSON.parse(localStorage.getItem('hops.folderView.d1')!)).toEqual({ f1: 'collapsed' });
    await fireEvent.click(screen.getByRole('button', { name: 'Restore folder' }));
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    expect(el(container, 'f1').style.gridColumn).toBe('5 / span 8');
    expect(get(folderViewFor('d1'))).toEqual({});
  });
  it('the minimised tile still opens the overlay and its restore control does not', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    await renderTab([folder('f1', [kid('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Restore folder' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    setFolderView('d1', 'f1', 'collapsed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^f1, folder with/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('a minimised Large folder is a 4 x 4 tile in the space it keeps (M5 §3a.2)', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    const { container } = await renderTab([folder('f1', [kid('a')], { size: 'large', placement: { x: 10, y: 2, w: 8, h: 6 } })]);
    const f = el(container, 'f1');
    expect(f.style.gridColumn).toBe('11 / span 4');
    expect(f.style.gridRow).toBe('3 / span 4');
  });
  it('maximise: panel dialog at the dashboard tile size; Escape closes and forgets it', async () => {
    const { container } = await renderTab([folder('f1', [kid('a')])]);
    const opener = screen.getByRole('button', { name: 'Maximise folder' });
    opener.focus();
    await fireEvent.click(opener);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    // Its contents flow at their contents size in the dashboard's cell (Medium = 2 x 60 px).
    const flow = dlg.querySelector('.container-flow') as HTMLElement;
    expect(flow.style.gridAutoRows).toBe('120px');
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(document.activeElement).toBe(opener);
  });
  it('maximise closes through its Restore button too', async () => {
    await renderTab([folder('f1', [kid('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    await fireEvent.click(screen.getByRole('dialog').querySelector('button[aria-label="Restore folder"]') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Escape closes only the overlay above a maximised panel first', async () => {
    await renderTab([folder('f1', [{ ...folder('g', [kid('a')], { display: 'collapsed' }), placement: undefined }])]);
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
    const { container } = await renderTab([folder('f1', [kid('a')])], 'other-tab');
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(true);
  });
  it('an unknown folder id in storage is ignored silently', async () => {
    setFolderView('d1', 'ghost', 'maximised');
    await renderTab([folder('f1', [kid('a')])]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a remembered entry still wins when the saved default changes', async () => {
    setFolderView('d1', 'f1', 'expanded');
    const { container } = await renderTab([folder('f1', [kid('a')], { display: 'collapsed' })]);
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(false);
    expect(screen.getByRole('button', { name: 'Restore folder' })).toBeInTheDocument();
  });

  it('an untitled folder still has controls, reachable by keyboard focus', async () => {
    const { container } = await renderTab([folder('f1', [kid('a')], { showTitle: false })]);
    const corner = container.querySelector('[data-node-id="f1"] .corner-controls') as HTMLElement;
    expect(corner).not.toBeNull();
    const min = within(corner).getByRole('button', { name: 'Minimise folder' });
    min.focus();
    expect(document.activeElement).toBe(min);
    expect(within(corner).getByRole('button', { name: 'Maximise folder' })).toBeInTheDocument();
  });
  it('untitled corner controls sit outside the content: on the folder box, never inside its body (call 6)', async () => {
    const { container } = await renderTab([folder('f1', [kid('a')], { showTitle: false })]);
    const box = el(container, 'f1');
    const corner = box.querySelector('.corner-controls') as HTMLElement;
    expect(corner.parentElement).toBe(box);
    expect(box.querySelector('.folder-body')!.contains(corner)).toBe(false);
    // Placed as a tab above the top-right edge (geometry is checked in Playwright, m4-backgrounds.spec.ts).
    expect(corner.dataset.placement).toBe('outside-top-right');
  });
  it('the collapsed tile and its restore control are siblings under the positioned wrapper', async () => {
    setFolderView('d1', 'f1', 'collapsed');
    const { container } = await renderTab([folder('f1', [kid('a')])]);
    const slot = el(container, 'f1');
    expect(container.querySelectorAll('[data-node-id="f1"]').length).toBe(1);
    expect(slot.style.gridColumn).toBe('5 / span 2');
    const tileEl = slot.querySelector('[role="button"].folder-collapsed-tile') as HTMLElement;
    const restore = screen.getByRole('button', { name: 'Restore folder' });
    expect(tileEl.contains(restore)).toBe(false);
    expect(restore.closest('[data-node-id]')).toBe(slot);
  });
  it('the maximised panel has a Minimise button: closes the panel, folder minimised in place', async () => {
    const { container } = await renderTab([folder('f1', [kid('a')])]);
    await fireEvent.click(screen.getByRole('button', { name: 'Maximise folder' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Minimise folder' }));
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(get(folderViewFor('d1'))).toEqual({ f1: 'collapsed' });
    expect(el(container, 'f1').classList.contains('collapsed')).toBe(true);
  });
  it('Escape on a nested folder control inside the maximised panel still closes the panel', async () => {
    // M5: a sub-folder shows as its minimised tile inside its parent; its tile is the nested control.
    await renderTab([folder('f1', [{ ...folder('g', [kid('a')]), placement: undefined }])]);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Maximise folder' })[0]);
    const nested = within(screen.getByRole('dialog')).getByRole('button', { name: /^g, folder with/ });
    nested.focus();
    await fireEvent.keyDown(nested, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('focus moves to the replacement control after Minimise and Restore', async () => {
    await renderTab([folder('f1', [kid('a')])]);
    const min = screen.getByRole('button', { name: 'Minimise folder' });
    min.focus();
    await fireEvent.click(min);
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore folder' }));
    await fireEvent.click(document.activeElement as HTMLElement);
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Minimise folder' }));
  });

  describe('every collapsed folder is one Medium tile (2 x 2)', () => {
    const big = (extra: any = {}) => folder('f1', [kid('a')], { display: 'collapsed', placement: { x: 0, y: 2, w: 24, h: 6 }, ...extra });
    it('saved-collapsed grid folder: one Medium tile, sibling unchanged, stored placement unchanged', async () => {
      const { container, dash } = await renderTab([big(), tile('s', 10, 10)]);
      const f = el(container, 'f1');
      expect(f.style.gridColumn).toBe('1 / span 2');
      expect(f.style.gridRow).toBe('3 / span 2');
      expect(el(container, 's').style.gridColumn).toBe('11 / span 2');
      expect((dash.tabs[0].root.children[0] as any).placement).toEqual({ x: 0, y: 2, w: 24, h: 6 });
    });
    it('remembered expanded renders the stored 24x6', async () => {
      setFolderView('d1', 'f1', 'expanded');
      const { container } = await renderTab([big()]);
      expect(el(container, 'f1').style.gridColumn).toBe('1 / span 24');
      expect(el(container, 'f1').style.gridRow).toBe('3 / span 6');
    });
    it('edit mode shows the saved-collapsed folder as one Medium tile too', async () => {
      editMode.set(true);
      const { container } = await renderTab([big()]);
      expect(el(container, 'f1').style.gridColumn).toBe('1 / span 2');
    });
    it('the tile still opens its overlay', async () => {
      await renderTab([big()]);
      await fireEvent.click(screen.getByRole('button', { name: /^f1, folder with/ }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
