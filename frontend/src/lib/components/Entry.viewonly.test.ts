import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Entry from './Entry.svelte';
import { editMode } from '$lib/stores/editMode';
import type { Entry as EntryType } from '$lib/types';

const entry: EntryType = {
  id: 'e1', name: 'Plain', url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0
};

describe('Entry viewOnly', () => {
  beforeEach(() => editMode.set(true));

  it('ignores edit mode: no edit controls and no edit modal on click', async () => {
    const { container } = render(Entry, { entry, tabId: 't', groupId: 'g', viewOnly: true });
    await tick();
    expect(container.querySelector('.edit-mode')).toBeNull();
    expect(container.querySelector('.entry-controls, [aria-label^="Delete"], [aria-label^="Duplicate"]')).toBeNull();
    await fireEvent.click(screen.getByText('Plain'));
    await tick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByText(/Edit Entry|Edit entry/i)).toBeNull();
  });

  it('without viewOnly, edit mode still applies (edit styling present)', async () => {
    const { container } = render(Entry, { entry, tabId: 't', groupId: 'g' });
    await tick();
    expect(container.querySelector('.edit-mode')).not.toBeNull();
  });
});
