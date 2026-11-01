import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { isOffline } from '$lib/stores/network';
import { showingKept } from '$lib/stores/config';
import OfflineBanner from './OfflineBanner.svelte';

describe('OfflineBanner', () => {
  beforeEach(() => {
    isOffline.set(false);
    showingKept.set(false);
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
