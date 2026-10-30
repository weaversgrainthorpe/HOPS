import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/utils/api', () => ({
  getBackendVersion: vi.fn(async () => ({ version: '3.0.0' })),
  getAbout: vi.fn(async () => ({ dataDir: '/var/lib/hops' }))
}));
import { render, screen, within } from '@testing-library/svelte';
import AboutModal from './AboutModal.svelte';
import { getAbout } from '$lib/utils/api';

const ABOUT_FEATURES = [
  'Multiple dashboards',
  'Tabbed organization',
  'Drag-and-drop editing',
  'Backgrounds & slideshows',
  '8 theme presets',
  'Status checks, per tile, with on/off switches above',
  'Custom icon uploads',
  'Homer / Dashy / Heimdall import',
  'Dashboard QR codes',
  'Automatic safety backups',
  'CSRF + bcrypt security',
  'Text size controls',
  'Folders (nested, paged)',
  'Network Discovery',
  'Add to HOPS from any web page',
  'Home & away addresses',
  'SSH and note tiles',
  'Dead link & duplicate finder',
  'Search & keyboard navigation',
  'Undo / redo while editing',
  "Add to your phone's home screen",
  'Animations (optional)'
];

describe('AboutModal features', () => {
  it("lists v3's features, and nothing about shapes or the upgrade", () => {
    render(AboutModal, { onClose: () => {} });
    const list = screen.getByRole('heading', { name: 'Features' }).parentElement!.querySelector('ul')!;
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.trim())).toEqual(ABOUT_FEATURES);
    expect(list.textContent).not.toMatch(/shape|v2|upgrade|migrat/i);
  });
});

describe('AboutModal data folder', () => {
  it('shows the data folder the server reports', async () => {
    render(AboutModal, { onClose: () => {} });
    expect(await screen.findByText('/var/lib/hops')).toBeTruthy();
    expect(screen.getByText(/Data folder:/)).toBeTruthy();
  });

  it('says plainly when the data folder could not be fetched', async () => {
    vi.mocked(getAbout).mockRejectedValueOnce(new Error('SESSION_EXPIRED'));
    render(AboutModal, { onClose: () => {} });
    expect(await screen.findByText(/Not known: SESSION_EXPIRED/)).toBeTruthy();
  });
});
