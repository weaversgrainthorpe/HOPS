import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { isOffline } from '$lib/stores/network';
import * as configStore from '$lib/stores/config';
import { keptFailure, showingKept } from '$lib/stores/config';
import { pageUnsaved } from '$lib/stores/editSession';
import OfflineBanner from './OfflineBanner.svelte';

describe('OfflineBanner', () => {
  beforeEach(() => {
    isOffline.set(false);
    showingKept.set(false);
    keptFailure.set(null);
    pageUnsaved.set(false);
  });

  it('a lasting failure over a saved copy gives its reason and a Retry', async () => {
    const retry = vi.spyOn(configStore, 'retryLoadForPage').mockResolvedValue();
    showingKept.set(true);
    render(OfflineBanner);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    keptFailure.set('the database is locked');
    await tick();
    expect(screen.getByRole('status').textContent).toContain("Couldn't update it: the database is locked.");
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    retry.mockRestore();
  });

  it('no Retry over open edits: they are never re-read underneath', async () => {
    showingKept.set(true);
    keptFailure.set('the database is locked');
    pageUnsaved.set(true);
    render(OfflineBanner);
    expect(screen.getByRole('status').textContent).toContain('the database is locked');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows nothing when online with data from the server', () => {
    render(OfflineBanner);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a saved copy is still said when the server is back, until a fresh read lands', async () => {
    isOffline.set(true);
    showingKept.set(true);
    render(OfflineBanner);
    expect(screen.getByRole('status').textContent).toContain("You're offline");
    isOffline.set(false);
    await tick();
    expect(screen.getByRole('status').textContent).toContain('saved copy');
    showingKept.set(false);
    await tick();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a saved copy is said before any probe has noticed', () => {
    showingKept.set(true);
    render(OfflineBanner);
    expect(screen.getByRole('status').textContent).toContain('saved copy');
  });
});
