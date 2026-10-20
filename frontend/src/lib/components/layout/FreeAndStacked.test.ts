import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { closeAll, openFolder, overlayStack } from '$lib/stores/folderOverlay';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
import { containerMetrics, folderChrome, folderInnerMetrics, requiredFolderHeightPx } from '$lib/layout/geometry';

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
function folder(id: string, name: string, p: any, children: any[], extra: any = {}): any {
  return { kind: 'folder', id, name, display: 'expanded', placement: p, content: { columns: p.w, children }, ...extra };
}
function mk(children: any[], layout: 'grid' | 'free', columns: number) {
  const tab: LayoutTab = { id: 't1', name: 'Main', layout, designWidth: 1280, root: { columns, children } } as any;
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

describe('free placement', () => {
  it('free tab at 1920px scales by 1.5', async () => {
    const { dash, tab } = mk([tile('a', 'Alpha', { x: 10, y: 5, w: 30, h: 20 })], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const st = (container.querySelector('[data-node-id="a"]') as HTMLElement).style;
    expect(st.position).toBe('absolute');
    expect(st.left).toBe('120px');
    expect(st.top).toBe('60px');
    expect(st.width).toBe('360px');
    expect(st.height).toBe('240px');
    const root = (container.querySelector('.container-free') as HTMLElement).style;
    expect(root.width).toBe('1920px');
    expect(root.minHeight).toBe('300px'); // (5+20)*8*1.5, never clipped
  });

  it('overlap respects z', async () => {
    const { dash, tab } = mk([
      tile('lo', 'Low', { x: 0, y: 0, w: 10, h: 10, z: 1 }),
      tile('hi', 'High', { x: 5, y: 5, w: 10, h: 10, z: 2 })
    ], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const z = (id: string) => Number((container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).style.zIndex);
    expect(z('hi')).toBeGreaterThan(z('lo'));
  });

  it('a free folder inside a grid tab scales its children to its own box', async () => {
    width = 1200; // 100px cells, folder 6 cells = 600px box in the fake RO? RO reports 1200 for every element
    const { dash, tab } = mk([
      folder('f', 'Mixed', { x: 0, y: 0, w: 6, h: 4 }, [tile('c', 'Child', { x: 0, y: 0, w: 10, h: 5 })], { layout: 'free', content: { columns: 75, children: [tile('c', 'Child', { x: 0, y: 0, w: 10, h: 5 })] } })
    ], 'grid', 12);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    await tick();
    // box = 6 cells * 100px = 600, minus the folder's 18px side chrome = 582 over 75 columns
    // = 7.76px/unit -> child 10 units = 77.6px wide
    expect((container.querySelector('[data-node-id="c"]') as HTMLElement).style.width).toBe('77.6px');
  });

  it('still shows a placeholder for an unrenderable child in free mode', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = { kind: 'tile', id: 'bad-free', name: 'x' };
    const { dash, tab } = mk([bad], 'free', 160);
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(screen.getByText(/bad-free/)).toBeInTheDocument();
  });
});

describe('fix round 1', () => {
  it('free z ties follow ARRAY order, not reading order', async () => {
    const { dash, tab } = mk([
      tile('second-in-reading', 'S', { x: 5, y: 5, w: 10, h: 10 }),
      tile('first-in-reading', 'F', { x: 0, y: 0, w: 10, h: 10 })
    ], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(order(container)).toEqual(['second-in-reading', 'first-in-reading']);
    const z = (id: string) => (container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).style.zIndex;
    expect(z('second-in-reading')).toBe('0');
    expect(z('first-in-reading')).toBe('0');
  });

  it('nested free container never undershoots a free folder that grows', async () => {
    // inner folder box is 1 unit high but holds a tall tile: needs chrome + content
    const inner = folder('in', 'Inner', { x: 0, y: 0, w: 40, h: 1 }, [tile('deep', 'Deep', { x: 0, y: 0, w: 10, h: 50 })], { layout: 'free', content: { columns: 40, children: [tile('deep', 'Deep', { x: 0, y: 0, w: 10, h: 50 })] } });
    const { dash, tab } = mk([folder('out', 'Outer', { x: 0, y: 0, w: 80, h: 10 }, [inner], { layout: 'free', content: { columns: 80, children: [inner] } })], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const frees = [...container.querySelectorAll('.container-free')] as HTMLElement[];
    expect(frees.length).toBe(3);
    for (const f of frees) expect(f.style.height).toBe('');
    // outer box 80*12 = 960 - 18 chrome = 942 over 80 cols -> 11.775px/unit;
    // inner box 40*11.775 = 471 - 18 = 453 over 40 cols -> 11.325px/unit; 50 units tall -> 566.25px
    const innermost = frees[2];
    expect(parseFloat(innermost.style.minHeight)).toBeCloseTo(566.25, 1);
    const outerMin = parseFloat(frees[1].style.minHeight);
    expect(outerMin).toBeGreaterThanOrEqual(parseFloat(innermost.style.minHeight) + 18);
    expect(parseFloat(frees[0].style.minHeight)).toBeGreaterThanOrEqual(outerMin);
  });

  it('constructs exactly one ResizeObserver for nested free and grid folders', async () => {
    const { dash, tab } = mk([
      folder('g', 'G', { x: 0, y: 0, w: 4, h: 3 }, [tile('a', 'A', { x: 0, y: 0, w: 1, h: 1 })]),
      folder('f', 'F', { x: 4, y: 0, w: 4, h: 3 }, [tile('b', 'B', { x: 0, y: 0, w: 5, h: 5 })], { layout: 'free', content: { columns: 40, children: [tile('b', 'B', { x: 0, y: 0, w: 5, h: 5 })] } })
    ], 'grid', 12);
    width = 1200;
    render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(instances.length).toBe(1);
  });

  it('a grid folder uses content.columns, not placement.w, for its columns', async () => {
    const { dash, tab } = mk([
      folder('g', 'G', { x: 0, y: 0, w: 4, h: 3 }, [tile('a', 'A', { x: 5, y: 0, w: 1, h: 1 })], { content: { columns: 8, children: [tile('a', 'A', { x: 5, y: 0, w: 1, h: 1 })] } })
    ], 'grid', 12);
    width = 1200;
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect((container.querySelector('[data-node-id="a"]') as HTMLElement).style.gridColumn).toContain('6 / span 1');
  });
});

describe('z injection', () => {
  it.each(['free', 'grid'] as const)('a malicious string z emits no injected CSS (%s)', async (layout) => {
    const evil = '1;background:url(https://evil/x)';
    const { dash, tab } = mk([tile('a', 'A', { x: 0, y: 0, w: 5, h: 5, z: evil })], layout, layout === 'free' ? 160 : 12);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const el = container.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(el.getAttribute('style')).not.toContain('evil');
    expect(el.style.background).toBe('');
    expect(el.style.zIndex === '' || el.style.zIndex === '0').toBe(true);
  });
});

describe('phone stacking', () => {
  it('free tab at 700px renders stacked in reading order', async () => {
    width = 700; // scale 0.547 < 0.6
    const { dash, tab } = mk([
      tile('c', 'C', { x: 0, y: 20, w: 5, h: 5 }),
      tile('b', 'B', { x: 30, y: 0, w: 5, h: 5 }),
      tile('a', 'A', { x: 0, y: 0, w: 5, h: 5 })
    ], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.container-stacked')).not.toBeNull();
    expect(container.querySelector('.container-free')).toBeNull();
    expect(order(container)).toEqual(['a', 'b', 'c']);
  });

  it('grid tab at 767px stacks: expanded folder full width; collapsed tile-sized; y then x', async () => {
    width = 767;
    const { dash, tab } = mk([
      tile('t2', 'T2', { x: 3, y: 2, w: 1, h: 1 }),
      folder('exp', 'Big', { x: 0, y: 1, w: 12, h: 4 }, [tile('in2', 'In2', { x: 1, y: 0, w: 1, h: 1 }), tile('in1', 'In1', { x: 0, y: 0, w: 1, h: 1 })]),
      folder('col', 'Small', { x: 5, y: 0, w: 2, h: 2 }, [tile('hid', 'Hid', { x: 0, y: 0, w: 1, h: 1 })], { display: 'collapsed' }),
      tile('t1', 'T1', { x: 0, y: 2, w: 1, h: 1 })
    ], 'grid', 12);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    expect(container.querySelector('.container-grid')).toBeNull();
    expect(order(container)).toEqual(['col', 'exp', 'in1', 'in2', 't1', 't2']);
    const style = (id: string) => (container.querySelector(`[data-node-id="${id}"]`) as HTMLElement).getAttribute('style') ?? '';
    expect(style('exp')).toContain('grid-column: 1 / -1');
    expect(style('col')).not.toContain('grid-column');
    expect(container.querySelector('[data-node-id="exp"] .container-stacked')).not.toBeNull();
  });

  it('crossing the breakpoint keeps an open overlay open', async () => {
    const { dash, tab } = mk([
      folder('f', 'Box', { x: 0, y: 0, w: 2, h: 2 }, [tile('x', 'Inside', { x: 0, y: 0, w: 1, h: 1 })], { display: 'collapsed' })
    ], 'grid', 12);
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

describe('one geometry source (M3 Task 1)', () => {
  it('a free folder renders exactly requiredFolderHeightPx, and its children stay inside its inner width', async () => {
    const kids = [tile('deep', 'Deep', { x: 0, y: 2, w: 10, h: 50 }), tile('wide', 'Wide', { x: 30, y: 0, w: 40, h: 2 })];
    const f = folder('ff', 'Free', { x: 0, y: 0, w: 40, h: 1 }, kids, { layout: 'free', content: { columns: 40, children: kids } });
    const { dash, tab } = mk([f], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const root = containerMetrics(tab.root, 'free', 1920);
    const el = container.querySelector('[data-node-id="ff"]') as HTMLElement;
    expect(parseFloat(el.style.minHeight)).toBeCloseTo(requiredFolderHeightPx(f, root), 1);
    const inner = folderInnerMetrics(f, root);
    const ch = folderChrome(undefined, true);
    const innerFree = el.querySelector('.container-free') as HTMLElement;
    expect(parseFloat(innerFree.style.width)).toBeCloseTo(inner.innerWidthPx, 1);
    expect(parseFloat(innerFree.style.minHeight) + ch.titlePx + ch.padYPx).toBeCloseTo(requiredFolderHeightPx(f, root), 1);
    const w = container.querySelector('[data-node-id="wide"]') as HTMLElement;
    expect(parseFloat(w.style.left) + parseFloat(w.style.width)).toBeLessThanOrEqual(inner.innerWidthPx + 0.01);
  });

  it('a grid folder in a free tab grows to its square-cell rows', async () => {
    const kids = [tile('g1', 'G1', { x: 0, y: 3, w: 1, h: 1 })];
    const f = folder('gf', 'GridIn', { x: 0, y: 0, w: 40, h: 5 }, kids, { layout: 'grid', content: { columns: 4, children: kids } });
    const { dash, tab } = mk([f], 'free', 160);
    const { container } = render(TabCanvas, { dashboard: dash, tab });
    await tick();
    const root = containerMetrics(tab.root, 'free', 1920);
    const el = container.querySelector('[data-node-id="gf"]') as HTMLElement;
    const need = requiredFolderHeightPx(f, root);
    expect(need).toBeGreaterThan(5 * 12);
    expect(parseFloat(el.style.minHeight)).toBeCloseTo(need, 1);
    expect(parseFloat((container.querySelector('.container-free') as HTMLElement).style.minHeight)).toBeCloseTo(need, 1);
  });
});
