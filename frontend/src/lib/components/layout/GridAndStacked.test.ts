import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { closeAll, openFolder, overlayStack } from '$lib/stores/folderOverlay';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';

let width = 1920;
const instances: FakeRO[] = [];
class FakeRO {
  cb: ResizeObserverCallback;
  els: Element[] = [];
  constructor(cb: ResizeObserverCallback) { this.cb = cb; instances.push(this); }
  observe(el: Element) {
    this.els.push(el);
    this.fire(el);
  }
  fire(el: Element) {
    this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
async function resizeTo(w: number) {
  width = w;
  for (const ro of instances) for (const el of ro.els) if (el.classList.contains('tab-canvas')) ro.fire(el);
  await tick();
  await tick();
}

function tile(id: string, name: string, p: any): any {
  return { kind: 'tile', id, name, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: p };
}
/** A folder's child (M5: no placement). */
function kid(id: string, name: string): any {
  return { kind: 'tile', id, name, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0 };
}
function folder(id: string, name: string, p: any, children: any[], extra: any = {}): any {
  return {
    kind: 'folder', id, name, display: 'expanded', size: 'medium', contentSize: 'medium',
    ...(p ? { placement: p } : {}), content: { children }, ...extra
  };
}
/** M5: every tab is a 24-column grid. `legacy` adds the retired free-layout keys, which are ignored. */
function mk(children: any[], legacy = false) {
  const tab: LayoutTab = { id: 't1', name: 'Main', ...(legacy ? { layout: 'free', designWidth: 1280 } : {}), root: { columns: 24, children } } as any;
  const dash: LayoutDashboard = { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] };
  return { dash, tab };
}
const order = (c: HTMLElement) => [...c.querySelectorAll('[data-node-id]')].map((e) => e.getAttribute('data-node-id'));

beforeEach(() => {
  width = 1920;
  instances.length = 0;
  closeAll();
  vi.stubGlobal('ResizeObserver', FakeRO);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('free layout is gone (M5)', () => {
  it('a tab still carrying the retired free-layout keys renders as the 24-column grid', async () => {
    width = 1200;
    const { dash, tab } = mk([tile('a', 'Alpha', { x: 2, y: 1, w: 2, h: 2 })], true);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.container-free')).toBeNull();
    const el = container.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain('grid-column: 3 / span 2');
  });

  it('still shows a placeholder for an unrenderable child', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = { kind: 'tile', id: 'bad-grid', name: 'x' };
    const { dash, tab } = mk([bad]);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText(/bad-grid/)).toBeInTheDocument();
  });
});

describe('fix round 1', () => {
  it('constructs exactly one ResizeObserver for nested folders', async () => {
    const { dash, tab } = mk([
      folder('g', 'G', { x: 0, y: 0, w: 8, h: 6 }, [kid('a', 'A')]),
      folder('f', 'F', { x: 8, y: 0, w: 8, h: 6 }, [kid('b', 'B'), folder('s', 'S', undefined, [kid('c', 'C')])])
    ]);
    width = 1200;
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(instances.length).toBe(1);
  });

});

describe('z injection', () => {
  it('a malicious string z emits no injected CSS', async () => {
    const evil = '1;background:url(https://evil/x)';
    const { dash, tab } = mk([tile('a', 'A', { x: 0, y: 0, w: 5, h: 5, z: evil })]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const el = container.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(el.getAttribute('style')).not.toContain('evil');
    expect(el.style.background).toBe('');
    expect(el.style.zIndex === '' || el.style.zIndex === '0').toBe(true);
  });
});

describe('phone stacking', () => {
  it('a tab at 700px renders stacked in reading order', async () => {
    width = 700;
    const { dash, tab } = mk([
      tile('c', 'C', { x: 0, y: 20, w: 2, h: 2 }),
      tile('b', 'B', { x: 20, y: 0, w: 2, h: 2 }),
      tile('a', 'A', { x: 0, y: 0, w: 2, h: 2 })
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.container-stacked')).not.toBeNull();
    expect(container.querySelector('.container-grid')).toBeNull();
    expect(order(container)).toEqual(['a', 'b', 'c']);
  });

  it('a tab at 767px stacks: open folder full width, its contents in their order; minimised tile-sized; y then x', async () => {
    width = 767;
    const { dash, tab } = mk([
      tile('t2', 'T2', { x: 6, y: 4, w: 2, h: 2 }),
      folder('exp', 'Big', { x: 0, y: 2, w: 24, h: 8 }, [kid('in2', 'In2'), kid('in1', 'In1')]),
      folder('col', 'Small', { x: 10, y: 0, w: 4, h: 4 }, [kid('hid', 'Hid')], { display: 'collapsed' }),
      tile('t1', 'T1', { x: 0, y: 4, w: 2, h: 2 })
    ]);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.container-grid')).toBeNull();
    expect(order(container)).toEqual(['col', 'exp', 'in2', 'in1', 't1', 't2']);
    const style = (id: string) => (container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).getAttribute('style') ?? '';
    expect(style('exp')).toContain('grid-column: 1 / -1');
    expect(style('col')).not.toContain('grid-column');
    expect(container.querySelector('[data-node-id="exp"] .container-stacked')).not.toBeNull();
  });

  it('crossing the breakpoint keeps an open overlay open', async () => {
    const { dash, tab } = mk([
      folder('f', 'Box', { x: 0, y: 0, w: 4, h: 4 }, [kid('x', 'Inside')], { display: 'collapsed' })
    ]);
    config.set({ schemaVersion: 3, dashboards: [dash] } as any);
    width = 1024;
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    openFolder('f');
    await tick();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await resizeTo(600);
    expect(get(overlayStack)).toEqual(['f']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('.container-stacked')).not.toBeNull();
    await resizeTo(1024);
    expect(get(overlayStack)).toEqual(['f']);
    expect(screen.getByRole('dialog').querySelector('.container-stacked')).toBeNull();
  });
});
