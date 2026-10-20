import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config, layoutStale } from '$lib/stores/config';
import { closeAll, openFolder, overlayStack } from '$lib/stores/folderOverlay';
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
  it('a folder whose children all cannot be displayed says so, never "Empty folder"', async () => {
    const { container } = await renderTab([folder('f1', 'Box', [{ kind: 'tile', id: 'x1' }, { kind: 'widget', id: 'x2' }])]);
    expect(screen.queryByText('Empty folder')).toBeNull();
    const note = container.querySelector('[data-node-id="f1"] .empty-note') as HTMLElement;
    expect(note.textContent).toBe("Can't display this folder's contents");
    expect(screen.getByRole('button', { name: "Box, folder with 2 items (can't display its contents)" })).toBeInTheDocument();
  });
  it('aria-label names the folder and its item count', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'A'), tile('b', 'B', 1), tile('c', 'C', 2)]), folder('f2', 'One', [tile('d', 'D')], { placement: { x: 2, y: 0, w: 2, h: 2 } }), folder('f3', 'None', [], { placement: { x: 4, y: 0, w: 2, h: 2 } })]);
    expect(screen.getByRole('button', { name: 'Box, folder with 3 items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One, folder with 1 item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'None, folder with 0 items' })).toBeInTheDocument();
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

describe('overlay sizing (Ruling 23)', () => {
  for (const cols of [1, 3]) {
    it(`a ${cols}-column folder's overlay cells equal the dashboard cell (120px at 1440), not bodyPx/columns`, async () => {
      const kids = [0, 1, 2].map((i) => tile('k' + i, 'K' + i, i % cols, Math.floor(i / cols)));
      await renderTab([folder('f1', 'Box', kids, { content: { columns: cols, children: kids } })]);
      await fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
      const panel = screen.getByRole('dialog');
      const cell = panel.querySelector('[data-node-id="k0"]') as HTMLElement;
      const grid = cell.parentElement as HTMLElement;
      expect(grid.getAttribute('style')).toMatch(/grid-auto-rows:\s*120px/);
      // The content box is exactly columns x cell, so each 1fr column is 120px too.
      const box = panel.querySelector('.overlay-content') as HTMLElement;
      expect(box.style.width).toBe(`${cols * 120}px`);
      // The panel fits its content (+ chrome), capped at the viewport.
      expect((panel as HTMLElement).style.width).toBe(`${cols * 120 + 34}px`);
      expect((panel as HTMLElement).style.maxWidth).toBe('100%');
    });
  }
  it('a narrow viewport shrinks the overlay cell below the dashboard cell', async () => {
    const prev = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    try {
      const kids = [tile('a', 'A', 0, 0), tile('b', 'B', 1, 0), tile('c', 'C', 2, 0), tile('d', 'D', 3, 0)];
      await renderTab([folder('f1', 'Box', kids)]);
      await fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
      const grid = (screen.getByRole('dialog').querySelector('[data-node-id="a"]') as HTMLElement).parentElement as HTMLElement;
      const row = Number(/grid-auto-rows:\s*([\d.]+)px/.exec(grid.getAttribute('style') ?? '')![1]);
      expect(row).toBeCloseTo((400 - 32 - 34) / 4, 1);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: prev });
    }
  });
});

describe('overlay width excludes the scrollbar (M3 Task 1)', () => {
  it('a 15px page scrollbar is subtracted from the overlay body', async () => {
    const prevW = window.innerWidth;
    const de = document.documentElement;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(de, 'clientWidth', { configurable: true, value: 385 });
    try {
      const kids = [tile('a', 'A', 0, 0), tile('b', 'B', 1, 0), tile('c', 'C', 2, 0), tile('d', 'D', 3, 0)];
      await renderTab([folder('f1', 'Box', kids)]);
      await fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
      const grid = (screen.getByRole('dialog').querySelector('[data-node-id="a"]') as HTMLElement).parentElement as HTMLElement;
      const row = Number(/grid-auto-rows:\s*([\d.]+)px/.exec(grid.getAttribute('style') ?? '')![1]);
      expect(row).toBeCloseTo((385 - 32 - 34) / 4, 1);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: prevW });
      delete (de as unknown as Record<string, unknown>).clientWidth;
    }
  });
});

