import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ActionButton from './ActionButton.svelte';

describe('ActionButton', () => {
  it('draws the action icon and word, in the action class', () => {
    render(ActionButton, { props: { action: 'save' } });
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveClass('btn-primary');
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveAttribute('data-icon', 'mdi:content-save');
  });

  it('is danger for Delete and secondary for Discard', () => {
    render(ActionButton, { props: { action: 'delete' } });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
    render(ActionButton, { props: { action: 'discard' } });
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveClass('btn-secondary');
  });

  it('keeps a specific label when given one', () => {
    render(ActionButton, { props: { action: 'delete', label: 'Delete anyway' } });
    expect(screen.getByRole('button', { name: 'Delete anyway' })).toHaveClass('btn-danger');
  });

  it('says it is busy, and cannot be pressed while it is', async () => {
    const onclick = vi.fn();
    render(ActionButton, { props: { action: 'save', busy: true, onclick } });
    const b = screen.getByRole('button', { name: 'Saving…' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    await fireEvent.click(b);
    expect(onclick).not.toHaveBeenCalled();
  });

  it('is small with small, and passes the click through', async () => {
    const onclick = vi.fn();
    render(ActionButton, { props: { action: 'undo', small: true, onclick } });
    const b = screen.getByRole('button', { name: 'Undo' });
    expect(b).toHaveClass('btn-sm');
    await fireEvent.click(b);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('is disabled when told', () => {
    render(ActionButton, { props: { action: 'redo', disabled: true } });
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
