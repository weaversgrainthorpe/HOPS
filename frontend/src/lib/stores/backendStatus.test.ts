// Ruling 2 / the no-silent-failure rule: "can't reach the backend" (offline) and "reached it, but it
// answered with an error or no version" (degraded, shown as status 'error') are different states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const getBackendVersion = vi.fn();
vi.mock('$lib/utils/api', () => ({ getBackendVersion: () => getBackendVersion() }));

import { backendStatus } from './backendStatus';

beforeEach(() => {
  backendStatus.reset();
  getBackendVersion.mockReset();
});

describe('backend status', () => {
  it('a version answer is online', async () => {
    getBackendVersion.mockResolvedValue({ version: '3.0.0' });
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('online');
    expect(get(backendStatus).version).toBe('3.0.0');
  });

  it('a network failure (fetch rejects with a TypeError) is offline', async () => {
    getBackendVersion.mockRejectedValue(new TypeError('Failed to fetch'));
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('offline');
  });

  it('an HTTP error answer is degraded (status error), not offline', async () => {
    getBackendVersion.mockRejectedValue(new Error('Server error (500)'));
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('error');
  });

  it('an answer without a version is degraded, not "online, version unknown"', async () => {
    getBackendVersion.mockResolvedValue({});
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('error');
  });
});
