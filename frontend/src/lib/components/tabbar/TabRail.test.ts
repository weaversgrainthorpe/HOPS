import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import TabRail from './TabRail.svelte';

// jsdom has no layout: scroll metrics come from this table, tab geometry from data-left/data-width.
const m = { scrollLeft: 0, clientWidth: 500, scrollWidth: 500 };
const proto = HTMLElement.prototype as any;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const stub = (name: string, desc: PropertyDescriptor) => {
  saved[name] = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, { configurable: true, ...desc });
};

let roCallbacks: ResizeObserverCallback[] = [];
/** Every scrollTo/scrollBy call; a smooth one does not move the stub (it would land later). */
let scrollCalls: ScrollToOptions[] = [];
class FakeRO {
  constructor(cb: ResizeObserverCallback) { roCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const strip = () => screen.getByRole('tablist');
/** An arrow at its end is aria-disabled (never `disabled`, which would drop keyboard focus). */
const off = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-disabled') === 'true';
const tabs = (n = 3) =>
  createRawSnippet(() => ({
    render: () =>
      `<div class="tabs" role="tablist">${Array.from({ length: n }, (_, i) =>
        `<div class="tab-container"><div role="tab" aria-selected="${i === 0}" data-tab-button="t${i}" data-left="${i === 2 ? 2000 : i * 100}" data-width="100">Tab ${i}</div></div>`
      ).join('')}</div>`
  }));

beforeEach(() => {
  Object.assign(m, { scrollLeft: 0, clientWidth: 500, scrollWidth: 500 });
  roCallbacks = [];
  scrollCalls = [];
  vi.stubGlobal('ResizeObserver', FakeRO);
  stub('scrollLeft', { get: () => m.scrollLeft, set: (v: number) => { m.scrollLeft = v; } });
  stub('clientWidth', { get: () => m.clientWidth });
  stub('scrollWidth', { get: () => m.scrollWidth });
  stub('offsetLeft', { get(this: HTMLElement) { return Number(this.dataset.left ?? 0); } });
  stub('offsetWidth', { get(this: HTMLElement) { return Number(this.dataset.width ?? 0); } });
  stub('scrollTo', { value(o: ScrollToOptions) { scrollCalls.push(o); if (o.behavior !== 'smooth') m.scrollLeft = o.left ?? 0; } });
  stub('scrollBy', { value(o: ScrollToOptions) { scrollCalls.push(o); if (o.behavior !== 'smooth') m.scrollLeft += o.left ?? 0; } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(proto, k, d);
    else delete proto[k];
  }
});

const open = (props: Partial<{ activeTabId: string | null; animate: boolean }> = {}) =>
  render(TabRail, { activeTabId: null, animate: false, children: tabs(), ...props });

describe('TabRail', () => {
  it('shows no arrows when the tabs fit', async () => {
    open();
    await tick();
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).toBeNull();
  });

  it('shows the arrows when the tabs overflow, the start ones disabled', async () => {
    m.scrollWidth = 3000;
    open();
    await tick();
    for (const n of ['Scroll to the first tab', 'Scroll tabs left', 'Scroll tabs right', 'Scroll to the last tab']) {
      expect(screen.getByRole('button', { name: n })).toBeTruthy();
    }
    expect(off('Scroll to the first tab')).toBe(true);
    expect(off('Scroll tabs left')).toBe(true);
    expect(off('Scroll tabs right')).toBe(false);
    expect(off('Scroll to the last tab')).toBe(false);
  });

  it('› scrolls by 0.8 of the width and never changes the open tab', async () => {
    m.scrollWidth = 3000;
    open();
    await tick();
    const selected = () => screen.getByRole('tab', { selected: true }).textContent;
    const before = selected();
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
    expect(strip().scrollLeft).toBe(400);
    expect(selected()).toBe(before);
  });

  it('» goes to the end and disables the right arrows', async () => {
    m.scrollWidth = 3000;
    open();
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll to the last tab' }));
    expect(strip().scrollLeft).toBe(2500);
    expect(off('Scroll tabs right')).toBe(true);
    expect(off('Scroll to the last tab')).toBe(true);
    expect(off('Scroll tabs left')).toBe(false);
  });

  it('arrows follow overflow when the size changes', async () => {
    open();
    await tick();
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).toBeNull();
    m.scrollWidth = 3000;
    roCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
    await tick();
    expect(screen.getByRole('button', { name: 'Scroll tabs right' })).toBeTruthy();
  });

  it('scrolls the open tab into view when activeTabId changes', async () => {
    m.scrollWidth = 3000;
    const { rerender } = open({ activeTabId: 't0' });
    await tick();
    expect(m.scrollLeft).toBe(0);
    await rerender({ activeTabId: 't2' });
    await tick();
    expect(strip().scrollLeft).toBe(1624);
  });

  it('reveals the tab it is first mounted with', async () => {
    m.scrollWidth = 3000;
    open({ activeTabId: 't2' });
    await tick();
    expect(strip().scrollLeft).toBe(1624);
  });

  it('« and » jump at once even when animations are on; ‹ › scroll smoothly then', async () => {
    m.scrollWidth = 3000;
    open({ animate: true });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll to the last tab' }));
    // Synchronously at the end: no smooth scroll still under way.
    expect(strip().scrollLeft).toBe(2500);
    expect(scrollCalls.at(-1)?.behavior).toBe('auto');
    expect(off('Scroll to the last tab')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs left' }));
    expect(scrollCalls.at(-1)?.behavior).toBe('smooth');
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll to the first tab' }));
    expect(strip().scrollLeft).toBe(0);
    expect(scrollCalls.at(-1)?.behavior).toBe('auto');
  });

  it('an arrow that reaches its end keeps keyboard focus and then does nothing', async () => {
    m.scrollWidth = 3000;
    open();
    await tick();
    const last = screen.getByRole('button', { name: 'Scroll to the last tab' }) as HTMLButtonElement;
    last.focus();
    await fireEvent.click(last);
    expect(off('Scroll to the last tab')).toBe(true);
    expect(last.disabled).toBe(false);
    expect(document.activeElement).toBe(last);
    const n = scrollCalls.length;
    await fireEvent.click(last);
    await fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
    expect(scrollCalls.length).toBe(n);
    expect(strip().scrollLeft).toBe(2500);
  });
});
