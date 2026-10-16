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
});
