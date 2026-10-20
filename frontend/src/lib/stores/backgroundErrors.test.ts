import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { failedBackgroundUrls, reportBackgroundError, clearBackgroundErrors } from './backgroundErrors';
import { toast } from './toast';

describe('background error reporting', () => {
  beforeEach(() => {
    clearBackgroundErrors();
    toast.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('records the url, logs it, and never toasts (view mode stays quiet)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toastErr = vi.spyOn(toast, 'error');
    reportBackgroundError('/backgrounds/gone.jpg');
    expect(get(failedBackgroundUrls)).toEqual(['/backgrounds/gone.jpg']);
    expect(err).toHaveBeenCalledWith('Background image could not be shown', '/backgrounds/gone.jpg');
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('reports each url once', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportBackgroundError('/backgrounds/a.jpg');
    reportBackgroundError('/backgrounds/a.jpg');
    reportBackgroundError('/backgrounds/b.jpg');
    expect(err).toHaveBeenCalledTimes(2);
    expect(get(failedBackgroundUrls)).toEqual(['/backgrounds/a.jpg', '/backgrounds/b.jpg']);
  });
});
