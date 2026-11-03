import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import ConfirmModal from './ConfirmModal.svelte';
import { confirm, confirmChoice, closeConfirmModal } from '$lib/stores/confirmModal';

afterEach(() => closeConfirmModal(false));

describe('ConfirmModal buttons', () => {
  it('a button that names a shared action shows that action icon', async () => {
    render(ConfirmModal);
    void confirm({ title: 'Delete it?', message: 'Gone for good.', confirmText: 'Delete', confirmStyle: 'danger' });
    await tick();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-icon', 'mdi:close');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('data-icon', 'mdi:trash-can');
  });

  it('Save / Discard / Keep editing: Save and Discard get theirs, Keep editing none', async () => {
    render(ConfirmModal);
    void confirmChoice({ title: 'Unsaved', message: 'Save first?', confirmText: 'Save', alternateText: 'Discard', cancelText: 'Keep editing' });
    await tick();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-icon', 'mdi:content-save');
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveAttribute('data-icon', 'mdi:close-circle-outline');
    expect(screen.getByRole('button', { name: 'Keep editing' })).not.toHaveAttribute('data-icon');
  });
});
