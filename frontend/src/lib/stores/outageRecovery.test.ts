import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  checkAuth: vi.fn(async () => ({ authenticated: true, mustChangePassword: false })),
  getConfig: vi.fn(async () => ({ schemaVersion: 3, layoutVersion: 2, dashboards: [] }))
}));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  return { page: writable({ url: new URL('http://localhost/settings'), params: {}, route: { id: '/settings' } }), navigating: writable(null), updated: writable(false) };
});

import { get } from 'svelte/store';
import * as api from '$lib/utils/api';
import { authUnknown, isAuthenticated } from './auth';
import { config, configError, configLoading, migrationFailure, showingKept, resetPartialLoadingForTests } from './config';
import { apply, begin, dirty, pageUnsaved, resetEditSessionForTests, session } from './editSession';
import { recoverFromOutage } from './outageRecovery';
import type { Config } from '$lib/types';

const held = (): Config => ({
  schemaVersion: 3, layoutVersion: 2,
  dashboards: [{ id: 'a', name: 'A', path: '/a', order: 0, revision: 1, tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [] } }] }]
} as unknown as Config);
const getConfig = vi.mocked(api.getConfig);
const checkAuth = vi.mocked(api.checkAuth);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetPartialLoadingForTests();
  resetEditSessionForTests();
  getConfig.mockClear();
  checkAuth.mockClear();
  config.set(held());
  showingKept.set(false);
  configError.set(null);
  configLoading.set(false);
  migrationFailure.set(null);
  pageUnsaved.set(false);
  authUnknown.set(false);
  isAuthenticated.set(false);
});

describe('recoverFromOutage', () => {
  it('nothing to pick up: reads nothing', async () => {
    recoverFromOutage();
    await flush();
    expect(getConfig).not.toHaveBeenCalled();
    expect(checkAuth).not.toHaveBeenCalled();
  });

  it('a kept copy is replaced by a fresh read, with no outage needed', async () => {
    showingKept.set(true);
    recoverFromOutage();
    await flush();
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(get(showingKept)).toBe(false);
  });

  it('a one-off failed read is tried again while the probe succeeds', async () => {
    config.set(null);
    configError.set('Failed to fetch');
    recoverFromOutage();
    await flush();
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(get(configError)).toBeNull();
    expect(get(config)).not.toBeNull();
  });

  it('an unknown session is checked again', async () => {
    authUnknown.set(true);
    recoverFromOutage();
    await flush();
    expect(checkAuth).toHaveBeenCalledTimes(1);
    expect(get(authUnknown)).toBe(false);
    expect(get(isAuthenticated)).toBe(true);
  });

  it('an open edit session is kept, unsaved work and all, and the kept mark stays', async () => {
    isAuthenticated.set(true);
    begin('a');
    apply('rename', (d) => ({ ...d, name: 'Mine' }));
    expect(get(dirty)).toBe(true);
    showingKept.set(true);
    recoverFromOutage();
    await flush();
    expect(getConfig).not.toHaveBeenCalled();
    expect(get(session)?.dashboardId).toBe('a');
    expect(get(dirty)).toBe(true);
    expect(get(showingKept)).toBe(true);
  });

  it('unsaved changes on a page are left alone too', async () => {
    pageUnsaved.set(true);
    showingKept.set(true);
    recoverFromOutage();
    await flush();
    expect(getConfig).not.toHaveBeenCalled();
    expect(get(showingKept)).toBe(true);
  });

  it('never races the first load, or reloads over a failed migration', async () => {
    showingKept.set(true);
    configLoading.set(true);
    recoverFromOutage();
    configLoading.set(false);
    migrationFailure.set('broken');
    recoverFromOutage();
    await flush();
    expect(getConfig).not.toHaveBeenCalled();
  });
});
