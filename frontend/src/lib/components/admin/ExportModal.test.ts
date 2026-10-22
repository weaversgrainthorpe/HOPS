import { describe, it, expect, afterEach } from 'vitest';
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
    expect(screen.getByRole('button', { name: /Export All \(3 dashboards\)/ })).toBeInTheDocument();
    for (const n of ['Home', 'Work', 'Fancy']) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText('/fancy')).toBeInTheDocument();
    const items = Array.from(document.querySelectorAll('.dashboard-item'));
    expect(items.map((i) => i.querySelector('.dashboard-name')?.textContent)).toEqual(['Home', 'Work', 'Fancy']);
    const fancy = screen.getByText('Fancy').closest('.dashboard-item') as HTMLElement;
    expect(fancy.textContent).not.toMatch(/view-only/i);
    expect(fancy.querySelector('button')).not.toBeNull();
  });
});
