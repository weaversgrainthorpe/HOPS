import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { closeAll, overlayStack } from '$lib/stores/folderOverlay';
import { toast } from '$lib/stores/toast';
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

function tile(id: string, name: string, x = 0, y = 0, extra: any = {}): any {
  return { kind: 'tile', id, name, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 1, h: 1 }, ...extra };
}
function folder(id: string, name: string, children: any[], extra: any = {}): any {
  return { kind: 'folder', id, name, display: 'collapsed', placement: { x: 0, y: 0, w: 2, h: 2 }, content: { columns: 4, children }, ...extra };
}
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 12, children } };
  const dash: LayoutDashboard = { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] };
  return { dash, tab };
}
function setDoc(dash: LayoutDashboard) {
  config.set({ layout: { schemaVersion: 3, dashboards: [dash] } } as any);
}

beforeEach(() => {
  width = 1440;
  vi.stubGlobal('ResizeObserver', FakeRO);
  closeAll();
  toast.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); config.set(null); });

async function renderTab(children: any[]) {
  const { dash, tab } = mk(children);
  setDoc(dash);
  const r = render(TabCanvas, { dashboard: dash, tab });
  await tick();
  return { ...r, dash, tab };
}

describe('collapsed folder preview', () => {
  it('shows "Empty folder" for no children', async () => {
    await renderTab([folder('f1', 'Box', [])]);
    expect(screen.getByText('Empty folder')).toBeInTheDocument();
  });
  it('shows one icon for one child', async () => {
    const { container } = await renderTab([folder('f1', 'Box', [tile('a', 'A')])]);
    expect(container.querySelectorAll('[data-node-id="f1"] .preview-cell').length).toBe(1);
    expect(screen.queryByText('Empty folder')).toBeNull();
  });
  it('shows four icons for six children', async () => {
    const kids = [0, 1, 2, 3, 4, 5].map((i) => tile('k' + i, 'K' + i, i % 4, Math.floor(i / 4)));
    const { container } = await renderTab([folder('f1', 'Box', kids)]);
    expect(container.querySelectorAll('[data-node-id="f1"] .preview-cell').length).toBe(4);
  });
  it('is a button that announces a dialog', async () => {
    await renderTab([folder('f1', 'Box', [])]);
    const b = screen.getByRole('button', { name: /Box/ });
    expect(b.getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('overlay', () => {
  it('opens on click and Enter; Escape closes the top only', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    const b = screen.getByRole('button', { name: /Box/ });
    await fireEvent.click(b);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.keyDown(b, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(get(overlayStack)).toEqual(['f1']);
  });

  it('nested collapsed folder stacks; breadcrumb shows Tab > A > B; clicking A closes B', async () => {
    await renderTab([folder('fa', 'FolderA', [folder('fb', 'FolderB', [tile('a', 'Deep')], { placement: { x: 0, y: 0, w: 2, h: 2 } })])]);
    await fireEvent.click(screen.getByRole('button', { name: /FolderA/ }));
    await fireEvent.click(screen.getByRole('button', { name: /FolderB/ }));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs.length).toBe(2);
    expect(dialogs[1].querySelector('nav')!.textContent).toMatch(/Main\s*›\s*FolderA\s*›\s*FolderB/);
    await fireEvent.click(dialogs[1].querySelector('nav button[data-crumb="fa"]') as HTMLElement);
    expect(screen.getAllByRole('dialog').length).toBe(1);
    expect(get(overlayStack)).toEqual(['fa']);
  });

  it('clicking the backdrop closes the top overlay', async () => {
    const { container } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    await fireEvent.click(container.ownerDocument.querySelector('.overlay-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the close button closes the top overlay and focus returns to the folder', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    const b = screen.getByRole('button', { name: /Box/ });
    b.focus();
    await fireEvent.click(b);
    await fireEvent.click(screen.getByRole('button', { name: 'Close folder' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it('closes an overlay whose folder disappeared after reload', async () => {
    const info = vi.spyOn(toast, 'info');
    const { dash } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    setDoc({ ...dash, revision: 2, tabs: [{ ...dash.tabs[0], root: { columns: 12, children: [] } }] });
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(info).toHaveBeenCalledWith('A folder you had open was changed elsewhere and has been closed');
  });

  it('tile modal stacks above the folder overlay', async () => {
    const { container } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha', 0, 0, { openMode: 'iframe' })])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    const overlay = screen.getByRole('dialog');
    await fireEvent.click(overlay.querySelector('[data-node-id="a"] [role="button"], [data-node-id="a"] a, [data-node-id="a"] button') as HTMLElement);
    const modal = container.ownerDocument.querySelector('.modal-backdrop') as HTMLElement;
    expect(modal).not.toBeNull();
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const z = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(css)![1]);
    expect(z('--z-modal-overlay')).toBeGreaterThan(z('--z-folder-overlay'));
    expect(z('--z-folder-overlay')).toBeLessThan(z('--z-modal'));
    expect(readFileSync(resolve(process.cwd(), 'src/lib/components/layout/FolderOverlay.svelte'), 'utf8')).toContain('var(--z-folder-overlay)');
    await fireEvent.keyDown(modal.querySelector('[role="dialog"]')!, { key: 'Escape' });
    expect(get(overlayStack)).toEqual(['f1']);
  });
});
