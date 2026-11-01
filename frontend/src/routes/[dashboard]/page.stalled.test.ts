import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

// A connection that stalls while a dashboard is being opened, against the real API layer: the
// one-dashboard read gives up, and the page shows the failure with Retry, never a skeleton forever.

const pageStore = vi.hoisted(() => ({ set: null as null | ((p: unknown) => void) }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const page = writable({ url: new URL('http://localhost/a'), params: { dashboard: 'a' }, route: { id: '/[dashboard]' } });
  pageStore.set = page.set as (p: unknown) => void;
  return { page, navigating: writable(null), updated: writable(false) };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import { LIGHT_READ_TIMEOUT_MS } from '$lib/utils/api';
import { config, configLoading, configError, loadConfig, resetPartialLoadingForTests } from '$lib/stores/config';
import Page from './+page.svelte';

class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 1440 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const whole = (id: string, name: string, revision: number) => ({
  id, name, path: `/${id}`, order: id.charCodeAt(0), revision,
  tabs: [{ id: `t-${id}`, name: 'Main', root: { columns: 24, children: [] } }]
});
const entry = (id: string, name: string, revision: number) => ({ id, name, path: `/${id}`, order: id.charCodeAt(0), revision, partial: true });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
/** Never answers; goes away only when the client gives up. */
const stall = (init?: RequestInit) =>
  new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)));

let reads: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the failures below are expected
  reads = [];
  resetPartialLoadingForTests();
  config.set(null);
  configError.set(null);
  configLoading.set(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const goTo = (seg: string) =>
  pageStore.set!({ url: new URL(`http://localhost/${seg}`), params: { dashboard: seg }, route: { id: '/[dashboard]' } });

describe('a stalled connection', () => {
  it('while a dashboard is opened on its own: the visible error with Retry, and Retry recovers', async () => {
    let online = false;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      reads.push(u);
      if (u.includes('/config/dashboard/b')) return stall(init);
      if (u.includes('?dashboard=a')) {
        return json({ schemaVersion: 3, layoutVersion: 2, dashboards: [whole('a', 'Alpha', 1), entry('b', 'Beta', 5)], configRevision: 'r1' });
      }
      if (u.includes('?dashboard=b') && online) {
        return json({ schemaVersion: 3, layoutVersion: 2, dashboards: [entry('a', 'Alpha', 1), whole('b', 'Beta', 5)], configRevision: 'r1' });
      }
      return stall(init); // the rest, and everything else while the connection is stalled
    }));
    goTo('a');
    await loadConfig({ dashboard: 'a' });
    goTo('b');
    render(Page);
    await tick();
    expect(reads.some((u) => u.includes('/config/dashboard/b'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull(); // the skeleton, for now

    await vi.advanceTimersByTimeAsync(LIGHT_READ_TIMEOUT_MS);
    await tick();
    expect(screen.getByRole('heading', { name: "Couldn't load Beta" })).toBeInTheDocument();
    const failure = screen.getByRole('heading', { name: "Couldn't load Beta" }).parentElement!;
    expect(failure).toHaveTextContent(/Loading took too long/);

    online = true;
    await fireEvent.click(failure.querySelector('button')!);
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(screen.queryByRole('heading', { name: "Couldn't load Beta" })).toBeNull();
    expect(reads.at(-1)).toContain('/config');
    expect(get(config)!.dashboards.find((d) => d.id === 'b')!.partial).toBeUndefined();
  });

  it('on the reload of the index: the config error with Retry, never a skeleton forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => stall(init)));
    goTo('a');
    const loaded = loadConfig({ dashboard: 'a' });
    render(Page);
    await tick();
    await vi.advanceTimersByTimeAsync(LIGHT_READ_TIMEOUT_MS);
    await loaded;
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent(/Loading took too long/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
