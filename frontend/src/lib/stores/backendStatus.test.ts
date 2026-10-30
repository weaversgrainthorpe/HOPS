// The no-silent-failure rule: "can't reach the backend" (offline) and "reached it, but it
// answered with an error or no version" (degraded, shown as status 'error') are different states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const getBackendVersion = vi.fn();
vi.mock('$lib/utils/api', async () => ({
  HttpStatusError: (await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api')).HttpStatusError,
  getBackendVersion: () => getBackendVersion()
}));

import { backendStatus } from './backendStatus';
import { HttpStatusError } from '$lib/utils/api';

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

  for (const status of [502, 503, 504]) {
    it(`a proxy ${status} (the backend behind it is down) is offline, not degraded`, async () => {
      getBackendVersion.mockRejectedValue(new HttpStatusError(`The server answered ${status}`, status));
      await backendStatus.check();
      expect(get(backendStatus).status).toBe('offline');
    });
  }

  it('a 500 from the backend itself stays degraded', async () => {
    getBackendVersion.mockRejectedValue(new HttpStatusError('The server answered 500', 500));
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('error');
  });

  it('an answer without a version is degraded, not "online, version unknown"', async () => {
    getBackendVersion.mockResolvedValue({});
    await backendStatus.check();
    expect(get(backendStatus).status).toBe('error');
  });
});
