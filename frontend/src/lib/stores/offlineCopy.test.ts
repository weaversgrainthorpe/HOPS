import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true, dev: false }));

import { offlineCopy, startOfflineCopy, OFFLINE_COPY_FAILED } from './offlineCopy';
import { toast } from './toast';

class FakeWorker extends EventTarget {
  state = 'installing';
  to(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function registration(parts: { installing?: FakeWorker; active?: FakeWorker }) {
  const reg = new EventTarget() as EventTarget & Record<string, unknown>;
  reg.installing = parts.installing ?? null;
  reg.waiting = null;
  reg.active = parts.active ?? null;
  return reg;
}

function stubRegister(register: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
}

describe('offline copy', () => {
  beforeEach(() => {
    offlineCopy.set('checking');
    toast.clear();
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    vi.unstubAllGlobals();
  });

  const toasts = () => get(toast).map((t) => t.message);

  it('plain http: says what it needs, with no failure toast', async () => {
    vi.stubGlobal('isSecureContext', false);
    await startOfflineCopy();
    expect(get(offlineCopy)).toBe('needs-https');
    expect(toasts()).toEqual([]);
  });

  it('already installed: ready', async () => {
    stubRegister(async () => registration({ active: new FakeWorker() }));
    await startOfflineCopy();
    expect(get(offlineCopy)).toBe('ready');
  });

  it('first install: ready once it activates', async () => {
    const worker = new FakeWorker();
    stubRegister(async () => registration({ installing: worker }));
    await startOfflineCopy();
    expect(get(offlineCopy)).toBe('checking');
    worker.to('activated');
    expect(get(offlineCopy)).toBe('ready');
  });

  it('an install that fails is said on screen, once', async () => {
    const worker = new FakeWorker();
    const reg = registration({ installing: worker });
    stubRegister(async () => reg);
    await startOfflineCopy();
    reg.installing = null;
    worker.to('redundant');
    expect(get(offlineCopy)).toBe('failed');
    expect(toasts()).toEqual([OFFLINE_COPY_FAILED]);
  });

  it('a failed update over a working copy is said too', async () => {
    const reg = registration({ active: new FakeWorker() });
    stubRegister(async () => reg);
    await startOfflineCopy();
    const update = new FakeWorker();
    reg.installing = update;
    reg.dispatchEvent(new Event('updatefound'));
    reg.installing = null;
    update.to('redundant');
    expect(get(offlineCopy)).toBe('failed');
  });

  it('replaced by a newer worker is not a failure', async () => {
    const worker = new FakeWorker();
    const reg = registration({ installing: worker });
    stubRegister(async () => reg);
    await startOfflineCopy();
    reg.installing = new FakeWorker();
    worker.to('redundant');
    expect(get(offlineCopy)).toBe('checking');
    expect(toasts()).toEqual([]);
  });

  it('a refused registration is said on screen', async () => {
    stubRegister(async () => {
      throw new Error('refused');
    });
    await startOfflineCopy();
    expect(get(offlineCopy)).toBe('failed');
    expect(toasts()).toEqual([OFFLINE_COPY_FAILED]);
  });

  it('registration blocked without an answer: unavailable, not failed', async () => {
    stubRegister(async () => undefined);
    await startOfflineCopy();
    expect(get(offlineCopy)).toBe('unavailable');
    expect(toasts()).toEqual([]);
  });
});
