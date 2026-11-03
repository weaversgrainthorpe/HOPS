// The folder dialog's order and sections, the look previews on a light
// card, and a stored colour background (pictures only at folder level, never dropped silently).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
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
    const colour = document.querySelector('.color-label')!;
    expect(colour.textContent).toBe('Colour');
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
  it('an outlined folder hides Background opacity only and says why; Text colour stays', () => {
    const { unmount } = render(FolderEditModal, { folder: f({ shape: 'folder-outline' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText('Text colour')).toBeTruthy();
    expect(screen.queryByText(/opacity/i, { selector: 'label, span, legend' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(document.querySelector('[data-outline-note]')?.textContent).toBe(
      'An outlined folder is see-through, so its colour draws the outline only and it has no opacity.'
    );
    unmount();
    render(FolderEditModal, { folder: f({ shape: 'folder-flat' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText('Text colour')).toBeTruthy();
    expect(screen.getByRole('slider', { name: /^Background opacity/ })).toBeTruthy();
    expect(document.querySelector('[data-outline-note]')).toBeNull();
  });
  it('an outlined folder never shows a contrast number: there is no fill to measure against', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ shape: 'folder-outline', color: '#fde68a', textColor: 'auto' }), onSave, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.queryByText(/hard to read|contrast/i)).toBeNull();
    expect(document.querySelector('[data-contrast-warning]')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ textColor: 'light', shape: 'folder-outline' }));
  });
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

describe('minimised icon choice', () => {
  const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
  it('"When minimised, show:" offers Icons inside (checked when absent) and Its own icon', () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn() });
    const g = screen.getByRole('radiogroup', { name: 'When minimised, show:' });
    expect(within(g).getByRole('radio', { name: 'Icons inside' })).toBeChecked();
    expect(within(g).getByRole('radio', { name: 'Its own icon' })).not.toBeChecked();
    expect(follows(screen.getByRole('button', { name: /Edit icon/ }), g)).toBe(true);
  });
  it('choosing Its own icon and saving yields minimisedIcon: own', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ iconUrl: '/i.png' }), onSave, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('radio', { name: 'Its own icon' }));
    await save();
    expect(onSave.mock.calls[0][0].minimisedIcon).toBe('own');
  });
  it('choosing Icons inside on a folder that had own removes the field', async () => {
    const onSave = vi.fn();
    render(FolderEditModal, { folder: f({ minimisedIcon: 'own', iconUrl: '/i.png' }), onSave, onCancel: vi.fn() });
    expect(screen.getByRole('radio', { name: 'Its own icon' })).toBeChecked();
    await fireEvent.click(screen.getByRole('radio', { name: 'Icons inside' }));
    await save();
    expect(onSave.mock.calls[0][0].minimisedIcon).toBeUndefined();
  });
  it('Its own icon with no icon set says the icons inside show instead', async () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText('No icon set, so it shows the icons inside.')).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Its own icon' }));
    expect(screen.getByText('No icon set, so it shows the icons inside.')).toBeInTheDocument();
  });
});

describe('names and description (item 19: the same words as the tile dialog)', () => {
  it('Name, Description and Icon; Colour under a Colour heading; Background opacity', () => {
    render(FolderEditModal, { folder: f({ shape: 'folder-flat' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByLabelText('Name *')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByText('Icon', { selector: '.label' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Colour', level: 3 })).toBeTruthy();
    expect(document.querySelector('.color-label')?.textContent).toBe('Colour');
    expect(screen.getByRole('slider', { name: /^Background opacity/ })).toBeTruthy();
  });
  it('a description is saved trimmed; a blank one is removed (missing = none)', async () => {
    const onSave = vi.fn();
    const { unmount } = render(FolderEditModal, { folder: f(), onSave, onCancel: vi.fn() });
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: '  Films and TV  ' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][0].description).toBe('Films and TV');
    unmount();
    const onSave2 = vi.fn();
    render(FolderEditModal, { folder: f({ description: 'Old' }), onSave: onSave2, onCancel: vi.fn() });
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Old');
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave2.mock.calls[0][0]).toHaveProperty('description', undefined);
  });
});

describe('fix round 1', () => {
  it('the swatches are a group named "Colour", its label hidden under the Colour heading', () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByRole('group', { name: 'Colour' }).querySelector('.sr-only')?.textContent).toBe('Colour');
  });
  it('a filled folder with no colour says Text colour applies when it has one; an outlined one does not', () => {
    const { unmount } = render(FolderEditModal, { folder: f({ shape: 'folder-flat' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText('Text colour applies when the folder has a colour.')).toBeTruthy();
    unmount();
    const r = render(FolderEditModal, { folder: f({ shape: 'folder-outline' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/applies when the folder has a colour/)).toBeNull();
    r.unmount();
    render(FolderEditModal, { folder: f({ shape: 'folder-flat', color: '#0f172a' }), onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/applies when the folder has a colour/)).toBeNull();
  });
  it('Duplicate waits while the dialog has unsaved changes, and says why', async () => {
    render(FolderEditModal, { folder: f(), onSave: vi.fn(), onCancel: vi.fn(), onDuplicate: vi.fn() });
    const dup = screen.getByRole('button', { name: /Duplicate/ }) as HTMLButtonElement;
    expect(dup.disabled).toBe(false);
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'New words' } });
    expect(dup.disabled).toBe(true);
    expect(screen.getByText('Save your changes before duplicating.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: '' } });
    expect(dup.disabled).toBe(false);
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(dup.disabled).toBe(true);
  });
});
