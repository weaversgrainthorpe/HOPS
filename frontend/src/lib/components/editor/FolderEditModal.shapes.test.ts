// The folder dialog's shape picker ("each folder picks its shape in its own
// dialog"): live previews of the seven looks in the folder's colour, the tab
// position (not for Rounded), the contrast warning, and the "needs more room" trial run.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import FolderEditModal from './FolderEditModal.svelte';
import type { FolderNode } from '$lib/types/layout';
import { deriveFolderColours } from '$lib/layout/folderColours';

const f = (extra: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id: 'f1', name: 'Media', display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: { x: 0, y: 0, w: 12, h: 8 }, content: { children: [] }, ...extra
});
afterEach(() => vi.restoreAllMocks());

const looks = () => within(screen.getByRole('radiogroup', { name: 'Look' }));

describe('the shape picker', () => {
  it('offers the seven looks as radios, each with a live preview of that shape', () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat' }), onSave: vi.fn(), onCancel: vi.fn() });
    const radios = looks().getAllByRole('radio');
    expect(radios).toHaveLength(7);
    const names = radios.map((r) => r.getAttribute('aria-label') ?? (r.closest('label')?.textContent ?? '').trim());
    expect(names.join('|')).toMatch(/Rounded/);
    for (const r of radios) {
      const shape = (r as HTMLInputElement).value;
      const preview = r.closest('label')!.querySelector('[data-folder-shape]')!;
      expect(preview.getAttribute('data-folder-shape')).toBe(shape);
    }
    expect((looks().getByRole('radio', { name: /Folder \(flat\)/ }) as HTMLInputElement).checked).toBe(true);
  });
  it('the previews are drawn in the folder colour', () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat', color: '#2563eb' }), onSave: vi.fn(), onCancel: vi.fn() });
    const c = deriveFolderColours('#2563eb', 'auto');
    const flat = looks().getByRole('radio', { name: /Folder \(flat\)/ }).closest('label')!;
    expect(flat.querySelector('path.back')!.getAttribute('fill')).toBe(c.back);
  });
  it('picking a look and a tab position is saved', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ shape: 'rounded' }), onSave, onCancel: vi.fn() });
    expect(screen.queryByRole('radiogroup', { name: 'Tab position' })).toBeNull(); // Rounded has no tab
    await fireEvent.click(looks().getByRole('radio', { name: /Folder with paper/ }));
    const pos = within(screen.getByRole('radiogroup', { name: 'Tab position' }));
    await fireEvent.click(pos.getByRole('radio', { name: 'Right' }));
    // The previews follow the tab position.
    expect(looks().getByRole('radio', { name: /Simple tab/ }).closest('label')!.querySelector('[data-folder-shape]')!.getAttribute('data-tab-position')).toBe('right');
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shape: 'folder-paper', tabPosition: 'right' }));
  });
  it('the tab position starts as stored (missing = left)', () => {
    render(FolderEditModal, { folder: f({ shape: 'simple-tab', tabPosition: 'centre' }), onSave: vi.fn(), onCancel: vi.fn() });
    const pos = within(screen.getByRole('radiogroup', { name: 'Tab position' }));
    expect((pos.getByRole('radio', { name: 'Centre' }) as HTMLInputElement).checked).toBe(true);
  });
  it('an unknown stored look is said, no look is ticked, and nothing is silently swapped', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ shape: 'folder-tab' as never }), onSave, onCancel: vi.fn() });
    expect(screen.getByText(/Unknown look/).textContent).toMatch(/folder-tab/);
    expect(looks().getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });
  it('a look that needs more room than there is: the reason shows and Save is refused', async () => {
    const onSave = vi.fn();
    const checkShape = vi.fn((s: string) => (s === 'folder-open' ? 'No room to grow it here.' : null));
    render(FolderEditModal, { folder: f({ shape: 'rounded' }), onSave, onCancel: vi.fn(), checkShape });
    await fireEvent.click(looks().getByRole('radio', { name: /open flap/ }));
    expect(screen.getByText('No room to grow it here.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.click(looks().getByRole('radio', { name: /Folder \(flat\)/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalled();
  });
});

describe('the contrast warning', () => {
  it('an explicit text colour that fails on the folder panels is warned about; Auto never is', async () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat', color: '#fde68a', textColor: 'auto' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/hard to read/i)).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    const w = screen.getByText(/hard to read/i);
    expect(w.closest('[data-contrast-warning]')).toBeTruthy();
    await fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(screen.queryByText(/hard to read/i)).toBeNull();
  });
});
