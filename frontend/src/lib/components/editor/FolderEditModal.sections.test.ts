// The folder dialog's order and sections, the look previews on a light
// card, and a stored colour background (pictures only at folder level, never dropped silently).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FolderEditModal from './FolderEditModal.svelte';
import LookPreview, { PREVIEW_CARD, previewNeedsEdge, MIN_NON_TEXT_CONTRAST } from './LookPreview.svelte';
import type { FolderNode } from '$lib/types/layout';
import { FOLDER_SHAPES } from '$lib/layout/geometry';
import { contrastRatio, deriveFolderColours } from '$lib/layout/folderColours';

const f = (extra: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id: 'f1', name: 'Media', display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: { x: 0, y: 0, w: 12, h: 8 }, content: { children: [] }, ...extra
});
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the dialog order and sections', () => {
  it('the look (picker and tab position) sits between Icon and the colour and Background', () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat' }), onSave: vi.fn(), onCancel: vi.fn(), onMoveCopy: vi.fn() });
    const icon = screen.getByRole('button', { name: /Edit icon/ });
    const look = screen.getByRole('radiogroup', { name: 'Look' });
    const tabPos = screen.getByRole('radiogroup', { name: 'Tab position' });
    const colour = screen.getByText('Folder colour');
    const background = screen.getByRole('button', { name: /^Background/ });
    expect(follows(icon, look)).toBe(true);
    expect(follows(look, tabPos)).toBe(true);
    expect(follows(tabPos, colour)).toBe(true);
    expect(follows(colour, background)).toBe(true);
  });

  it('Look, Status checks, Background and Move or copy are each a section with its own heading', () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn(), onMoveCopy: vi.fn() });
    const titles = Array.from(document.querySelectorAll('section.dialog-section')).map(
      (sec) => sec.querySelector('h3, legend')?.textContent?.trim()
    );
    for (const t of ['Look', 'Status checks for tiles in this folder', 'Background', 'Move or copy']) expect(titles).toContain(t);
    // The status-check text and the Background button are in different sections.
    const statusText = document.querySelector('.status-checks .row-text')!;
    const bgBtn = screen.getByRole('button', { name: /^Background/ });
    expect(statusText.closest('section')).not.toBe(bgBtn.closest('section'));
    for (const h of ['Look', 'Background', 'Move or copy']) expect(screen.getByRole('heading', { name: h, level: 3 })).toBeInTheDocument();
  });
});

describe('look previews on a light card', () => {
  it('every look sits on the light neutral card, drawn opaque in the folder colour', () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat', color: '#0f172a', opacity: 0.2 }), onSave: vi.fn(), onCancel: vi.fn() });
    const cards = document.querySelectorAll('.shape-picker [data-preview-card]');
    expect(cards).toHaveLength(FOLDER_SHAPES.length);
    for (const c of cards) expect((c as HTMLElement).style.backgroundColor).toBe('rgb(238, 242, 247)');
    // Opaque (the opacity has its own slider): a faint preview would not be readable.
    for (const p of document.querySelectorAll('.shape-picker [data-shape-paint]')) expect((p as HTMLElement).style.opacity).toBe('1');
  });

  it('a dark folder keeps >= 3:1 against the card with no extra edge', () => {
    for (const c of ['#0f172a', '#1e3a8a', '#000000', '#7f1d1d']) {
      const col = deriveFolderColours(c, 'auto');
      expect(Math.min(contrastRatio(col.back, PREVIEW_CARD), contrastRatio(col.front, PREVIEW_CARD))).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
      expect(previewNeedsEdge(c)).toBe(false);
    }
  });

  it('a light folder (and a themed one) gets a dark edge that is >= 3:1 on the card', () => {
    for (const c of ['#ffffff', '#fde68a', '#e2e8f0', undefined]) expect(previewNeedsEdge(c)).toBe(true);
    render(LookPreview, { shape: 'folder-flat', tabPosition: 'left', color: '#ffffff' });
    const edge = document.querySelector('[data-preview-edge] path')!;
    expect(contrastRatio(edge.getAttribute('stroke')!, PREVIEW_CARD)).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
  });

  it('every look in white draws its edge (Rounded as a ring)', () => {
    for (const s of FOLDER_SHAPES) {
      const { unmount } = render(LookPreview, { shape: s, tabPosition: 'left', color: '#ffffff' });
      if (s === 'rounded') expect(document.querySelector('.look-shape.edged')).not.toBeNull();
      else expect(document.querySelector('[data-preview-edge]')).not.toBeNull();
      unmount();
    }
  });
});

describe('the Background section at folder level', () => {
  it('no picture of its own says so in the new words', () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText(/No picture of its own — shows what's behind/)).toBeInTheDocument();
  });

  it('a stored colour background is shown with "Use as folder colour"; one click moves it to the folder colour', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ color: '#ff0000', background: { type: 'color', value: '#123456', opacity: 0.6 } }), onSave, onCancel: vi.fn() });
    expect(screen.getByText(/Colour background #123456 \(set the folder colour instead\)/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Use as folder colour' }));
    expect(screen.queryByText(/set the folder colour instead/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Folder colour set to #123456 at 60% opacity/);
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ color: '#123456', opacity: 0.6, background: null }));
  });

  it('untouched, a stored colour background is not written (kept as stored)', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ background: { type: 'color', value: '#123456' } }), onSave, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('background');
  });

  it('a colour that is not #rrggbb says why it cannot be used (and offers no button)', () => {
    render(FolderEditModal, { folder: f({ background: { type: 'color', value: 'rebeccapurple' } }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Use as folder colour' })).toBeNull();
    expect(screen.getByText(/rebeccapurple.*can't be used as the folder colour/)).toBeInTheDocument();
  });
});
