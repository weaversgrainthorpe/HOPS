import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ExportModal from './ExportModal.svelte';
import { config } from '$lib/stores/config';
import type { Config } from '$lib/types';

afterEach(() => config.set(null));

describe('ExportModal (m7)', () => {
  it('counts and lists every dashboard, including v3-only ones', () => {
    config.set({
      dashboards: [
        { id: 'd1', name: 'Home', path: '/home', order: 0, tabs: [] },
        { id: 'd2', name: 'Work', path: '/work', order: 1, tabs: [] }
      ],
      theme: { mode: 'auto' },
      v3OnlyDashboards: [{ id: 'v3d', name: 'Fancy', path: '/fancy', reason: 'free layout' }]
    } as unknown as Config);
    render(ExportModal, { onClose: () => {} });
    expect(screen.getByRole('button', { name: /Export All \(3 dashboards\)/ })).toBeInTheDocument();
    for (const n of ['Home', 'Work', 'Fancy']) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText('/fancy')).toBeInTheDocument();
    expect(document.querySelectorAll('.dashboard-item').length).toBe(3);
    const fancy = screen.getByText('Fancy').closest('.dashboard-item') as HTMLElement;
    expect(fancy.textContent).toMatch(/view-only/i);
    expect(fancy.querySelector('button')).not.toBeNull();
  });
});
