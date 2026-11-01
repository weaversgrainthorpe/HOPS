import { describe, it, expect, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';

// __APP_VERSION__ is 'test' under vitest (see vitest.config.ts).

async function loadWithServerVersion(version: string) {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) })
  );
  const mod = await import('./network');
  mod.initNetworkWatcher();
  await vi.waitFor(() => expect(get(mod.serverVersion)).toBe(version));
  return mod;
}

describe('uiVersionMismatch', () => {
  afterEach(async () => {
    const mod = await import('./network');
    mod.stopNetworkWatcher();
    vi.unstubAllGlobals();
  });

  it('reports the server version when it differs from the UI build', async () => {
    const mod = await loadWithServerVersion('2.2.0');
    expect(get(mod.uiVersionMismatch)).toBe('2.2.0');
  });

  it('is null when UI and server versions match', async () => {
    const mod = await loadWithServerVersion('test');
    expect(get(mod.uiVersionMismatch)).toBeNull();
  });

  it('ignores a pre-release label only the server carries (rc builds)', async () => {
    const mod = await loadWithServerVersion('test-rc1');
    expect(get(mod.uiVersionMismatch)).toBeNull();
  });

  it('still reports a different base version that has a pre-release label', async () => {
    const mod = await loadWithServerVersion('2.2.0-rc1');
    expect(get(mod.uiVersionMismatch)).toBe('2.2.0-rc1');
  });
});

describe('the reachable callback', () => {
  afterEach(async () => {
    const mod = await import('./network');
    mod.stopNetworkWatcher();
    vi.unstubAllGlobals();
  });

  async function start(fetchMock: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./network');
    const reachable = vi.fn();
    mod.initNetworkWatcher(reachable);
    return { mod, reachable };
  }

  it('runs when the server answers, with no outage before it', async () => {
    const { reachable } = await start(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'test' }) }));
    await vi.waitFor(() => expect(reachable).toHaveBeenCalledTimes(1));
  });

  it('does not run when the server is unreachable, and the app goes offline', async () => {
    const { mod, reachable } = await start(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await vi.waitFor(() => expect(get(mod.isOffline)).toBe(true));
    expect(reachable).not.toHaveBeenCalled();
  });

  it('runs on the way back from offline', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ ok: true, json: async () => ({}) });
    const { mod, reachable } = await start(f);
    await vi.waitFor(() => expect(get(mod.isOffline)).toBe(true));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(reachable).toHaveBeenCalledTimes(1));
    expect(get(mod.isOffline)).toBe(false);
  });
});