describe('overlay focus and lifetime', () => {
  it('initial focus goes to the close button, not the breadcrumb root', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close folder' }));
  });
  it('the overlay stack is cleared when the canvas unmounts', async () => {
    const { unmount } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
    expect(get(overlayStack)).toEqual(['f1']);
    unmount();
    expect(get(overlayStack)).toEqual([]);
  });
});

describe('overlay robustness', () => {
  it('Escape with focus on body closes the top overlay', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    (document.activeElement as HTMLElement | null)?.blur();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an Escape another handler already handled (defaultPrevented) leaves the overlay open', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    const handled = (e: KeyboardEvent) => e.preventDefault();
    document.body.addEventListener('keydown', handled);
    try {
      await fireEvent.keyDown(document.body, { key: 'Escape' });
    } finally {
      document.body.removeEventListener('keydown', handled);
    }
    expect(get(overlayStack)).toEqual(['f1']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('with a tile modal open, Escape closes only the modal', async () => {
    const { container } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha', 0, 0, { openMode: 'iframe' })])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    await fireEvent.click(screen.getByRole('dialog').querySelector('[data-node-id="a"] [role="button"], [data-node-id="a"] a, [data-node-id="a"] button') as HTMLElement);
    expect(container.ownerDocument.querySelector('.modal-backdrop')).not.toBeNull();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();
    expect(container.ownerDocument.querySelector('.modal-backdrop')).toBeNull();
    expect(get(overlayStack)).toEqual(['f1']);
  });

  it('background and lower panels are inert; Shift+Tab from the panel root stays inside', async () => {
    const { container } = await renderTab([folder('fa', 'FolderA', [folder('fb', 'FolderB', [tile('a', 'Deep')])])]);
    expect(container.querySelector('.tab-canvas')!.hasAttribute('inert')).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: /FolderA/ }));
    expect(container.querySelector('.tab-canvas')!.hasAttribute('inert')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /FolderB/ }));
    const [low, top] = screen.getAllByRole('dialog');
    expect(low.hasAttribute('inert')).toBe(true);
    expect(top.hasAttribute('inert')).toBe(false);
    top.focus();
    await fireEvent.keyDown(top, { key: 'Tab', shiftKey: true });
    expect(top.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(top);
  });

  it('portals to body and survives a layoutStale flip with focus intact', async () => {
    await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const dlg = screen.getByRole('dialog');
    expect(dlg.parentElement!.parentElement!.parentElement).toBe(document.body);
    expect(dlg.contains(document.activeElement)).toBe(true);
    layoutStale.set(true);
    await tick();
    expect(screen.getByRole('dialog')).toBe(dlg);
    expect(dlg.contains(document.activeElement)).toBe(true);
    layoutStale.set(false);
  });

  it('a folder moved to another tab is dropped with the toast', async () => {
    const info = vi.spyOn(toast, 'info');
    const { dash } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    const other: LayoutTab = { id: 't2', name: 'Other', root: { columns: 12, children: [folder('f1', 'Box', [])] } };
    setDoc({ ...dash, revision: 2, tabs: [{ ...dash.tabs[0], root: { columns: 12, children: [] } }, other] });
    await tick();
    expect(get(overlayStack)).toEqual([]);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('a transient null layout keeps overlays open without a toast', async () => {
    const info = vi.spyOn(toast, 'info');
    const { dash } = await renderTab([folder('f1', 'Box', [tile('a', 'Alpha')])]);
    await fireEvent.click(screen.getByRole('button', { name: /Box/ }));
    config.set(null);
    await tick();
    setDoc(dash);
    await tick();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(info).not.toHaveBeenCalled();
  });

  it('openFolder dedupes', () => {
    openFolder('x'); openFolder('x');
    expect(get(overlayStack)).toEqual(['x']);
  });
});
