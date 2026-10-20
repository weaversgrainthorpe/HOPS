import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TabEditModal from '../admin/TabEditModal.svelte';
import { editMode } from '$lib/stores/editMode';

beforeEach(() => editMode.set(true));
afterEach(() => editMode.set(false));

describe('TabEditModal layout and design width (M3 Task 6)', () => {
  it('round-trips layout and designWidth', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Media', tabLayout: 'free', tabDesignWidth: 1600, onSave, onCancel: vi.fn() });
    const layout = screen.getByLabelText('Layout') as HTMLSelectElement;
    expect(layout.value).toBe('free');
    const dw = screen.getByLabelText(/Design width/) as HTMLInputElement;
    expect(dw.value).toBe('1600');
    await fireEvent.input(dw, { target: { value: '1920' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe('Media');
    expect(onSave.mock.calls[0][6]).toEqual({ layout: 'free', designWidth: 1920 });
  });

  it('design width is only offered for free tabs; grid/inherit save no design width change', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', tabLayout: undefined, onSave, onCancel: vi.fn() });
    const layout = screen.getByLabelText('Layout') as HTMLSelectElement;
    expect(layout.value).toBe('inherit');
    expect(screen.queryByLabelText(/Design width/)).toBeNull();
    await fireEvent.change(layout, { target: { value: 'grid' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][6]).toEqual({ layout: 'grid', designWidth: undefined });
  });

  it('an out-of-range design width is refused visibly', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Main', tabLayout: 'free', onSave, onCancel: vi.fn() });
    await fireEvent.input(screen.getByLabelText(/Design width/), { target: { value: '50' } });
    // (A browser's own min/max check also stops the submit; this is the editor's check behind it.)
    await fireEvent.submit(document.getElementById('tab-edit-form')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/design width/i);
  });
});
