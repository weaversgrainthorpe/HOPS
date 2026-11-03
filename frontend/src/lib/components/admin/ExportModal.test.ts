import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('$lib/utils/api', async (orig) => ({
  ...(await orig<typeof import('$lib/utils/api')>()),
  getConfig: vi.fn(),
  exportConfig: vi.fn()
}));
import { render, screen } from '@testing-library/svelte';
import ExportModal from './ExportModal.svelte';
import { config } from '$lib/stores/config';
import type { Config } from '$lib/types';

afterEach(() => config.set(null));

describe('ExportModal (m7)', () => {
  it('counts and lists every dashboard (the free-layout Showcase included), each exportable, in display order', () => {
    config.set({
      schemaVersion: 3,
      dashboards: [
        { id: 'd2', name: 'Work', path: '/work', order: 1, revision: 1, tabs: [] },
        { id: 'd1', name: 'Home', path: '/home', order: 0, revision: 1, tabs: [] },
        { id: 'v3d', name: 'Fancy', path: '/fancy', order: 2, revision: 1, tabs: [{ id: 'f', name: 'F', root: { columns: 24, children: [] } }] }
      ]
    } as Config);
    render(ExportModal, { onClose: () => {} });
    expect(screen.getByRole('button', { name: /Export all \(3 dashboards\)/ })).toBeInTheDocument();
    for (const n of ['Home', 'Work', 'Fancy']) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText('/fancy')).toBeInTheDocument();
    const items = Array.from(document.querySelectorAll('.dashboard-item'));
    expect(items.map((i) => i.querySelector('.dashboard-name')?.textContent)).toEqual(['Home', 'Work', 'Fancy']);
    const fancy = screen.getByText('Fancy').closest('.dashboard-item') as HTMLElement;
    expect(fancy.textContent).not.toMatch(/view-only/i);
    expect(fancy.querySelector('button')).not.toBeNull();
  });
});

describe('ExportModal with only the index of the other dashboards', () => {
  it('a failed load of every dashboard is said, and nothing is exported', async () => {
    const api = await import('$lib/utils/api');
    const { config, resetPartialLoadingForTests } = await import('$lib/stores/config');
    const { toast } = await import('$lib/stores/toast');
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/svelte');
    const { default: ExportModal } = await import('./ExportModal.svelte');
    const err = vi.spyOn(toast, 'error');
    resetPartialLoadingForTests();
    config.set({ schemaVersion: 3, dashboards: [
      { id: 'a', name: 'A', path: '/a', revision: 1, tabs: [] },
      { id: 'b', name: 'B', path: '/b', revision: 1, partial: true }
    ] } as never);
    vi.mocked(api.getConfig).mockRejectedValue(new Error('HOPS hit an error'));
    render(ExportModal, { onClose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: /Export all/ }));
    await waitFor(() => expect(err).toHaveBeenCalledWith("Export failed: couldn't load all your dashboards: HOPS hit an error"));
    expect(api.exportConfig).not.toHaveBeenCalled();
    resetPartialLoadingForTests();
    config.set(null);
  });
});
