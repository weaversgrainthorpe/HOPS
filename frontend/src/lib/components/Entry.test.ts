import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Entry from './Entry.svelte';
import { editMode } from '$lib/stores/editMode';
import type { Entry as EntryType } from '$lib/types';

const entry: EntryType = {
  id: 'e1', name: 'Plain', url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0
};

// The tile only renders: editing (selection, menus, dialogs) belongs to the
// v3 editor's containers, never to the tile itself.
describe('Entry', () => {
  beforeEach(() => editMode.set(true));
  afterEach(() => editMode.set(false));

  it('ignores edit mode: no edit controls, no context menu and no edit dialog on click', async () => {
    const { container } = render(Entry, { entry });
    await tick();
    expect(container.querySelector('.edit-mode')).toBeNull();
    expect(container.querySelector('.hover-controls, [aria-label^="Delete"], [aria-label^="Edit"]')).toBeNull();
    await fireEvent.contextMenu(screen.getByText('Plain'));
    await tick();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await fireEvent.click(screen.getByText('Plain'));
    await tick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('in the editor it shows whether it is selected', async () => {
    const { container, rerender } = render(Entry, { entry, editorSelected: false });
    await tick();
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.classList.contains('selected')).toBe(false);
    await rerender({ entry, editorSelected: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.classList.contains('selected')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Plain');
  });

  it('outside the editor it is a link tile named "Open …" with no pressed state', async () => {
    const { container } = render(Entry, { entry });
    await tick();
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('Open Plain');
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
  });
});
